import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  MCP_SCHEMA_VERSION,
  mcpSubmitAnswerSuccessSchema,
} from '@en/common/mcp';
import { z } from '@en/common/coach/zod';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import type { McpPersistenceIdentity } from '../persistence/mcp-subject.repository';

const REQUIRED_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type McpSubmitReconciliationIntent = Readonly<{
  id: string;
  status: 'PROCESSING' | 'RECONCILING' | 'COMPLETED';
  createdAt: Date;
  leaseExpiresAt: Date | null;
  exerciseId: string;
  confirmationId: string;
  clientKeyDigest: string;
  requestFingerprint: string;
  safeTerminalProjection: unknown;
}>;

export type McpCommittedSubmitResult = Readonly<{
  submissionId: string;
  attemptId: string;
  gradingHash: string;
  safeTerminalProjection: unknown;
}>;

export interface McpSubmitReconciliationRepositoryPort {
  loadOwnedIntent(
    identity: McpPersistenceIdentity,
    intentId: string,
  ): Promise<McpSubmitReconciliationIntent | null>;
  findCommittedByBusinessKeys(
    identity: McpPersistenceIdentity,
    keys: Readonly<{
      exerciseId: string;
      clientKeyDigest: string;
      requestFingerprint: string;
    }>,
  ): Promise<McpCommittedSubmitResult | null>;
  completeRecovered(
    identity: McpPersistenceIdentity,
    input: Readonly<{
      intentId: string;
      confirmationId: string;
      submissionId: string;
      attemptId: string;
      safeTerminalProjection: unknown;
      now: Date;
    }>,
  ): Promise<void>;
  markRetryable(
    identity: McpPersistenceIdentity,
    intentId: string,
    now: Date,
  ): Promise<void>;
  cleanupExpiredOrFailed?(olderThan: Date, limit: number): Promise<number>;
}

export type McpSubmitReconciliationResult = Readonly<{
  status: 'recovered' | 'already_completed' | 'retryable' | 'in_progress';
  result?: unknown;
}>;

export class McpSubmitReconciliationError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'CANCELLED'
      | 'STATE_CONFLICT'
      | 'DEPENDENCY_UNAVAILABLE',
    readonly retryable = false,
  ) {
    super('The submit operation could not be reconciled.');
    this.name = 'McpSubmitReconciliationError';
  }
}

function assertOpen(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new McpSubmitReconciliationError('CANCELLED');
  }
}

function validIdentity(identity: McpPersistenceIdentity): boolean {
  return Boolean(
    identity?.issuer &&
    identity.subjectHmac &&
    identity.userId &&
    identity.authorizationId &&
    identity.clientId &&
    identity.audience &&
    Number.isSafeInteger(identity.authorizationVersion) &&
    identity.authorizationVersion > 0,
  );
}

@Injectable()
export class McpSubmitReconciliationService {
  constructor(
    private readonly repository: McpSubmitReconciliationRepositoryPort,
    private readonly options: Readonly<{ recoveryWindowMs: number }>,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (options.recoveryWindowMs !== REQUIRED_RECOVERY_WINDOW_MS) {
      throw new McpSubmitReconciliationError('VALIDATION_FAILED');
    }
  }

