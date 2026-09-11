import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  MCP_SCHEMA_VERSION,
  mcpSubmitAnswerSuccessSchema,
} from '@en/common/mcp';
import { errorTypeSchema } from '@en/common/coach';
import { z } from '@en/common/coach/zod';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import {
  aggregateLowestQuality,
  scheduleSm2Review,
  type Sm2ReviewState,
} from '../review/sm2-review-scheduler';
import { gradingDigest } from '../grading/grading.service';

export type McpSubmitIdentity = Readonly<{
  issuer: string;
  subjectHmac: string;
  userId: string;
  authorizationId: string;
  clientId: string;
  audience: string;
  authorizationVersion: number;
}>;

const answerSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    response: z.union([
      z.string().min(1).max(4_000),
      z.array(z.string().min(1).max(1_000)).min(1).max(20),
    ]),
  })
  .strict();

const gradingItemSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    isCorrect: z.boolean().optional(),
    score: z.number().int().min(0).max(100),
    correction: z.string().max(4_000),
    explanation: z.string().min(1).max(4_000),
    errorTypes: z.array(errorTypeSchema).max(11),
    examples: z.array(z.string().min(1).max(2_000)).max(8).optional(),
    targetQualities: z
      .array(
        z
          .object({
            targetType: z.enum(['WORD', 'ERROR_TYPE']),
            targetKey: z.string().min(1).max(128),
            quality: z.number().int().min(0).max(5),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

const learningChangeSchema = z
  .object({
    targetType: z.string().min(1).max(64),
    targetKey: z.string().min(1).max(128),
    previousState: z.string().max(64),
    nextState: z.string().max(64),
    nextReviewAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

const finalizeInputSchema = z
  .object({
    schemaVersion: z.literal(MCP_SCHEMA_VERSION),
    intentId: z.string().min(1).max(128),
    confirmationId: z.string().min(1).max(128),
    exerciseId: z.string().min(10).max(64),
    exerciseVersion: z.string().min(1).max(128),
    answers: z.array(answerSchema).min(1).max(50),
    idempotencyKey: z.string().min(16).max(128),
    grading: z
      .object({
        submissionId: z.string().min(10).max(64),
        gradeRequestId: z.string().min(10).max(64).optional(),
        stagingHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        gradingHash: z.string().regex(/^[a-f0-9]{64}$/u),
        score: z.number().int().min(0).max(100),
        items: z.array(gradingItemSchema).min(1).max(50),
        learningChanges: z.array(learningChangeSchema).max(50),
      })
      .strict(),
    traceId: z.string().min(1).max(128),
    intentRequestFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    answerDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    operationSummaryDigest: z
      .string()
      .regex(/^[a-f0-9]{32,128}$/u)
      .optional(),
    scopeSnapshotDigest: z
      .string()
      .regex(/^[a-f0-9]{32,128}$/u)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const answerIds = value.answers.map(({ itemId }) => itemId);
    const gradingIds = value.grading.items.map(({ itemId }) => itemId);
    if (
      new Set(answerIds).size !== answerIds.length ||
      new Set(gradingIds).size !== gradingIds.length ||
      answerIds.length !== gradingIds.length ||
      answerIds.some((itemId) => !gradingIds.includes(itemId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['answers'],
        message: 'Answer and grading item bindings must match exactly',
      });
    }
  });

export type McpSubmitAnswerFinalizeInput = z.infer<typeof finalizeInputSchema>;
export type McpSubmitAnswerFinalizeCommand = McpSubmitAnswerFinalizeInput &
  Readonly<{ requestFingerprint: string }>;
export type McpSubmitAnswerFinalizeResult = Omit<
  z.infer<typeof mcpSubmitAnswerSuccessSchema>,
  'submissionId' | 'attemptId' | 'saveStatus' | 'saveFailure'
> &
  Readonly<{
    submissionId: string;
    attemptId: string;
    saveStatus: 'saved' | 'replayed';
  }>;

export interface McpSubmitAnswerRepositoryPort {
  finalizeAtomic(
    identity: McpSubmitIdentity,
    command: McpSubmitAnswerFinalizeCommand,
  ): Promise<McpSubmitAnswerFinalizeResult>;
}

export class McpSubmitAnswerError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'IDEMPOTENCY_CONFLICT'
      | 'CONFIRMATION_EXPIRED'
      | 'CONFIRMATION_STATE_CONFLICT'
      | 'STATE_CONFLICT'
      | 'CANCELLED'
      | 'DEPENDENCY_UNAVAILABLE',
    readonly retryable = false,
  ) {
    super('The confirmed answer could not be saved.');
    this.name = 'McpSubmitAnswerError';
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function requestFingerprint(input: McpSubmitAnswerFinalizeInput): string {
  const answers = [...input.answers].sort((left, right) =>
    left.itemId.localeCompare(right.itemId),
  );
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          schemaVersion: input.schemaVersion,
          intentId: input.intentId,
          confirmationId: input.confirmationId,
          exerciseId: input.exerciseId,
          exerciseVersion: input.exerciseVersion,
          answers,
          idempotencyKey: input.idempotencyKey,
          gradingHash: input.grading.gradingHash,
        }),
      ),
    )
    .digest('hex');
}

function assertIdentity(identity: McpSubmitIdentity): void {
  if (
    !identity ||
    !identity.userId ||
    !identity.authorizationId ||
    !identity.issuer ||
    !identity.subjectHmac ||
    !identity.clientId ||
    !identity.audience ||
    !Number.isSafeInteger(identity.authorizationVersion) ||
    identity.authorizationVersion < 1
  ) {
    throw new McpSubmitAnswerError('VALIDATION_FAILED');
  }
}

@Injectable()
export class McpSubmitAnswerService {
  constructor(private readonly repository: McpSubmitAnswerRepositoryPort) {}

  async finalizeConfirmed(
    identity: McpSubmitIdentity,
    untrustedInput: unknown,
  ): Promise<McpSubmitAnswerFinalizeResult> {
    assertIdentity(identity);
    const parsed = finalizeInputSchema.safeParse(untrustedInput);
    if (!parsed.success) {
      throw new McpSubmitAnswerError('VALIDATION_FAILED');
    }
    const result = await this.repository.finalizeAtomic(identity, {
      ...parsed.data,
      requestFingerprint: requestFingerprint(parsed.data),
    });
    const safe = mcpSubmitAnswerSuccessSchema.safeParse(result);
    if (
      !safe.success ||
      (safe.data.saveStatus !== 'saved' && safe.data.saveStatus !== 'replayed')
    ) {
      throw new McpSubmitAnswerError('STATE_CONFLICT');
    }
    return safe.data as McpSubmitAnswerFinalizeResult;
  }
}

const stagedSubmitGradingSchema = z
  .object({
    schemaVersion: z.literal('mcp.submit-preparation.v1'),
    exerciseId: z.string().min(10).max(64),
    exerciseVersion: z.string().min(1).max(128),
    gradeRequestId: z.string().min(10).max(64),
    answerVersion: z.string().min(32).max(128),
    gradingHash: z.string().regex(/^[a-f0-9]{64}$/u),
    score: z.number().int().min(0).max(100),
    correction: z.string().max(4_000),
    explanation: z.string().min(1).max(12_000),
    examples: z.array(z.string().min(1).max(2_000)).max(8),
    errorTypes: z.array(errorTypeSchema).max(11),
    items: z
      .array(
        gradingItemSchema.superRefine((item, context) => {
          if (!item.targetQualities?.length) {
            context.addIssue({
              code: 'custom',
              path: ['targetQualities'],
              message: 'A staged item must contain owned learning targets',
            });
          }
        }),
      )
      .min(1)
      .max(50),
  })
  .strict();

type StagedSubmitGrading = z.infer<typeof stagedSubmitGradingSchema>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function mcpSubmitAnswerDigest(
  answers: readonly Readonly<{
    itemId: string;
    response: string | readonly string[];
  }>[],
): string {
  return sha256(
    JSON.stringify(
      canonical(
        [...answers]
          .sort((left, right) => left.itemId.localeCompare(right.itemId))
          .map(({ itemId, response }) => ({ itemId, response })),
      ),
    ),
  );
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stateSnapshot(state: Sm2ReviewState): Prisma.InputJsonValue {
  return asJson({
    reviewState: state.reviewState,
    repetitionCount: state.repetitionCount,
    easeFactor: state.easeFactor,
    intervalDays: state.intervalDays,
    ...(state.dueAt ? { dueAt: state.dueAt.toISOString() } : {}),
  });
}

function ownedAuthorization(identity: McpSubmitIdentity) {
  return {
    id: identity.authorizationId,
    userId: identity.userId,
    issuer: identity.issuer,
    audience: identity.audience,
    clientId: identity.clientId,
    authorizationVersion: identity.authorizationVersion,
    status: 'ACTIVE' as const,
    scopes: { has: 'answer:submit' },
    subjectMapping: {
      issuer: identity.issuer,
      subjectHmac: identity.subjectHmac,
      userId: identity.userId,
      status: 'ACTIVE' as const,
    },
  };
}

function replayProjection(
  value: unknown,
  traceId: string,
): McpSubmitAnswerFinalizeResult | null {
  const parsed = mcpSubmitAnswerSuccessSchema.safeParse(value);
  if (
    !parsed.success ||
    (parsed.data.saveStatus !== 'saved' &&
      parsed.data.saveStatus !== 'replayed')
  ) {
    return null;
  }
  return mcpSubmitAnswerSuccessSchema.parse({
    ...parsed.data,
    saveStatus: 'replayed',
    traceId,
  }) as McpSubmitAnswerFinalizeResult;
}

function transactionError(code: McpSubmitAnswerError['code']): never {
  throw new McpSubmitAnswerError(
    code,
    code === 'DEPENDENCY_UNAVAILABLE' || code === 'CANCELLED',
  );
}

@Injectable()
export class PrismaMcpSubmitAnswerRepository implements McpSubmitAnswerRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly now: () => Date = () => new Date(),
    private readonly createAttemptId: () => string = () =>
      `attempt_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    private readonly createReviewEventId: () => string = () =>
      `review_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
  ) {}

  async finalizeAtomic(
    identity: McpSubmitIdentity,
    command: McpSubmitAnswerFinalizeCommand,
  ): Promise<McpSubmitAnswerFinalizeResult> {
    const committedAt = this.now();
    try {
      return await this.prisma.$transaction(
        async (database) => {
          const lockedIntent = await database.$queryRaw<
            readonly { id: string }[]
          >(
            Prisma.sql`SELECT "id" FROM "McpIdempotencyIntent" WHERE "id" = ${command.intentId} FOR UPDATE`,
          );
          if (lockedIntent.length !== 1) transactionError('RESOURCE_NOT_FOUND');
          const intent = await database.mcpIdempotencyIntent.findFirst({
            where: {
              id: command.intentId,
              userId: identity.userId,
              authorizationId: identity.authorizationId,
              issuer: identity.issuer,
              clientId: identity.clientId,
              toolName: 'SUBMIT_ANSWER',
              authorization: ownedAuthorization(identity),
            },
          });
          if (!intent) transactionError('RESOURCE_NOT_FOUND');
          if (
            intent.clientKeyDigest !== sha256(command.idempotencyKey) ||
            (command.intentRequestFingerprint !== undefined &&
              intent.requestFingerprint !== command.intentRequestFingerprint)
          ) {
            transactionError('IDEMPOTENCY_CONFLICT');
          }
          if (intent.status === 'COMPLETED') {
            const replay = replayProjection(
              intent.safeTerminalProjection,
              command.traceId,
            );
            if (
              !replay ||
              replay.submissionId !== intent.submissionId ||
              replay.attemptId !== intent.learningAttemptId
            ) {
              transactionError('STATE_CONFLICT');
            }
            return replay;
          }
          if (intent.status !== 'PROCESSING') {
            transactionError('CONFIRMATION_STATE_CONFLICT');
          }
          const staged = stagedSubmitGradingSchema.safeParse(
            intent.gradingResult,
          );
          if (!staged.success || !intent.gradingResultHash) {
            transactionError('STATE_CONFLICT');
          }
          const stagedHash = sha256(JSON.stringify(canonical(staged.data)));
          if (
            stagedHash !== intent.gradingResultHash ||
            (command.grading.stagingHash !== undefined &&
              command.grading.stagingHash !== stagedHash) ||
            staged.data.exerciseId !== command.exerciseId ||
            staged.data.exerciseVersion !== command.exerciseVersion ||
            staged.data.gradingHash !== command.grading.gradingHash ||
            staged.data.score !== command.grading.score
          ) {
            transactionError('STATE_CONFLICT');
          }

          const lockedConfirmation = await database.$queryRaw<
            readonly { id: string }[]
          >(
            Prisma.sql`SELECT "id" FROM "McpWriteConfirmation" WHERE "id" = ${command.confirmationId} FOR UPDATE`,
          );
          if (lockedConfirmation.length !== 1) {
            transactionError('RESOURCE_NOT_FOUND');
          }
          const confirmation = await database.mcpWriteConfirmation.findFirst({
            where: {
              id: command.confirmationId,
              idempotencyIntentId: command.intentId,
              userId: identity.userId,
              authorizationId: identity.authorizationId,
              issuer: identity.issuer,
              clientId: identity.clientId,
              requiredScope: 'answer:submit',
              authorization: ownedAuthorization(identity),
            },
          });
          if (!confirmation) transactionError('RESOURCE_NOT_FOUND');
          if (confirmation.expiresAt <= committedAt) {
            transactionError('CONFIRMATION_EXPIRED');
          }
          const answerDigest = mcpSubmitAnswerDigest(command.answers);
          if (
            confirmation.state !== 'CONFIRMED' ||
            confirmation.exerciseId !== command.exerciseId ||
            confirmation.exerciseVersion !== command.exerciseVersion ||
            confirmation.answerDigest !== answerDigest ||
            (command.answerDigest !== undefined &&
              command.answerDigest !== answerDigest) ||
            (command.operationSummaryDigest !== undefined &&
              confirmation.operationSummaryDigest !==
                command.operationSummaryDigest) ||
            (command.scopeSnapshotDigest !== undefined &&
              confirmation.scopeSnapshotDigest !== command.scopeSnapshotDigest)
          ) {
            transactionError('CONFIRMATION_STATE_CONFLICT');
          }

          const exercise = await database.exercise.findFirst({
            where: {
              id: command.exerciseId,
              userId: identity.userId,
              status: { in: ['READY', 'GRADED'] },
              expiresAt: { gt: committedAt },
            },
            include: {
              items: {
                orderBy: { position: 'asc' },
                include: { targets: true },
              },
            },
          });
          if (!exercise) transactionError('RESOURCE_NOT_FOUND');
          const currentExerciseVersion = gradingDigest({
            schemaVersion: exercise.schemaVersion,
            type: exercise.type,
            items: exercise.items.map((item) => ({
              id: item.id,
              position: item.position,
              prompt: item.prompt,
              choices: item.choices,
              answerKey: item.answerKey,
              gradingRubric: item.gradingRubric,
              maxScore: item.maxScore,
              citations: item.citations,
              targets: item.targets.map((target) => ({
                targetType: target.targetType,
                targetKey: target.targetKey,
                weight: Number(target.weight),
              })),
            })),
          });
          if (currentExerciseVersion !== command.exerciseVersion) {
            transactionError('STATE_CONFLICT');
          }
          const exerciseItems = new Map(
            exercise.items.map((item) => [item.id, item]),
          );
          if (
            command.answers.length !== exercise.items.length ||
            command.answers.some(({ itemId }) => !exerciseItems.has(itemId)) ||
            staged.data.items.some(({ itemId }) => !exerciseItems.has(itemId))
          ) {
            transactionError('STATE_CONFLICT');
          }

          const claimed = await database.mcpWriteConfirmation.updateMany({
            where: {
              id: confirmation.id,
              state: 'CONFIRMED',
              expiresAt: { gt: committedAt },
              idempotencyIntentId: command.intentId,
              exerciseId: command.exerciseId,
              exerciseVersion: command.exerciseVersion,
              answerDigest,
            },
            data: {
              state: 'CLAIMED',
              claimedAt: committedAt,
              updatedAt: committedAt,
            },
          });
          if (claimed.count !== 1) {
            transactionError('CONFIRMATION_STATE_CONFLICT');
          }

          const gradeRequest = await database.coachRequest.updateMany({
            where: {
              id: staged.data.gradeRequestId,
              userId: identity.userId,
              clientRequestKey: { startsWith: 'mcp_' },
              inputType: 'RECOMMENDATION',
              intent: 'GRADE_ANSWER',
              cancelRequestedAt: null,
              conversation: { origin: 'MCP' },
            },
            data: {
              exerciseId: command.exerciseId,
              answerVersion: staged.data.answerVersion,
              updatedAt: committedAt,
            },
          });
          if (gradeRequest.count !== 1) transactionError('RESOURCE_NOT_FOUND');

          const answerByItem = new Map(
            command.answers.map(({ itemId, response }) => [itemId, response]),
          );
          await database.exerciseSubmission.create({
            data: {
              id: command.grading.submissionId,
              userId: identity.userId,
              exerciseId: command.exerciseId,
              gradeRequestId: staged.data.gradeRequestId,
              answerVersion: staged.data.answerVersion,
              clientIdempotencyKey: command.idempotencyKey,
              answers: asJson(command.answers),
              status: 'SAVED',
              score: staged.data.score,
              gradingHash: staged.data.gradingHash,
              resultSchemaVersion: 'coach.tool.v1',
              gradingResult: asJson({
                status: 'GRADED_VALID',
                answerVersion: staged.data.answerVersion,
                gradingHash: staged.data.gradingHash,
                score: staged.data.score,
                correction: staged.data.correction,
                explanation: staged.data.explanation,
                examples: staged.data.examples,
                errorTypes: staged.data.errorTypes,
                items: staged.data.items,
              }),
              items: {
                create: staged.data.items.map((item) => ({
                  exerciseItemId: item.itemId,
                  answer: asJson(answerByItem.get(item.itemId)),
                  isCorrect: item.isCorrect ?? null,
                  score: item.score,
                  correction: item.correction,
                  explanation: item.explanation,
                  errorTypes: asJson(item.errorTypes),
                  targetQualities: asJson(item.targetQualities),
                })),
              },
            },
          });

          const profile = await database.learnerProfile.findUnique({
            where: { userId: identity.userId },
            select: { timezone: true },
          });
          const grouped = new Map<
            string,
            {
              targetType: 'WORD' | 'ERROR_TYPE';
              targetKey: string;
              wordId: string | null;
              qualities: number[];
            }
          >();
          for (const item of staged.data.items) {
            const source = exerciseItems.get(item.itemId)!;
            for (const target of item.targetQualities!) {
              const ownedTarget = source.targets.find(
                (candidate) =>
                  candidate.targetType === target.targetType &&
                  candidate.targetKey === target.targetKey,
              );
              if (!ownedTarget) transactionError('STATE_CONFLICT');
              const key = `${target.targetType}:${target.targetKey}`;
              const group = grouped.get(key) ?? {
                targetType: target.targetType,
                targetKey: target.targetKey,
                wordId: ownedTarget.wordId,
                qualities: [],
              };
              group.qualities.push(target.quality);
              grouped.set(key, group);
            }
          }
          if (grouped.size === 0) transactionError('STATE_CONFLICT');

          const attemptId = this.createAttemptId();
          await database.learningAttempt.create({
            data: {
              id: attemptId,
              userId: identity.userId,
              attemptType: 'EXERCISE',
              exerciseId: command.exerciseId,
              submissionId: command.grading.submissionId,
              saveRequestId: staged.data.gradeRequestId,
              score: staged.data.score,
              errorTypes: asJson(staged.data.errorTypes),
              gradingHash: staged.data.gradingHash,
              savedAt: committedAt,
            },
          });

          const learningChanges: Array<z.infer<typeof learningChangeSchema>> =
            [];
          for (const group of grouped.values()) {
            const existing = await database.learningItemState.findUnique({
              where: {
                userId_targetType_targetKey: {
                  userId: identity.userId,
                  targetType: group.targetType,
                  targetKey: group.targetKey,
                },
              },
            });
            const previous: Sm2ReviewState = existing
              ? {
                  reviewState: existing.reviewState,
                  repetitionCount: existing.repetitionCount,
                  easeFactor: Number(existing.easeFactor),
                  intervalDays: existing.intervalDays,
                  ...(existing.dueAt ? { dueAt: existing.dueAt } : {}),
                }
              : {
                  reviewState: 'NEW',
                  repetitionCount: 0,
                  easeFactor: 2.5,
                  intervalDays: 0,
                };
            const quality = aggregateLowestQuality(group.qualities);
            const next = scheduleSm2Review({
              current: previous,
              quality,
              reviewedAt: committedAt,
              timezone: profile?.timezone ?? 'Asia/Shanghai',
            });
            const itemState = await database.learningItemState.upsert({
              where: {
                userId_targetType_targetKey: {
                  userId: identity.userId,
                  targetType: group.targetType,
                  targetKey: group.targetKey,
                },
              },
              create: {
                userId: identity.userId,
                targetType: group.targetType,
                targetKey: group.targetKey,
                wordId: group.wordId,
                reviewState: next.reviewState,
                repetitionCount: next.repetitionCount,
                easeFactor: next.easeFactor,
                intervalDays: next.intervalDays,
                dueAt: next.dueAt,
                lastReviewedAt: committedAt,
                lastQuality: quality,
                lastAttemptId: attemptId,
              },
              update: {
                wordId: existing?.wordId ?? group.wordId,
                reviewState: next.reviewState,
                repetitionCount: next.repetitionCount,
                easeFactor: next.easeFactor,
                intervalDays: next.intervalDays,
                dueAt: next.dueAt,
                lastReviewedAt: committedAt,
                lastQuality: quality,
                lastAttemptId: attemptId,
              },
              select: { id: true },
            });
            await database.learningReviewEvent.create({
              data: {
                id: this.createReviewEventId(),
                userId: identity.userId,
                itemStateId: itemState.id,
                attemptId,
                targetType: group.targetType,
                targetKey: group.targetKey,
                itemScore: quality * 20,
                quality,
                previousState: stateSnapshot(previous),
                nextState: stateSnapshot(next),
                evidenceKind: 'EXERCISE_GRADING',
                schedulerVersion: 'SM2_V1',
                policyVersion: 'mcp-submit-answer.v1',
                createdAt: committedAt,
              },
            });
            learningChanges.push({
              targetType: group.targetType,
              targetKey: group.targetKey,
              previousState: previous.reviewState,
              nextState: next.reviewState,
              nextReviewAt: next.dueAt?.toISOString() ?? null,
            });
          }

          await database.exercise.update({
            where: { id: command.exerciseId },
            data: { status: 'SAVED', updatedAt: committedAt },
          });
          const consumed = await database.mcpWriteConfirmation.updateMany({
            where: { id: confirmation.id, state: 'CLAIMED' },
            data: {
              state: 'CONSUMED',
              consumedAt: committedAt,
              updatedAt: committedAt,
            },
          });
          if (consumed.count !== 1) {
            transactionError('CONFIRMATION_STATE_CONFLICT');
          }

          const result = mcpSubmitAnswerSuccessSchema.parse({
            schemaVersion: MCP_SCHEMA_VERSION,
            ok: true,
            submissionId: command.grading.submissionId,
            attemptId,
            saveStatus: 'saved',
            score: staged.data.score,
            items: staged.data.items.map((item) => ({
              itemId: item.itemId,
              score: item.score,
              correction: item.correction,
              explanation: item.explanation,
              errorTypes: item.errorTypes,
            })),
            learningChanges,
            traceId: command.traceId,
          }) as McpSubmitAnswerFinalizeResult;
          const completed = await database.mcpIdempotencyIntent.updateMany({
            where: {
              id: intent.id,
              status: 'PROCESSING',
              requestFingerprint: intent.requestFingerprint,
              gradingResultHash: stagedHash,
            },
            data: {
              status: 'COMPLETED',
              leaseOwnerHmac: null,
              leaseExpiresAt: null,
              exerciseId: command.exerciseId,
              submissionId: command.grading.submissionId,
              learningAttemptId: attemptId,
              safeTerminalProjection: asJson(result),
              safeErrorCode: null,
              finishedAt: committedAt,
              updatedAt: committedAt,
            },
          });
          if (completed.count !== 1) transactionError('STATE_CONFLICT');
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof McpSubmitAnswerError) throw error;
      throw new McpSubmitAnswerError('DEPENDENCY_UNAVAILABLE', true);
    }
  }
}
