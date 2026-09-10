import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

export const PRONUNCIATION_QUEUE_NAME = 'PRONUNCIATION_ASSESSMENT_QUEUE';
export const PRONUNCIATION_ASSESSMENT_JOB = 'ASSESS_PRONUNCIATION';

export type PronunciationQueuePayload = Readonly<{ assessmentId: string }>;

export function parsePronunciationQueuePayload(
  value: unknown,
): PronunciationQueuePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PRONUNCIATION_QUEUE_PAYLOAD_INVALID');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record.assessmentId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(record.assessmentId)
  ) {
    throw new Error('PRONUNCIATION_QUEUE_PAYLOAD_INVALID');
  }
  return Object.freeze({ assessmentId: record.assessmentId });
}

@Injectable()
export class PronunciationQueueService {
  constructor(
    @InjectQueue(PRONUNCIATION_QUEUE_NAME)
    private readonly queue: Pick<Queue<PronunciationQueuePayload>, 'add'>,
  ) {}

  enqueue(assessmentId: string) {
    const payload = parsePronunciationQueuePayload({ assessmentId });
    return this.queue.add(PRONUNCIATION_ASSESSMENT_JOB, payload, {
      jobId: assessmentId,
      attempts: 1,
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    });
  }
}