  async reconcile(
    identity: McpPersistenceIdentity,
    intentId: string,
    execution?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<McpSubmitReconciliationResult> {
    if (
      !validIdentity(identity) ||
      typeof intentId !== 'string' ||
      intentId.length < 1 ||
      intentId.length > 128
    ) {
      throw new McpSubmitReconciliationError('VALIDATION_FAILED');
    }
    assertOpen(execution?.signal);
    const currentTime = this.now();
    const intent = await this.repository.loadOwnedIntent(identity, intentId);
    if (!intent) throw new McpSubmitReconciliationError('RESOURCE_NOT_FOUND');
    assertOpen(execution?.signal);
    if (intent.status === 'COMPLETED') {
      if (
        !mcpSubmitAnswerSuccessSchema.safeParse(intent.safeTerminalProjection)
          .success
      ) {
        throw new McpSubmitReconciliationError('STATE_CONFLICT');
      }
      return Object.freeze({
        status: 'already_completed' as const,
        result: intent.safeTerminalProjection,
      });
    }
    if (
      intent.status === 'PROCESSING' &&
      intent.leaseExpiresAt !== null &&
      intent.leaseExpiresAt > currentTime
    ) {
      return Object.freeze({ status: 'in_progress' as const });
    }
    if (
      currentTime.getTime() - intent.createdAt.getTime() >
      this.options.recoveryWindowMs
    ) {
      assertOpen(execution?.signal);
      await this.repository.markRetryable(identity, intent.id, currentTime);
      return Object.freeze({ status: 'retryable' as const });
    }
    assertOpen(execution?.signal);
    const committed = await this.repository.findCommittedByBusinessKeys(
      identity,
      {
        exerciseId: intent.exerciseId,
        clientKeyDigest: intent.clientKeyDigest,
        requestFingerprint: intent.requestFingerprint,
      },
    );
    assertOpen(execution?.signal);
    if (!committed) {
      await this.repository.markRetryable(identity, intent.id, currentTime);
      return Object.freeze({ status: 'retryable' as const });
    }
    if (
      !/^[a-f0-9]{64}$/u.test(committed.gradingHash) ||
      !mcpSubmitAnswerSuccessSchema.safeParse(committed.safeTerminalProjection)
        .success
    ) {
      throw new McpSubmitReconciliationError('STATE_CONFLICT');
    }
    await this.repository.completeRecovered(identity, {
      intentId: intent.id,
      confirmationId: intent.confirmationId,
      submissionId: committed.submissionId,
      attemptId: committed.attemptId,
      safeTerminalProjection: committed.safeTerminalProjection,
      now: currentTime,
    });
    return Object.freeze({
      status: 'recovered' as const,
      result: committed.safeTerminalProjection,
    });
  }

  async cleanup(): Promise<number> {
    if (!this.repository.cleanupExpiredOrFailed) return 0;
    const current = this.now();
    return this.repository.cleanupExpiredOrFailed(
      new Date(current.getTime() - this.options.recoveryWindowMs),
      500,
    );
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function ownedAuthorization(identity: McpPersistenceIdentity) {
  return {
    id: identity.authorizationId,
    userId: identity.userId,
    issuer: identity.issuer,
    audience: identity.audience,
    clientId: identity.clientId,
    authorizationVersion: identity.authorizationVersion,
    status: 'ACTIVE' as const,
    subjectMapping: {
      issuer: identity.issuer,
      subjectHmac: identity.subjectHmac,
      userId: identity.userId,
      status: 'ACTIVE' as const,
    },
  };
}

const storedGradeSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    gradingHash: z.string().regex(/^[a-f0-9]{64}$/u),
    items: z
      .array(
        z
          .object({
            itemId: z.string().min(1).max(64),
            score: z.number().int().min(0).max(100),
            correction: z.string().max(4_000),
            explanation: z.string().min(1).max(4_000),
            errorTypes: z.array(z.string().max(64)).max(11),
          })
          .passthrough(),
      )
      .min(1)
      .max(50),
  })
  .passthrough();

@Injectable()
export class PrismaMcpSubmitReconciliationRepository implements McpSubmitReconciliationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async loadOwnedIntent(
    identity: McpPersistenceIdentity,
    intentId: string,
  ): Promise<McpSubmitReconciliationIntent | null> {
    const intent = await this.prisma.mcpIdempotencyIntent.findFirst({
      where: {
        id: intentId,
        userId: identity.userId,
        authorizationId: identity.authorizationId,
        issuer: identity.issuer,
        clientId: identity.clientId,
        toolName: 'SUBMIT_ANSWER',
        status: { in: ['PROCESSING', 'RECONCILING', 'COMPLETED'] },
        authorization: ownedAuthorization(identity),
      },
      include: { confirmation: { select: { id: true } } },
    });
    if (!intent || !intent.exerciseId || !intent.confirmation) return null;
    return {
      id: intent.id,
      status: intent.status as McpSubmitReconciliationIntent['status'],
      createdAt: intent.createdAt,
      leaseExpiresAt: intent.leaseExpiresAt,
      exerciseId: intent.exerciseId,
      confirmationId: intent.confirmation.id,
      clientKeyDigest: intent.clientKeyDigest,
      requestFingerprint: intent.requestFingerprint,
      safeTerminalProjection: intent.safeTerminalProjection,
    };
  }

