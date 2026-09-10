import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { KnowledgeOutboxRepository } from '@libs/learning';

export const KNOWLEDGE_INGESTION_QUEUE = 'KNOWLEDGE_INGESTION_QUEUE';
export const KNOWLEDGE_INGESTION_JOB = 'PROCESS_KNOWLEDGE_INGESTION';

export type KnowledgeQueuePayload = Readonly<{
  ingestionJobId: string;
  operation: 'UPSERT' | 'REEMBED' | 'INVALIDATE' | 'PURGE';
  contentVersion: string | null;
  pipelineVersion: string;
}>;

export function parseKnowledgeQueuePayload(
  value: unknown,
): KnowledgeQueuePayload {
  if (!value || typeof value !== 'object') {
    throw new Error('KNOWLEDGE_QUEUE_PAYLOAD_INVALID');
  }
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).sort().join(',') !==
      'contentVersion,ingestionJobId,operation,pipelineVersion' ||
    typeof payload.ingestionJobId !== 'string' ||
    !/^kjob_[A-Za-z0-9_-]{10,64}$/.test(payload.ingestionJobId) ||
    !['UPSERT', 'REEMBED', 'INVALIDATE', 'PURGE'].includes(
      String(payload.operation),
    ) ||
    (payload.contentVersion !== null &&
      typeof payload.contentVersion !== 'string') ||
    typeof payload.pipelineVersion !== 'string' ||
    !payload.pipelineVersion.trim()
  ) {
    throw new Error('KNOWLEDGE_QUEUE_PAYLOAD_INVALID');
  }
  return Object.freeze(payload as KnowledgeQueuePayload);
}

@Injectable()
export class KnowledgeOutboxDispatcher {
  constructor(
    private readonly outbox: KnowledgeOutboxRepository,
    @InjectQueue(KNOWLEDGE_INGESTION_QUEUE)
    private readonly queue: Pick<Queue<KnowledgeQueuePayload>, 'add'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dispatchBatch(
    input: {
      limit?: number;
      leaseMs?: number;
    } = {},
  ): Promise<{ claimed: number; dispatched: number; failed: number }> {
    const now = this.now();
    const jobs = await this.outbox.claimPending({
      now,
      leaseMs: input.leaseMs ?? 60_000,
      limit: input.limit ?? 25,
    });
    let dispatched = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        const payload = parseKnowledgeQueuePayload({
          ingestionJobId: job.id,
          operation: job.operation,
          contentVersion: job.contentVersion,
          pipelineVersion: job.pipelineVersion,
        });
        await this.queue.add(KNOWLEDGE_INGESTION_JOB, payload, {
          jobId: job.id,
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
        dispatched += 1;
      } catch {
        failed += 1;
        const delayMs = Math.min(
          5 * 60_000,
          1_000 * 2 ** Math.min(job.attemptCount - 1, 8),
        );
        await this.outbox.markFailed({
          id: job.id,
          now,
          retryable: true,
          failureCode: 'QUEUE_DISPATCH_FAILED',
          nextAttemptAt: new Date(now.getTime() + delayMs),
        });
      }
    }
    return { claimed: jobs.length, dispatched, failed };
  }
}
