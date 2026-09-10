import { Inject, Optional } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  KnowledgeOutboxRepository,
  type KnowledgeOutboxJob,
} from '@libs/learning';
import {
  KNOWLEDGE_INGESTION_JOB,
  KNOWLEDGE_INGESTION_QUEUE,
  parseKnowledgeQueuePayload,
  type KnowledgeQueuePayload,
} from './knowledge-outbox.dispatcher';

export const KNOWLEDGE_INGESTION_EXECUTOR = Symbol(
  'KNOWLEDGE_INGESTION_EXECUTOR',
);

export interface KnowledgeIngestionExecutor {
  execute(job: KnowledgeOutboxJob): Promise<void>;
}

function failure(error: unknown): { code: string; retryable: boolean } {
  if (error && typeof error === 'object') {
    const code =
      'code' in error && typeof error.code === 'string'
        ? error.code
        : 'KNOWLEDGE_INGESTION_FAILED';
    const retryable =
      'retryable' in error && typeof error.retryable === 'boolean'
        ? error.retryable
        : /TIMEOUT|RATE|UNAVAILABLE|RETRY/i.test(code);
    return { code: code.slice(0, 64), retryable };
  }
  return { code: 'KNOWLEDGE_INGESTION_FAILED', retryable: false };
}

@Processor(KNOWLEDGE_INGESTION_QUEUE)
export class KnowledgeIngestionProcessor extends WorkerHost {
  constructor(
    private readonly outbox: KnowledgeOutboxRepository,
    @Optional()
    @Inject(KNOWLEDGE_INGESTION_EXECUTOR)
    private readonly executor?: KnowledgeIngestionExecutor,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  async process(job: Job<KnowledgeQueuePayload>): Promise<void> {
    if (job.name !== KNOWLEDGE_INGESTION_JOB) {
      throw new Error('KNOWLEDGE_QUEUE_JOB_UNSUPPORTED');
    }
    const payload = parseKnowledgeQueuePayload(job.data);
    if (String(job.id) !== payload.ingestionJobId) {
      throw new Error('KNOWLEDGE_QUEUE_JOB_ID_MISMATCH');
    }
    const stored = await this.outbox.findById(payload.ingestionJobId);
    if (!stored) throw new Error('KNOWLEDGE_INGESTION_JOB_NOT_FOUND');
    if (
      stored.operation !== payload.operation ||
      stored.contentVersion !== payload.contentVersion ||
      stored.pipelineVersion !== payload.pipelineVersion
    ) {
      throw new Error('KNOWLEDGE_QUEUE_JOB_VERSION_MISMATCH');
    }
    if (stored.status === 'SUCCEEDED') return;
    if (!(await this.outbox.markRunning(stored.id, this.now()))) return;
    if (!this.executor) {
      await this.outbox.markFailed({
        id: stored.id,
        now: this.now(),
        retryable: false,
        failureCode: 'INGESTION_EXECUTOR_UNAVAILABLE',
        nextAttemptAt: null,
      });
      return;
    }
    try {
      await this.executor.execute({ ...stored, status: 'RUNNING' });
      await this.outbox.markSucceeded(stored.id, this.now());
    } catch (error) {
      const mapped = failure(error);
      const nextAttemptAt = mapped.retryable
        ? new Date(
            this.now().getTime() +
              Math.min(
                5 * 60_000,
                1_000 * 2 ** Math.min(stored.attemptCount, 8),
              ),
          )
        : null;
      await this.outbox.markFailed({
        id: stored.id,
        now: this.now(),
        retryable: mapped.retryable,
        failureCode: mapped.code,
        nextAttemptAt,
      });
    }
  }
}