  async findCommittedByBusinessKeys(
    identity: McpPersistenceIdentity,
    keys: Readonly<{
      exerciseId: string;
      clientKeyDigest: string;
      requestFingerprint: string;
    }>,
  ): Promise<McpCommittedSubmitResult | null> {
    const intent = await this.prisma.mcpIdempotencyIntent.findFirst({
      where: {
        userId: identity.userId,
        authorizationId: identity.authorizationId,
        issuer: identity.issuer,
        clientId: identity.clientId,
        toolName: 'SUBMIT_ANSWER',
        exerciseId: keys.exerciseId,
        clientKeyDigest: keys.clientKeyDigest,
        requestFingerprint: keys.requestFingerprint,
        authorization: ownedAuthorization(identity),
      },
      select: { createdAt: true, safeTerminalProjection: true },
    });
    if (!intent) return null;
    const candidates = await this.prisma.exerciseSubmission.findMany({
      where: {
        userId: identity.userId,
        exerciseId: keys.exerciseId,
        status: 'SAVED',
        createdAt: { gte: intent.createdAt },
        attempt: { isNot: null },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: {
        attempt: {
          include: {
            reviewEvents: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    const submission = candidates.find(
      (candidate) =>
        digest(candidate.clientIdempotencyKey) === keys.clientKeyDigest,
    );
    if (!submission?.attempt || !submission.gradingHash) return null;
    const grade = storedGradeSchema.safeParse(submission.gradingResult);
    if (!grade.success || grade.data.gradingHash !== submission.gradingHash) {
      return null;
    }
    const stored = mcpSubmitAnswerSuccessSchema.safeParse(
      intent.safeTerminalProjection,
    );
    const safeTerminalProjection = stored.success
      ? stored.data
      : mcpSubmitAnswerSuccessSchema.parse({
          schemaVersion: MCP_SCHEMA_VERSION,
          ok: true,
          submissionId: submission.id,
          attemptId: submission.attempt.id,
          saveStatus: 'saved',
          score: grade.data.score,
          items: grade.data.items.map((item) => ({
            itemId: item.itemId,
            score: item.score,
            correction: item.correction,
            explanation: item.explanation,
            errorTypes: item.errorTypes,
          })),
          learningChanges: submission.attempt.reviewEvents.map((event) => {
            const previous = z
              .object({ reviewState: z.string().max(64) })
              .passthrough()
              .parse(event.previousState);
            const next = z
              .object({
                reviewState: z.string().max(64),
                dueAt: z.string().datetime().optional(),
              })
              .passthrough()
              .parse(event.nextState);
            return {
              targetType: event.targetType,
              targetKey: event.targetKey,
              previousState: previous.reviewState,
              nextState: next.reviewState,
              nextReviewAt: next.dueAt ?? null,
            };
          }),
          traceId: `reconciled_${submission.id}`.slice(0, 128),
        });
    return {
      submissionId: submission.id,
      attemptId: submission.attempt.id,
      gradingHash: submission.gradingHash,
      safeTerminalProjection,
    };
  }

  async completeRecovered(
    identity: McpPersistenceIdentity,
    input: Readonly<{
      intentId: string;
      confirmationId: string;
      submissionId: string;
      attemptId: string;
      safeTerminalProjection: unknown;
      now: Date;
    }>,
  ): Promise<void> {
    await this.prisma.$transaction(async (database) => {
      const confirmation = await database.mcpWriteConfirmation.updateMany({
        where: {
          id: input.confirmationId,
          idempotencyIntentId: input.intentId,
          userId: identity.userId,
          authorizationId: identity.authorizationId,
          issuer: identity.issuer,
          clientId: identity.clientId,
          state: { in: ['CLAIMED', 'CONSUMED'] },
        },
        data: {
          state: 'CONSUMED',
          consumedAt: input.now,
          updatedAt: input.now,
        },
      });
      if (confirmation.count !== 1) {
        throw new McpSubmitReconciliationError('STATE_CONFLICT');
      }
      const completed = await database.mcpIdempotencyIntent.updateMany({
        where: {
          id: input.intentId,
          userId: identity.userId,
          authorizationId: identity.authorizationId,
          issuer: identity.issuer,
          clientId: identity.clientId,
          toolName: 'SUBMIT_ANSWER',
          status: { in: ['PROCESSING', 'RECONCILING'] },
        },
        data: {
          status: 'COMPLETED',
          submissionId: input.submissionId,
          learningAttemptId: input.attemptId,
          safeTerminalProjection:
            input.safeTerminalProjection as Prisma.InputJsonValue,
          safeErrorCode: null,
          leaseOwnerHmac: null,
          leaseExpiresAt: null,
          finishedAt: input.now,
          updatedAt: input.now,
        },
      });
      if (completed.count !== 1) {
        throw new McpSubmitReconciliationError('STATE_CONFLICT');
      }
    });
  }

  async markRetryable(
    identity: McpPersistenceIdentity,
    intentId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (database) => {
      const failed = await database.mcpIdempotencyIntent.updateMany({
        where: {
          id: intentId,
          userId: identity.userId,
          authorizationId: identity.authorizationId,
          issuer: identity.issuer,
          clientId: identity.clientId,
          toolName: 'SUBMIT_ANSWER',
          status: { in: ['PROCESSING', 'RECONCILING'] },
        },
        data: {
          status: 'FAILED_RETRYABLE',
          safeErrorCode: 'RECONFIRM_REQUIRED',
          leaseOwnerHmac: null,
          leaseExpiresAt: null,
          updatedAt: now,
        },
      });
      if (failed.count !== 1) {
        throw new McpSubmitReconciliationError('STATE_CONFLICT');
      }
      await database.mcpWriteConfirmation.updateMany({
        where: {
          idempotencyIntentId: intentId,
          state: { in: ['PENDING', 'CONFIRMED', 'CLAIMED'] },
        },
        data: { state: 'FAILED', updatedAt: now },
      });
    });
  }

  async cleanupExpiredOrFailed(
    olderThan: Date,
    limit: number,
  ): Promise<number> {
    const candidates = await this.prisma.mcpWriteConfirmation.findMany({
      where: {
        OR: [
          {
            expiresAt: { lte: olderThan },
            state: { in: ['PENDING', 'CONFIRMED'] },
          },
          {
            updatedAt: { lte: olderThan },
            state: { in: ['FAILED', 'EXPIRED'] },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.min(500, Math.max(1, limit)),
      select: { id: true },
    });
    if (candidates.length === 0) return 0;
    const updated = await this.prisma.mcpWriteConfirmation.updateMany({
      where: {
        id: { in: candidates.map(({ id }) => id) },
        state: { in: ['PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED'] },
      },
      data: { state: 'EXPIRED', updatedAt: new Date() },
    });
    return updated.count;
  }
}
