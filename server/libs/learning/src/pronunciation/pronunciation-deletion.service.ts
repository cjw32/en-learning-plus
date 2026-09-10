import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import {
  scheduleSm2Review,
  type Sm2ReviewState,
} from '../review/sm2-review-scheduler';

export type PronunciationReplayEvent = Readonly<{
  id: string;
  attemptId: string;
  quality: number;
  reviewedAt: Date;
  schedulerVersion: 'SM2_V1';
}>;

export type PronunciationAffectedLearningItem = Readonly<{
  itemStateId: string;
  subjectId: string;
  targetKey: string;
  wordId: string;
  currentState: Sm2ReviewState;
  events: readonly PronunciationReplayEvent[];
}>;

type Recalculation = Readonly<{
  deletionId: string;
  deletedAttemptId: string;
  itemStateId: string;
  subjectId: string;
  targetKey: string;
  wordId: string;
  previousState: Sm2ReviewState;
  nextState: Sm2ReviewState;
  sourceAttemptHash: string;
  replayedEventCount: number;
  lastReviewedAt: Date | null;
  lastQuality: number | null;
  lastAttemptId: string | null;
}>;

export interface PronunciationLearningDeletionTransaction {
  loadAffectedItems(
    deletedAttemptId: string,
  ): Promise<readonly PronunciationAffectedLearningItem[]>;
  saveRecalculation(input: Recalculation): Promise<unknown>;
}

export interface PronunciationLearningDeletionRepository {
  compensate<T>(
    deletionId: string,
    operation: (tx: PronunciationLearningDeletionTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PronunciationSummaryInvalidation {
  invalidate(
    input: Readonly<{
      deletionId: string;
      subjectId: string;
      targetKeys: readonly string[];
    }>,
  ): Promise<void>;
}

const noopInvalidation: PronunciationSummaryInvalidation = {
  async invalidate() {},
};

function initialState(): Sm2ReviewState {
  return {
    reviewState: 'NEW',
    repetitionCount: 0,
    easeFactor: 2.5,
    intervalDays: 0,
  };
}

function hashAttempts(attemptIds: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...attemptIds].sort()))
    .digest('hex');
}

@Injectable()
export class PronunciationLearningDeletionService {
  constructor(
    private readonly repository: PronunciationLearningDeletionRepository,
    private readonly invalidation: PronunciationSummaryInvalidation = noopInvalidation,
  ) {}

  async compensate(
    input: Readonly<{
      deletionId: string;
      deletedAttemptId: string;
      reviewedTimezone: string;
    }>,
  ) {
    const result = await this.repository.compensate(
      input.deletionId,
      async (tx) => {
        const affected = await tx.loadAffectedItems(input.deletedAttemptId);
        const items = [] as Array<
          Recalculation & Readonly<{ replayedEventCount: number }>
        >;
        for (const item of affected) {
          const remaining = item.events
            .filter((event) => event.attemptId !== input.deletedAttemptId)
            .slice()
            .sort(
              (left, right) =>
                left.reviewedAt.getTime() - right.reviewedAt.getTime() ||
                left.id.localeCompare(right.id),
            );
          let nextState = initialState();
          for (const event of remaining) {
            if (event.schedulerVersion !== 'SM2_V1') {
              throw new Error('UNSUPPORTED_SCHEDULER_VERSION');
            }
            nextState = scheduleSm2Review({
              current: nextState,
              quality: event.quality,
              reviewedAt: event.reviewedAt,
              timezone: input.reviewedTimezone,
            });
          }
          const recalculation: Recalculation = {
            deletionId: input.deletionId,
            deletedAttemptId: input.deletedAttemptId,
            itemStateId: item.itemStateId,
            subjectId: item.subjectId,
            targetKey: item.targetKey,
            wordId: item.wordId,
            previousState: item.currentState,
            nextState,
            sourceAttemptHash: hashAttempts(
              remaining.map((event) => event.attemptId),
            ),
            replayedEventCount: remaining.length,
            lastReviewedAt: remaining.at(-1)?.reviewedAt ?? null,
            lastQuality: remaining.at(-1)?.quality ?? null,
            lastAttemptId: remaining.at(-1)?.attemptId ?? null,
          };
          await tx.saveRecalculation(recalculation);
          items.push(recalculation);
        }
        return items;
      },
    );
    const subjectId = result[0]?.subjectId;
    if (subjectId) {
      await this.invalidation.invalidate({
        deletionId: input.deletionId,
        subjectId,
        targetKeys: result.map((item) => item.targetKey),
      });
    }
    return Object.freeze({ status: 'COMPENSATED' as const, items: result });
  }
}

