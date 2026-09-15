import { recordStudyDay } from '@libs/shared/study/study-day';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ErrorType } from '@en/common/coach';
import { z } from '@en/common/coach/zod';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import {
  LearningDomainError,
  ownedResourceNotFound,
} from '../common/learning-errors';
import {
  aggregateLowestQuality,
  scheduleSm2Review,
  type Sm2ReviewState,
} from '../review/sm2-review-scheduler';

export type AttemptTargetType = 'WORD' | 'ERROR_TYPE';

export type AttemptSubmission = {
  id: string;
  subjectId: string;
  exerciseId: string;
  status: string;
  score: number | null;
  gradingHash: string | null;
  errorTypes: ErrorType[];
  timezone: string;
  targetEvidence: Array<{
    targetType: AttemptTargetType;
    targetKey: string;
    wordId: string | null;
    quality: number;
  }>;
};

export type AttemptItemState = Sm2ReviewState & {
  subjectId: string;
  targetType: AttemptTargetType;
  targetKey: string;
  wordId: string | null;
  lastReviewedAt?: Date | null;
  lastQuality?: number | null;
  lastAttemptId?: string | null;
};

export type AttemptChange = {
  targetType: AttemptTargetType;
  targetKey: string;
  label: string;
  previousState: 'NEW' | 'LEARNING' | 'REVIEW' | 'MASTERED';
  nextState: 'LEARNING' | 'REVIEW' | 'MASTERED';
  quality: number;
  nextReviewAt: Date;
  reason: string;
};

export type AttemptRecord = {
  id: string;
  subjectId: string;
  exerciseId: string;
  submissionId: string;
  saveRequestId: string;
  score: number;
  errorTypes: ErrorType[];
  gradingHash: string;
  savedAt: Date;
  changes: AttemptChange[];
};

export type AttemptReviewEvent = {
  id: string;
  subjectId: string;
  attemptId: string;
  targetType: AttemptTargetType;
  targetKey: string;
  quality: number;
  previousState: Sm2ReviewState;
  nextState: Sm2ReviewState;
};

export type AttemptKnowledgeRebuild = Readonly<{
  subjectId: string;
  attemptId: string;
  gradingHash: string;
}>;

export interface AttemptTransaction {
  lockOwnedSubmission(
    subjectId: string,
    submissionId: string,
    saveRequestId?: string,
    idempotencyKey?: string,
  ): Promise<AttemptSubmission | null>;
  findAttemptBySubmission(submissionId: string): Promise<AttemptRecord | null>;
  findItemState(
    subjectId: string,
    targetType: AttemptTargetType,
    targetKey: string,
  ): Promise<AttemptItemState | null>;
  createAttempt(attempt: AttemptRecord): Promise<void>;
  upsertItemState(state: AttemptItemState): Promise<void>;
  createReviewEvent(event: AttemptReviewEvent): Promise<void>;
  markSaved(submissionId: string, exerciseId: string): Promise<void>;
  enqueueKnowledgeRebuild?(command: AttemptKnowledgeRebuild): Promise<void>;
}

export interface AttemptRepository {
  transaction<T>(operation: (tx: AttemptTransaction) => Promise<T>): Promise<T>;
}

const targetEvidenceSchema = z.array(
  z
    .object({
      targetType: z.enum(['WORD', 'ERROR_TYPE']),
      targetKey: z.string().min(1).max(128),
      wordId: z.string().nullable().optional(),
      quality: z.number().int().min(0).max(5),
    })
    .strict(),
);

