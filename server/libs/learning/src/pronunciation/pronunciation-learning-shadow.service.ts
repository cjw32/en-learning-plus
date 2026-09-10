import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import {
  PRONUNCIATION_LEARNING_MAPPING_VERSION,
  PRONUNCIATION_SCHEDULER_VERSION,
} from '@en/common/pronunciation';
import {
  scheduleSm2Review,
  type Sm2ReviewState,
} from '../review/sm2-review-scheduler';
import type { PronunciationLearningEvidence } from './pronunciation-quality.policy';

export type PronunciationLearningItemState = Sm2ReviewState &
  Readonly<{
    subjectId: string;
    targetType: 'PRONUNCIATION_WORD';
    targetKey: string;
    wordId: string;
    lastReviewedAt?: Date | null;
    lastQuality?: number | null;
    lastAttemptId?: string | null;
  }>;

export interface PronunciationLearningStateReader {
  findItemState(
    subjectId: string,
    targetKey: string,
  ): Promise<PronunciationLearningItemState | null>;
}

export interface PronunciationLearningTraceSink {
  recordProjection(
    input: Readonly<{
      evidenceCount: number;
      changedItemCount: number;
      learningMappingVersion: string;
      schedulerVersion: string;
    }>,
  ): Promise<void>;
}

export class NoopPronunciationLearningTraceSink implements PronunciationLearningTraceSink {
  async recordProjection(): Promise<void> {}
}

@Injectable()
export class PrismaPronunciationLearningStateReader implements PronunciationLearningStateReader {
  constructor(private readonly prisma: PrismaService) {}

  async findItemState(
    subjectId: string,
    targetKey: string,
  ): Promise<PronunciationLearningItemState | null> {
    const state = await this.prisma.learningItemState.findUnique({
      where: {
        userId_targetType_targetKey: {
          userId: subjectId,
          targetType: 'PRONUNCIATION_WORD',
          targetKey,
        },
      },
    });
    if (!state || !state.wordId) return null;
    return Object.freeze({
      subjectId: state.userId,
      targetType: 'PRONUNCIATION_WORD',
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
    });
  }
}

export type PronunciationLearningProjection = Readonly<{
  status: 'PROPOSED';
  changedItems: readonly Readonly<{
    targetPosition: number;
    word: string;
    previousReviewState: 'NEW' | 'LEARNING' | 'REVIEW' | 'MASTERED';
    nextReviewState: 'LEARNING' | 'REVIEW' | 'MASTERED';
    nextReviewAt: string;
  }>[];
  message: string;
}>;

@Injectable()
export class PronunciationLearningShadowService {
  constructor(
    private readonly states: PronunciationLearningStateReader,
    private readonly trace: PronunciationLearningTraceSink = new NoopPronunciationLearningTraceSink(),
  ) {}

  async project(
    input: Readonly<{
      subjectId: string;
      timezone: string;
      reviewedAt: Date;
      evidence: readonly PronunciationLearningEvidence[];
    }>,
  ): Promise<PronunciationLearningProjection> {
    const changedItems = [] as Array<
      PronunciationLearningProjection['changedItems'][number]
    >;
    for (const evidence of input.evidence) {
      const current =
        (await this.states.findItemState(
          input.subjectId,
          evidence.targetKey,
        )) ??
        ({
          subjectId: input.subjectId,
          targetType: 'PRONUNCIATION_WORD',
          targetKey: evidence.targetKey,
          wordId: evidence.wordId,
          reviewState: 'NEW',
          repetitionCount: 0,
          easeFactor: 2.5,
          intervalDays: 0,
        } as const);
      const scheduled = scheduleSm2Review({
        current,
        quality: evidence.quality,
        reviewedAt: input.reviewedAt,
        timezone: input.timezone,
      });
      changedItems.push(
        Object.freeze({
          targetPosition: evidence.targetPosition,
          word: evidence.word,
          previousReviewState: current.reviewState,
          nextReviewState: scheduled.reviewState,
          nextReviewAt: scheduled.dueAt.toISOString(),
        }),
      );
    }
    await this.trace.recordProjection({
      evidenceCount: input.evidence.length,
      changedItemCount: changedItems.length,
      learningMappingVersion: PRONUNCIATION_LEARNING_MAPPING_VERSION,
      schedulerVersion: PRONUNCIATION_SCHEDULER_VERSION,
    });
    return Object.freeze({
      status: 'PROPOSED',
      changedItems: Object.freeze(changedItems),
      message: '学习进度尚未写入，这是按当前规则计算的预览。',
    });
  }
}