function json(value: Sm2ReviewState): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify({ ...value, dueAt: value.dueAt?.toISOString() }),
  ) as Prisma.InputJsonValue;
}

@Injectable()
export class PrismaPronunciationLearningDeletionRepository implements PronunciationLearningDeletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async compensate<T>(
    deletionId: string,
    operation: (tx: PronunciationLearningDeletionTransaction) => Promise<T>,
  ): Promise<T> {
    await this.prisma.pronunciationDeletionTombstone.updateMany({
      where: { id: deletionId, status: { in: ['ACCEPTED', 'FAILED'] } },
      data: { status: 'COMPENSATING', failureCode: null },
    });
    try {
      return await this.prisma.$transaction(async (database) => {
        const result = await operation({
          loadAffectedItems: async (deletedAttemptId) => {
            const deleted = await database.learningReviewEvent.findMany({
              where: {
                attemptId: deletedAttemptId,
                evidenceKind: 'PRONUNCIATION_WORD',
              },
              select: { itemStateId: true },
            });
            const itemStateIds = [
              ...new Set(deleted.map((event) => event.itemStateId)),
            ];
            const states = await database.learningItemState.findMany({
              where: {
                id: { in: itemStateIds },
                targetType: 'PRONUNCIATION_WORD',
              },
              include: {
                reviewEvents: {
                  where: { evidenceKind: 'PRONUNCIATION_WORD', voidedAt: null },
                  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                },
              },
            });
            return states.flatMap((state) =>
              state.wordId
                ? [
                    {
                      itemStateId: state.id,
                      subjectId: state.userId,
                      targetKey: state.targetKey,
                      wordId: state.wordId,
                      currentState: {
                        reviewState: state.reviewState,
                        repetitionCount: state.repetitionCount,
                        easeFactor: Number(state.easeFactor),
                        intervalDays: state.intervalDays,
                        dueAt: state.dueAt ?? undefined,
                      },
                      events: state.reviewEvents.map((event) => ({
                        id: event.id,
                        attemptId: event.attemptId,
                        quality: event.quality,
                        reviewedAt: event.createdAt,
                        schedulerVersion: event.schedulerVersion as 'SM2_V1',
                      })),
                    },
                  ]
                : [],
            );
          },
          saveRecalculation: async (input) => {
            const existing =
              await database.learningStateRecalculationEvent.findUnique({
                where: {
                  deletionId_itemStateId: {
                    deletionId: input.deletionId,
                    itemStateId: input.itemStateId,
                  },
                },
              });
            if (existing?.status === 'COMPLETED') return existing;
            await database.learningReviewEvent.updateMany({
              where: {
                attemptId: input.deletedAttemptId,
                itemStateId: input.itemStateId,
                voidedAt: null,
              },
              data: { voidedAt: new Date() },
            });
            await database.learningItemState.update({
              where: { id: input.itemStateId },
              data: {
                reviewState: input.nextState.reviewState,
                repetitionCount: input.nextState.repetitionCount,
                easeFactor: input.nextState.easeFactor,
                intervalDays: input.nextState.intervalDays,
                dueAt: input.nextState.dueAt ?? null,
                lastReviewedAt: input.lastReviewedAt,
                lastQuality: input.lastQuality,
                lastAttemptId: input.lastAttemptId,
              },
            });
            return database.learningStateRecalculationEvent.upsert({
              where: {
                deletionId_itemStateId: {
                  deletionId: input.deletionId,
                  itemStateId: input.itemStateId,
                },
              },
              create: {
                deletionId: input.deletionId,
                itemStateId: input.itemStateId,
                sourceAttemptHash: input.sourceAttemptHash,
                previousState: json(input.previousState),
                nextState: json(input.nextState),
                schedulerVersion: 'SM2_V1',
                policyVersion: 'pronunciation-quality.v1',
                recalculationVersion: 'pronunciation-recalculation.v1',
                replayedEventCount: input.replayedEventCount,
                status: 'COMPLETED',
                startedAt: new Date(),
                finishedAt: new Date(),
              },
              update: {},
            });
          },
        });
        await database.pronunciationDeletionTombstone.updateMany({
          where: { id: deletionId, status: 'COMPENSATING' },
          data: { status: 'ACCEPTED', failureCode: null },
        });
        return result;
      });
    } catch (error) {
      await this.prisma.pronunciationDeletionTombstone.updateMany({
        where: { id: deletionId, status: 'COMPENSATING' },
        data: { status: 'FAILED', failureCode: 'COMPENSATION_RETRY' },
      });
      throw error;
    }
  }
}
