import {
  InMemoryKnowledgeOutboxPersistence,
  KnowledgeOutboxRepository,
} from '@libs/learning/knowledge/ingestion/knowledge-outbox.repository';
import {
  KNOWLEDGE_INGESTION_JOB,
  KnowledgeOutboxDispatcher,
  parseKnowledgeQueuePayload,
} from '../../src/knowledge/queue/knowledge-outbox.dispatcher';
import { KnowledgeIngestionProcessor } from '../../src/knowledge/queue/knowledge-ingestion.processor';

describe('RAG ingestion outbox', () => {
  const command = {
    operation: 'UPSERT' as const,
    knowledgeSourceId: 'source_test_001',
    sourceRecordType: 'WordBook',
    sourceRecordId: 'word_test_001',
    contentVersion: 'content.v1',
    pipelineVersion: 'pipeline.v1',
    ownerUserId: null,
  };

  it('deduplicates repeated writes by the database idempotency key', async () => {
    const persistence = new InMemoryKnowledgeOutboxPersistence();
    const repository = new KnowledgeOutboxRepository(persistence);

    const first = await repository.enqueue(command);
    const second = await repository.enqueue(command);

    expect(second.id).toBe(first.id);
    expect(persistence.snapshot()).toHaveLength(1);
  });

  it('leases one pending job and permits a stale retry without duplicate effects', async () => {
    const persistence = new InMemoryKnowledgeOutboxPersistence();
    const repository = new KnowledgeOutboxRepository(persistence);
    const job = await repository.enqueue(command);

    const claimed = await repository.claimPending({
      now: new Date('2026-09-08T00:00:00.000Z'),
      leaseMs: 1000,
      limit: 10,
    });
    const claimedAgain = await repository.claimPending({
      now: new Date('2026-09-08T00:00:00.500Z'),
      leaseMs: 1000,
      limit: 10,
    });

    expect(claimed.map((item) => item.id)).toEqual([job.id]);
    expect(claimedAgain).toEqual([]);
  });

  it('stores identifiers and versions without private source content', async () => {
    const persistence = new InMemoryKnowledgeOutboxPersistence();
    const repository = new KnowledgeOutboxRepository(persistence);
    await repository.enqueue(command);

    expect(JSON.stringify(persistence.snapshot())).not.toMatch(
      /contentText|excerpt|answerKey|conversation|email|phone|jwt|apiKey/i,
    );
  });

  it('leases batches and emits an idempotent ID/version-only queue payload', async () => {
    const persistence = new InMemoryKnowledgeOutboxPersistence();
    const repository = new KnowledgeOutboxRepository(persistence);
    const job = await repository.enqueue(command);
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const dispatcher = new KnowledgeOutboxDispatcher(
      repository,
      queue,
      () => new Date('2026-09-09T00:00:00.000Z'),
    );

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      dispatched: 1,
      failed: 0,
    });
    expect(queue.add).toHaveBeenCalledWith(
      KNOWLEDGE_INGESTION_JOB,
      {
        ingestionJobId: job.id,
        operation: 'UPSERT',
        contentVersion: 'content.v1',
        pipelineVersion: 'pipeline.v1',
      },
      expect.objectContaining({ jobId: job.id, attempts: 1 }),
    );
    expect(JSON.stringify(queue.add.mock.calls)).not.toMatch(
      /excerpt|contentText|answerKey|userId|email|phone/i,
    );
  });

  it('backs off a failed queue dispatch and reclaims only after the due time', async () => {
    const persistence = new InMemoryKnowledgeOutboxPersistence();
    const repository = new KnowledgeOutboxRepository(persistence);
    await repository.enqueue(command);
    const queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
    const dispatcher = new KnowledgeOutboxDispatcher(
      repository,
      queue,
      () => new Date('2026-09-09T00:00:00.000Z'),
    );
    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      dispatched: 0,
      failed: 1,
    });
    expect(persistence.snapshot()[0]).toMatchObject({
      status: 'RETRYABLE_FAILED',
      failureCode: 'QUEUE_DISPATCH_FAILED',
      nextAttemptAt: new Date('2026-09-09T00:00:01.000Z'),
    });
    await expect(
      repository.claimPending({
        now: new Date('2026-09-09T00:00:00.999Z'),
        leaseMs: 60_000,
        limit: 10,
      }),
    ).resolves.toEqual([]);
  });

  it('processes an ID-only job once and records durable completion', async () => {
    const persistence = new InMemoryKnowledgeOutboxPersistence();
    const repository = new KnowledgeOutboxRepository(persistence);
    const stored = await repository.enqueue(command);
    await repository.claimPending({
      now: new Date('2026-09-09T00:00:00.000Z'),
      leaseMs: 60_000,
      limit: 1,
    });
    const executor = { execute: jest.fn().mockResolvedValue(undefined) };
    const processor = new KnowledgeIngestionProcessor(
      repository,
      executor,
      () => new Date('2026-09-09T00:00:01.000Z'),
    );
    const data = parseKnowledgeQueuePayload({
      ingestionJobId: stored.id,
      operation: stored.operation,
      contentVersion: stored.contentVersion,
      pipelineVersion: stored.pipelineVersion,
    });
    const job = { id: stored.id, name: KNOWLEDGE_INGESTION_JOB, data } as never;
    await processor.process(job);
    await processor.process(job);
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(persistence.snapshot()[0]).toMatchObject({
      status: 'SUCCEEDED',
      failureCode: null,
    });
  });
});
