import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@libs/shared/generated/prisma/client';

export type KnowledgeIngestionOperation =
  | 'UPSERT'
  | 'REEMBED'
  | 'INVALIDATE'
  | 'PURGE';

export type KnowledgeOutboxCommand = Readonly<{
  operation: KnowledgeIngestionOperation;
  knowledgeSourceId: string;
  sourceRecordType: string;
  sourceRecordId: string;
  contentVersion: string | null;
  pipelineVersion: string;
  ownerUserId: string | null;
}>;

export type KnowledgeOutboxJob = KnowledgeOutboxCommand &
  Readonly<{
    id: string;
    status:
      | 'PENDING'
      | 'DISPATCHED'
      | 'RUNNING'
      | 'SUCCEEDED'
      | 'RETRYABLE_FAILED'
      | 'TERMINAL_FAILED'
      | 'CANCELLED';
    attemptCount: number;
    nextAttemptAt: Date | null;
    claimedAt: Date | null;
    finishedAt: Date | null;
    failureCode: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;

export interface KnowledgeOutboxPersistence {
  enqueue(command: KnowledgeOutboxCommand): Promise<KnowledgeOutboxJob>;
  claimPending(input: {
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<readonly KnowledgeOutboxJob[]>;
  findById(id: string): Promise<KnowledgeOutboxJob | null>;
  markRunning(id: string, now: Date): Promise<boolean>;
  markSucceeded(id: string, now: Date): Promise<void>;
  markFailed(input: {
    id: string;
    now: Date;
    retryable: boolean;
    failureCode: string;
    nextAttemptAt: Date | null;
  }): Promise<void>;
}

function idempotencyKey(command: KnowledgeOutboxCommand): string {
  return [
    command.operation,
    command.sourceRecordType,
    command.sourceRecordId,
    command.contentVersion ?? '__none__',
    command.pipelineVersion,
  ].join('\0');
}

// Promise-based interface methods resolve synchronously in this test adapter.
/* eslint-disable @typescript-eslint/require-await */
export class InMemoryKnowledgeOutboxPersistence implements KnowledgeOutboxPersistence {
  private readonly jobs = new Map<string, KnowledgeOutboxJob>();
  private readonly idsByKey = new Map<string, string>();

  async enqueue(command: KnowledgeOutboxCommand): Promise<KnowledgeOutboxJob> {
    const key = idempotencyKey(command);
    const existingId = this.idsByKey.get(key);
    if (existingId) return this.jobs.get(existingId)!;

    const now = new Date();
    const id = `kjob_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
    const job: KnowledgeOutboxJob = Object.freeze({
      ...command,
      id,
      status: 'PENDING',
      attemptCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      finishedAt: null,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    });
    this.jobs.set(id, job);
    this.idsByKey.set(key, id);
    return job;
  }

  async claimPending(input: {
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<readonly KnowledgeOutboxJob[]> {
    if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error('KNOWLEDGE_OUTBOX_LEASE_INVALID');
    }
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new Error('KNOWLEDGE_OUTBOX_LIMIT_INVALID');
    }
    const staleBefore = input.now.getTime() - input.leaseMs;
    const candidates = [...this.jobs.values()]
      .filter(
        (job) =>
          ((job.status === 'PENDING' || job.status === 'RETRYABLE_FAILED') &&
            (!job.nextAttemptAt || job.nextAttemptAt <= input.now)) ||
          (job.status === 'DISPATCHED' &&
            Boolean(job.claimedAt && job.claimedAt.getTime() <= staleBefore)),
      )
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, input.limit);

    return candidates.map((job) => {
      const claimed = Object.freeze({
        ...job,
        status: 'DISPATCHED' as const,
        attemptCount: job.attemptCount + 1,
        claimedAt: input.now,
        updatedAt: input.now,
      });
      this.jobs.set(job.id, claimed);
      return claimed;
    });
  }

  async findById(id: string): Promise<KnowledgeOutboxJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async markRunning(id: string, now: Date): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'DISPATCHED') return false;
    this.jobs.set(
      id,
      Object.freeze({ ...job, status: 'RUNNING', updatedAt: now }),
    );
    return true;
  }

  async markSucceeded(id: string, now: Date): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(
      id,
      Object.freeze({
        ...job,
        status: 'SUCCEEDED',
        nextAttemptAt: null,
        failureCode: null,
        finishedAt: now,
        updatedAt: now,
      }),
    );
  }

  async markFailed(input: {
    id: string;
    now: Date;
    retryable: boolean;
    failureCode: string;
    nextAttemptAt: Date | null;
  }): Promise<void> {
    const job = this.jobs.get(input.id);
    if (!job) return;
    this.jobs.set(
      input.id,
      Object.freeze({
        ...job,
        status: input.retryable
          ? ('RETRYABLE_FAILED' as const)
          : ('TERMINAL_FAILED' as const),
        failureCode: input.failureCode,
        nextAttemptAt: input.nextAttemptAt,
        finishedAt: input.retryable ? null : input.now,
        updatedAt: input.now,
      }) as KnowledgeOutboxJob,
    );
  }

  snapshot(): readonly KnowledgeOutboxJob[] {
    return Object.freeze([...this.jobs.values()]);
  }
}

/* eslint-enable @typescript-eslint/require-await */
type OutboxPrismaClient = Pick<
  PrismaClient,
  '$queryRaw' | '$executeRaw' | '$transaction' | 'knowledgeIngestionJob'
>;

export class PrismaKnowledgeOutboxPersistence implements KnowledgeOutboxPersistence {
  constructor(private readonly prisma: OutboxPrismaClient) {}

  async enqueue(command: KnowledgeOutboxCommand): Promise<KnowledgeOutboxJob> {
    const id = `kjob_${randomUUID().replaceAll('-', '')}`;
    const rows = await this.prisma.$queryRaw<KnowledgeOutboxJob[]>(Prisma.sql`
      WITH inserted AS (
        INSERT INTO "KnowledgeIngestionJob" (
          "id", "operation", "knowledgeSourceId", "sourceRecordType",
          "sourceRecordId", "contentVersion", "pipelineVersion", "ownerUserId",
          "status", "attemptCount", "createdAt", "updatedAt"
        ) VALUES (
          ${id}, CAST(${command.operation} AS "KnowledgeIngestionOperation"),
          ${command.knowledgeSourceId}, ${command.sourceRecordType},
          ${command.sourceRecordId}, ${command.contentVersion},
          ${command.pipelineVersion}, ${command.ownerUserId}, 'PENDING', 0, NOW(), NOW()
        )
        ON CONFLICT DO NOTHING
        RETURNING *
      )
      SELECT * FROM inserted
      UNION ALL
      SELECT * FROM "KnowledgeIngestionJob"
      WHERE "operation" = CAST(${command.operation} AS "KnowledgeIngestionOperation")
        AND "sourceRecordType" = ${command.sourceRecordType}
        AND "sourceRecordId" = ${command.sourceRecordId}
        AND "contentVersion" IS NOT DISTINCT FROM ${command.contentVersion}
        AND "pipelineVersion" = ${command.pipelineVersion}
      LIMIT 1
    `);
    if (!rows[0]) throw new Error('KNOWLEDGE_OUTBOX_ENQUEUE_FAILED');
    return rows[0];
  }

  async claimPending(input: {
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<readonly KnowledgeOutboxJob[]> {
    if (
      !Number.isInteger(input.leaseMs) ||
      input.leaseMs <= 0 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new Error('KNOWLEDGE_OUTBOX_CLAIM_INVALID');
    }
    const staleBefore = new Date(input.now.getTime() - input.leaseMs);
    return this.prisma.$queryRaw<KnowledgeOutboxJob[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "KnowledgeIngestionJob"
        WHERE (
          ("status" IN ('PENDING', 'RETRYABLE_FAILED') AND
            ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${input.now}))
          OR
          ("status" = 'DISPATCHED' AND "claimedAt" <= ${staleBefore})
        )
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.limit}
      )
      UPDATE "KnowledgeIngestionJob" AS job
      SET "status" = 'DISPATCHED',
          "attemptCount" = job."attemptCount" + 1,
          "claimedAt" = ${input.now},
          "updatedAt" = ${input.now}
      FROM candidates
      WHERE job."id" = candidates."id"
      RETURNING job.*
    `);
  }

  async findById(id: string): Promise<KnowledgeOutboxJob | null> {
    return this.prisma.knowledgeIngestionJob.findUnique({
      where: { id },
    }) as Promise<KnowledgeOutboxJob | null>;
  }

  async markRunning(id: string, now: Date): Promise<boolean> {
    return (
      (
        await this.prisma.knowledgeIngestionJob.updateMany({
          where: { id, status: 'DISPATCHED' },
          data: { status: 'RUNNING', updatedAt: now },
        })
      ).count === 1
    );
  }

  async markSucceeded(id: string, now: Date): Promise<void> {
    await this.prisma.knowledgeIngestionJob.updateMany({
      where: { id, status: 'RUNNING' },
      data: {
        status: 'SUCCEEDED',
        nextAttemptAt: null,
        failureCode: null,
        finishedAt: now,
        updatedAt: now,
      },
    });
  }

  async markFailed(input: {
    id: string;
    now: Date;
    retryable: boolean;
    failureCode: string;
    nextAttemptAt: Date | null;
  }): Promise<void> {
    await this.prisma.knowledgeIngestionJob.updateMany({
      where: {
        id: input.id,
        status: { in: ['DISPATCHED', 'RUNNING'] },
      },
      data: {
        status: input.retryable ? 'RETRYABLE_FAILED' : 'TERMINAL_FAILED',
        failureCode: input.failureCode.slice(0, 64),
        nextAttemptAt: input.retryable ? input.nextAttemptAt : null,
        finishedAt: input.retryable ? null : input.now,
        updatedAt: input.now,
      },
    });
  }
}

export class KnowledgeOutboxRepository {
  constructor(private readonly persistence: KnowledgeOutboxPersistence) {}

  enqueue(command: KnowledgeOutboxCommand): Promise<KnowledgeOutboxJob> {
    if (
      !command.knowledgeSourceId.trim() ||
      !command.sourceRecordType.trim() ||
      !command.sourceRecordId.trim() ||
      !command.pipelineVersion.trim() ||
      ((command.operation === 'UPSERT' || command.operation === 'REEMBED') &&
        !command.contentVersion?.trim())
    ) {
      throw new Error('KNOWLEDGE_OUTBOX_COMMAND_INVALID');
    }
    return this.persistence.enqueue(command);
  }

  claimPending(input: {
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<readonly KnowledgeOutboxJob[]> {
    return this.persistence.claimPending(input);
  }

  findById(id: string): Promise<KnowledgeOutboxJob | null> {
    return this.persistence.findById(id);
  }

  markRunning(id: string, now: Date): Promise<boolean> {
    return this.persistence.markRunning(id, now);
  }

  markSucceeded(id: string, now: Date): Promise<void> {
    return this.persistence.markSucceeded(id, now);
  }

  markFailed(input: {
    id: string;
    now: Date;
    retryable: boolean;
    failureCode: string;
    nextAttemptAt: Date | null;
  }): Promise<void> {
    return this.persistence.markFailed(input);
  }
}
