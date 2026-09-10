import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PronunciationRepository } from '../application/pronunciation.repository';
import {
  PRONUNCIATION_ASSESSMENT_JOB,
  PRONUNCIATION_QUEUE_NAME,
  parsePronunciationQueuePayload,
  type PronunciationQueuePayload,
} from './pronunciation.queue';

export const PRONUNCIATION_ASSESSMENT_EXECUTOR = Symbol(
  'PRONUNCIATION_ASSESSMENT_EXECUTOR',
);

export interface PronunciationAssessmentExecutor {
  executeAssessment(assessmentId: string): Promise<void>;
}

@Processor(PRONUNCIATION_QUEUE_NAME)
export class PronunciationProcessor extends WorkerHost {
  constructor(
    private readonly repository: PronunciationRepository,
    @Inject(PRONUNCIATION_ASSESSMENT_EXECUTOR)
    private readonly executor: PronunciationAssessmentExecutor,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  async process(job: Job<PronunciationQueuePayload>): Promise<void> {
    if (job.name !== PRONUNCIATION_ASSESSMENT_JOB) {
      throw new Error('PRONUNCIATION_QUEUE_JOB_UNSUPPORTED');
    }
    const payload = parsePronunciationQueuePayload(job.data);
    if (String(job.id) !== payload.assessmentId) {
      throw new Error('PRONUNCIATION_QUEUE_JOB_ID_MISMATCH');
    }
    const claimed = await this.repository.claimQueuedForProcessing(
      payload.assessmentId,
      this.now(),
    );
    if (!claimed) return;
    try {
      await this.executor.executeAssessment(payload.assessmentId);
    } catch (error) {
      try {
        await this.repository.markProcessingFailed(
          payload.assessmentId,
          this.now(),
        );
      } catch {
        // Preserve the execution error for the dead-letter record. A durable
        // PROCESSING row remains discoverable for operational reconciliation.
      }
      throw error;
    }
  }
}