const stateJsonSchema = z
  .object({
    reviewState: z.enum(['NEW', 'LEARNING', 'REVIEW', 'MASTERED']),
    repetitionCount: z.number().int().min(0),
    easeFactor: z.number().min(1.3),
    intervalDays: z.number().int().min(0),
    dueAt: z.string().datetime().optional(),
  })
  .strict();

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class PrismaAttemptRepository implements AttemptRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(
    operation: (tx: AttemptTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (database) => {
      const itemStateIds = new Map<string, string>();
      const transaction: AttemptTransaction = {
        lockOwnedSubmission: async (
          subjectId,
          submissionId,
          saveRequestId,
          idempotencyKey,
        ) => {
          const locked = await database.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "ExerciseSubmission" WHERE "id" = ${submissionId} AND "userId" = ${subjectId} FOR UPDATE`,
          );
          if (locked.length === 0) return null;
          if (saveRequestId && idempotencyKey) {
            const request = await database.coachRequest.findFirst({
              where: {
                id: saveRequestId,
                userId: subjectId,
                clientRequestKey: idempotencyKey,
              },
              select: { id: true },
            });
            if (!request) return null;
          }
          const submission = await database.exerciseSubmission.findFirst({
            where: { id: submissionId, userId: subjectId },
            include: {
              items: { select: { targetQualities: true } },
            },
          });
          if (!submission) return null;
          const profile = await database.learnerProfile.findUnique({
            where: { userId: subjectId },
            select: { timezone: true },
          });
          const grading = z
            .object({ errorTypes: z.array(z.string()).default([]) })
            .passthrough()
            .safeParse(submission.gradingResult);
          return {
            id: submission.id,
            subjectId: submission.userId,
            exerciseId: submission.exerciseId,
            status: submission.status,
            score: submission.score,
            gradingHash: submission.gradingHash,
            errorTypes: (grading.success
              ? grading.data.errorTypes
              : []) as ErrorType[],
            timezone: profile?.timezone ?? 'Asia/Shanghai',
            targetEvidence: submission.items.flatMap((item) =>
              targetEvidenceSchema
                .parse(item.targetQualities)
                .map((target) => ({
                  ...target,
                  wordId: target.wordId ?? null,
                })),
            ),
          };
        },
        findAttemptBySubmission: async (submissionId) => {
          const attempt = await database.learningAttempt.findUnique({
            where: { submissionId, attemptType: 'EXERCISE' },
            include: {
              reviewEvents: {
                where: { evidenceKind: 'EXERCISE_GRADING' },
                orderBy: { createdAt: 'asc' },
              },
            },
          });
          if (!attempt) return null;
          if (
            attempt.attemptType !== 'EXERCISE' ||
            !attempt.exerciseId ||
            !attempt.submissionId ||
            !attempt.saveRequestId ||
            !attempt.gradingHash
          ) {
            throw new LearningDomainError(
              'STATE_CONFLICT',
              '旧练习学习记录不完整',
              409,
            );
          }
          const changes: AttemptChange[] = attempt.reviewEvents.map((event) => {
            if (
              event.targetType !== 'WORD' &&
              event.targetType !== 'ERROR_TYPE'
            ) {
              throw new LearningDomainError(
                'STATE_CONFLICT',
                '旧练习包含不兼容的学习目标',
                409,
              );
            }
            const previous = stateJsonSchema.parse(event.previousState);
            const next = stateJsonSchema.parse(event.nextState);
            return {
              targetType: event.targetType,
              targetKey: event.targetKey,
              label: event.targetKey,
              previousState: previous.reviewState,
              nextState: next.reviewState as AttemptChange['nextState'],
              quality: event.quality,
              nextReviewAt: new Date(next.dueAt!),
              reason: '已按首次保存的 SM2_V1 结果重放。',
            };
          });
          return {
            id: attempt.id,
            subjectId: attempt.userId,
            exerciseId: attempt.exerciseId,
            submissionId: attempt.submissionId,
            saveRequestId: attempt.saveRequestId,
            score: attempt.score,
            errorTypes: z
              .array(z.string())
              .parse(attempt.errorTypes) as ErrorType[],
            gradingHash: attempt.gradingHash,
            savedAt: attempt.savedAt,
            changes,
          };
        },
        findItemState: async (subjectId, targetType, targetKey) => {
          const state = await database.learningItemState.findUnique({
            where: {
              userId_targetType_targetKey: {
                userId: subjectId,
                targetType,
                targetKey,
              },
            },
          });
          return state
            ? {
                subjectId: state.userId,
                targetType,
                targetKey: state.targetKey,
                wordId: state.wordId,
                reviewState: state.reviewState,
                repetitionCount: state.repetitionCount,
                easeFactor: Number(state.easeFactor),
                intervalDays: state.intervalDays,
                dueAt: state.dueAt ?? undefined,
                lastReviewedAt: state.lastReviewedAt,
                lastQuality: state.lastQuality,
                lastAttemptId: state.lastAttemptId,
              }
            : null;
        },
        createAttempt: async (attempt) => {
          await database.learningAttempt.create({
            data: {
              id: attempt.id,
              userId: attempt.subjectId,
              attemptType: 'EXERCISE',
              exerciseId: attempt.exerciseId,
              submissionId: attempt.submissionId,
              saveRequestId: attempt.saveRequestId,
              score: attempt.score,
              errorTypes: attempt.errorTypes,
              gradingHash: attempt.gradingHash,
              savedAt: attempt.savedAt,
            },
          });
          await recordStudyDay(database, attempt.subjectId, attempt.savedAt);
        },
        upsertItemState: async (state) => {
          const saved = await database.learningItemState.upsert({
            where: {
              userId_targetType_targetKey: {
                userId: state.subjectId,
                targetType: state.targetType,
                targetKey: state.targetKey,
              },
            },
            create: {
              userId: state.subjectId,
              targetType: state.targetType,
              targetKey: state.targetKey,
              wordId: state.wordId,
              reviewState: state.reviewState,
              repetitionCount: state.repetitionCount,
              easeFactor: state.easeFactor,
              intervalDays: state.intervalDays,
              dueAt: state.dueAt,
              lastReviewedAt: state.lastReviewedAt,
              lastQuality: state.lastQuality,
              lastAttemptId: state.lastAttemptId,
            },
            update: {
              wordId: state.wordId,
              reviewState: state.reviewState,
              repetitionCount: state.repetitionCount,
              easeFactor: state.easeFactor,
              intervalDays: state.intervalDays,
              dueAt: state.dueAt,
              lastReviewedAt: state.lastReviewedAt,
              lastQuality: state.lastQuality,
              lastAttemptId: state.lastAttemptId,
            },
            select: { id: true },
          });
          itemStateIds.set(`${state.targetType}:${state.targetKey}`, saved.id);
        },
        createReviewEvent: async (event) => {
          const itemStateId = itemStateIds.get(
            `${event.targetType}:${event.targetKey}`,
          );
          if (!itemStateId)
            throw new Error('Missing item state transaction key');
          await database.learningReviewEvent.create({
            data: {
              id: event.id,
              userId: event.subjectId,
              itemStateId,
              attemptId: event.attemptId,
              targetType: event.targetType,
              targetKey: event.targetKey,
              itemScore: event.quality * 20,
              quality: event.quality,
              previousState: jsonValue(event.previousState),
              nextState: jsonValue(event.nextState),
            },
          });
        },
        markSaved: async (submissionId, exerciseId) => {
          await database.exerciseSubmission.update({
            where: { id: submissionId },
            data: { status: 'SAVED' },
          });
          await database.exercise.update({
            where: { id: exerciseId },
            data: { status: 'SAVED' },
          });
        },
        enqueueKnowledgeRebuild: async (command) => {
          const source = await database.knowledgeSource.findUnique({
            where: { sourceKey: 'private-learning' },
            select: { id: true },
          });
          // Private RAG is default-off. Environments that enable it must first
          // provision the audited source; legacy saves remain unaffected otherwise.
          if (!source) return;
          const contentVersion = `grading.sha256.${command.gradingHash}`;
          await database.knowledgeIngestionJob.createMany({
            skipDuplicates: true,
            data: [
              {
                id: `kjob_${randomUUID().replaceAll('-', '')}`,
                operation: 'UPSERT',
                knowledgeSourceId: source.id,
                sourceRecordType: 'LearningAttempt',
                sourceRecordId: command.attemptId,
                contentVersion,
                pipelineVersion: 'private-wrong-answer.v1',
                ownerUserId: command.subjectId,
              },
              {
                id: `kjob_${randomUUID().replaceAll('-', '')}`,
                operation: 'UPSERT',
                knowledgeSourceId: source.id,
                sourceRecordType: 'PrivateLearningSummary',
                sourceRecordId: command.subjectId,
                contentVersion,
                pipelineVersion: 'private-learning-summary.v1',
                ownerUserId: command.subjectId,
              },
            ],
          });
        },
      };
      return operation(transaction);
    });
  }
}

export type AttemptTransactionState = {
  submission: AttemptSubmission;
  attempts: AttemptRecord[];
  itemStates: AttemptItemState[];
  reviewEvents: AttemptReviewEvent[];
  knowledgeRebuilds: AttemptKnowledgeRebuild[];
};

function stateSnapshot(state: Sm2ReviewState): Sm2ReviewState {
  return {
    reviewState: state.reviewState,
    repetitionCount: state.repetitionCount,
    easeFactor: state.easeFactor,
    intervalDays: state.intervalDays,
    ...(state.dueAt ? { dueAt: state.dueAt } : {}),
  };
}

@Injectable()
export class AttemptService {
  constructor(
    private readonly repository: AttemptRepository,
    private readonly createAttemptId: () => string = () =>
      `attempt_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    private readonly createEventId: () => string = () =>
      `review_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
  ) {}

  async save(input: {
    subjectId: string;
    submissionId: string;
    gradingHash: string;
    saveRequestId: string;
    idempotencyKey: string;
    reviewedAt?: Date;
    cancelled?: boolean;
  }) {
    if (input.cancelled) {
      throw new LearningDomainError(
        'STATE_CONFLICT',
        '请求已取消，未保存学习记录',
        409,
      );
    }
    const reviewedAt = input.reviewedAt ?? new Date();
    return this.repository.transaction(async (tx) => {
      const submission = await tx.lockOwnedSubmission(
        input.subjectId,
        input.submissionId,
        input.saveRequestId,
        input.idempotencyKey,
      );
      if (!submission) throw ownedResourceNotFound();
      const existing = await tx.findAttemptBySubmission(input.submissionId);
      if (existing) {
        if (
          existing.subjectId !== input.subjectId ||
          existing.gradingHash !== input.gradingHash
        ) {
          throw new LearningDomainError(
            'STATE_CONFLICT',
            '已保存作答与当前批改不一致',
            409,
          );
        }
        return {
          status: 'replayed' as const,
          attemptId: existing.id,
          score: existing.score,
          changes: existing.changes,
          savedAt: existing.savedAt,
        };
      }
      if (
        submission.status !== 'GRADED_VALID' ||
        submission.score === null ||
        submission.gradingHash !== input.gradingHash
      ) {
        throw new LearningDomainError(
          'STATE_CONFLICT',
          '作答尚未通过有效批改或批改版本不匹配',
          409,
        );
      }
      const grouped = new Map<
        string,
        {
          targetType: AttemptTargetType;
          targetKey: string;
          wordId: string | null;
          qualities: number[];
        }
      >();
      for (const evidence of submission.targetEvidence) {
        const key = `${evidence.targetType}:${evidence.targetKey}`;
        const group = grouped.get(key) ?? { ...evidence, qualities: [] };
        group.qualities.push(evidence.quality);
        grouped.set(key, group);
      }
      if (grouped.size === 0) {
        throw new LearningDomainError(
          'STATE_CONFLICT',
          '批改缺少可更新的学习目标',
          409,
        );
      }
      const attemptId = this.createAttemptId();
      const transitions: Array<{
        previous: AttemptItemState;
        next: AttemptItemState;
        change: AttemptChange;
        quality: number;
      }> = [];
      for (const group of grouped.values()) {
        const current = (await tx.findItemState(
          input.subjectId,
          group.targetType,
          group.targetKey,
        )) ?? {
          subjectId: input.subjectId,
          targetType: group.targetType,
          targetKey: group.targetKey,
          wordId: group.wordId,
          reviewState: 'NEW' as const,
          repetitionCount: 0,
          easeFactor: 2.5,
          intervalDays: 0,
          dueAt: undefined,
        };
        const quality = aggregateLowestQuality(group.qualities);
        const scheduled = scheduleSm2Review({
          current,
          quality,
          reviewedAt,
          timezone: submission.timezone,
        });
        const next: AttemptItemState = {
          ...current,
          ...scheduled,
          wordId: current.wordId ?? group.wordId,
          lastReviewedAt: reviewedAt,
          lastQuality: quality,
          lastAttemptId: attemptId,
        };
        transitions.push({
          previous: current,
          next,
          quality,
          change: {
            targetType: group.targetType,
            targetKey: group.targetKey,
            label: group.targetKey,
            previousState: current.reviewState,
            nextState: scheduled.reviewState,
            quality,
            nextReviewAt: scheduled.dueAt,
            reason:
              quality < 3
                ? '本次表现较弱，重置复习序列并安排再次练习。'
                : '根据本次表现更新 SM2_V1 复习间隔。',
          },
        });
      }
      const changes = transitions.map((transition) => transition.change);
      const attempt: AttemptRecord = {
        id: attemptId,
        subjectId: input.subjectId,
        exerciseId: submission.exerciseId,
        submissionId: input.submissionId,
        saveRequestId: input.saveRequestId,
        score: submission.score,
        errorTypes: submission.errorTypes,
        gradingHash: input.gradingHash,
        savedAt: reviewedAt,
        changes,
      };
      await tx.createAttempt(attempt);
      for (const transition of transitions) {
        await tx.upsertItemState(transition.next);
        await tx.createReviewEvent({
          id: this.createEventId(),
          subjectId: input.subjectId,
          attemptId,
          targetType: transition.next.targetType,
          targetKey: transition.next.targetKey,
          quality: transition.quality,
          previousState: stateSnapshot(transition.previous),
          nextState: stateSnapshot(transition.next),
        });
      }
      await tx.markSaved(input.submissionId, submission.exerciseId);
      await tx.enqueueKnowledgeRebuild?.({
        subjectId: input.subjectId,
        attemptId,
        gradingHash: input.gradingHash,
      });
      return {
        status: 'saved' as const,
        attemptId,
        score: submission.score,
        changes,
        savedAt: reviewedAt,
      };
    });
  }
}
