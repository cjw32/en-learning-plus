import { Inject, Injectable } from '@nestjs/common';
import { coachProfileUpdateSchema } from '@en/common/coach';
import { PrismaService } from '@libs/shared';
import {
  LearningDomainError,
  ownedResourceNotFound,
} from '../common/learning-errors';
import type {
  LearnerProfileRecord,
  LearnerProfileRepository,
  LearnerProfileSnapshot,
} from './learner-profile.types';

export const LEARNER_PROFILE_REPOSITORY = Symbol('LEARNER_PROFILE_REPOSITORY');

function isIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone.includes('/');
  } catch {
    return false;
  }
}

@Injectable()
export class PrismaLearnerProfileRepository implements LearnerProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  findProfile(subjectId: string) {
    return this.prisma.learnerProfile.findUnique({
      where: { userId: subjectId },
      include: {
        activeCourse: { select: { id: true, name: true, value: true } },
      },
    });
  }

  async findPurchasedCourse(subjectId: string, courseId: string) {
    const record = await this.prisma.courseRecord.findFirst({
      where: { userId: subjectId, courseId, isPurchased: true },
      select: {
        course: { select: { id: true, name: true, value: true } },
      },
    });
    return record?.course ?? null;
  }

  upsertProfile(subjectId: string, update: Partial<LearnerProfileRecord>) {
    const data = {
      cefrLevel: update.cefrLevel,
      levelSource: update.levelSource,
      goalType: update.goalType,
      goalText: update.goalText,
      activeCourseId: update.activeCourseId,
      timezone: update.timezone,
    };
    return this.prisma.learnerProfile.upsert({
      where: { userId: subjectId },
      create: { userId: subjectId, ...data },
      update: data,
      include: {
        activeCourse: { select: { id: true, name: true, value: true } },
      },
    });
  }

  async readSignals(subjectId: string, limit: number) {
    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [
      legacyCompletedCount,
      coachEngagedCount,
      recentStates,
      weakStates,
      errorStates,
      attemptAggregate,
    ] = await this.prisma.$transaction([
      this.prisma.wordBookRecord.count({
        where: { userId: subjectId, isMaster: true },
      }),
      this.prisma.learningItemState.count({
        where: {
          userId: subjectId,
          targetType: { in: ['WORD', 'ERROR_TYPE'] },
        },
      }),
      this.prisma.learningItemState.findMany({
        where: { userId: subjectId, targetType: 'WORD', wordId: { not: null } },
        take: limit,
        orderBy: [{ lastReviewedAt: 'desc' }, { targetKey: 'asc' }],
        include: { word: { select: { id: true, word: true } } },
      }),
      this.prisma.learningItemState.findMany({
        where: {
          userId: subjectId,
          targetType: { in: ['WORD', 'ERROR_TYPE'] },
          reviewState: { in: ['LEARNING', 'REVIEW', 'MASTERED'] },
          OR: [{ lastQuality: { lt: 3 } }, { dueAt: { lte: new Date() } }],
        },
        take: limit,
        orderBy: [
          { lastQuality: 'asc' },
          { dueAt: 'asc' },
          { targetKey: 'asc' },
        ],
        include: { word: { select: { word: true } } },
      }),
      this.prisma.learningItemState.findMany({
        where: { userId: subjectId, targetType: 'ERROR_TYPE' },
        take: 11,
        orderBy: [{ lastReviewedAt: 'desc' }, { targetKey: 'asc' }],
      }),
      this.prisma.learningAttempt.aggregate({
        where: {
          userId: subjectId,
          attemptType: 'EXERCISE',
          savedAt: { gte: windowStart },
        },
        _count: { id: true },
        _avg: { score: true },
      }),
    ]);
    return {
      legacyCompletedCount,
      coachEngagedCount,
      recentWords: recentStates
        .filter((state) => state.word)
        .map((state) => ({
          wordId: state.word!.id,
          word: state.word!.word,
          state: state.reviewState as 'LEARNING' | 'REVIEW' | 'MASTERED',
        })),
      weakItems: weakStates.map((state) => ({
        targetType:
          state.targetType === 'WORD'
            ? ('WORD' as const)
            : ('ERROR_TYPE' as const),
        targetKey: state.targetKey,
        label: state.word?.word ?? state.targetKey,
        reviewState: state.reviewState as 'LEARNING' | 'REVIEW' | 'MASTERED',
        lastQuality: state.lastQuality,
        dueAt: state.dueAt,
      })),
      errorTypes: errorStates
        .filter((state) => state.lastReviewedAt)
        .map((state) => ({
          type: state.targetKey,
          count: Math.max(1, state.repetitionCount),
          lastSeenAt: state.lastReviewedAt!,
        })),
      recentPerformance: {
        attemptCount: attemptAggregate._count.id,
        averageScore:
          attemptAggregate._avg.score === null
            ? null
            : Math.round(attemptAggregate._avg.score),
        windowStart,
      },
    };
  }
}

@Injectable()
export class LearnerProfileService {
  constructor(
    @Inject(LEARNER_PROFILE_REPOSITORY)
    private readonly repository: LearnerProfileRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getProfile(subjectId: string): Promise<LearnerProfileRecord | null> {
    return this.repository.findProfile(subjectId);
  }

  async getSnapshot(
    subjectId: string,
    limit: number,
  ): Promise<LearnerProfileSnapshot> {
    const [profile, learning] = await Promise.all([
      this.repository.findProfile(subjectId),
      this.repository.readSignals(subjectId, limit),
    ]);
    const hasAttempts = learning.recentPerformance.attemptCount > 0;
    return {
      snapshotAt: this.now(),
      level:
        profile?.cefrLevel && profile.levelSource
          ? { cefr: profile.cefrLevel, source: profile.levelSource }
          : null,
      goal: profile?.goalType
        ? { type: profile.goalType, text: profile.goalText }
        : null,
      activeCourse: profile?.activeCourse ?? null,
      timezone: profile?.timezone ?? 'Asia/Shanghai',
      learnedWordSummary: {
        legacyCompletedCount: learning.legacyCompletedCount,
        coachEngagedCount: learning.coachEngagedCount,
        recentWords: learning.recentWords,
      },
      weakItems: learning.weakItems,
      errorTypes: learning.errorTypes,
      recentPerformance: learning.recentPerformance,
      signals: [
        {
          dimension: 'LEVEL',
          status: profile?.cefrLevel ? 'AVAILABLE' : 'MISSING',
        },
        {
          dimension: 'GOAL',
          status: profile?.goalType ? 'AVAILABLE' : 'MISSING',
        },
        { dimension: 'LEARNED_WORDS', status: 'AVAILABLE' },
        {
          dimension: 'WEAK_ITEMS',
          status: hasAttempts ? 'AVAILABLE' : 'NOT_APPLICABLE',
        },
        {
          dimension: 'ERROR_TYPES',
          status: hasAttempts ? 'AVAILABLE' : 'NOT_APPLICABLE',
        },
        {
          dimension: 'RECENT_PERFORMANCE',
          status: hasAttempts ? 'AVAILABLE' : 'MISSING',
        },
        {
          dimension: 'ACTIVE_COURSE',
          status: profile?.activeCourse ? 'AVAILABLE' : 'MISSING',
        },
      ],
    };
  }

  async updateProfile(
    subjectId: string,
    input: unknown,
  ): Promise<LearnerProfileRecord> {
    const parsed = coachProfileUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new LearningDomainError(
        'VALIDATION_FAILED',
        '学习画像参数无效',
        400,
      );
    }
    if (parsed.data.timezone && !isIanaTimezone(parsed.data.timezone)) {
      throw new LearningDomainError(
        'VALIDATION_FAILED',
        '学习画像参数无效',
        400,
      );
    }
    let activeCourse:
      | { id: string; name: string; value: string }
      | null
      | undefined;
    if (parsed.data.activeCourseId) {
      activeCourse = await this.repository.findPurchasedCourse(
        subjectId,
        parsed.data.activeCourseId,
      );
      if (!activeCourse) throw ownedResourceNotFound();
    } else if (parsed.data.activeCourseId === null) {
      activeCourse = null;
    }
    const update: Partial<LearnerProfileRecord> = {
      ...parsed.data,
      ...(Object.hasOwn(parsed.data, 'cefrLevel')
        ? {
            levelSource:
              parsed.data.cefrLevel === null ? null : 'USER_DECLARED',
          }
        : {}),
      ...(activeCourse !== undefined ? { activeCourse } : {}),
    };
    return this.repository.upsertProfile(subjectId, update);
  }
}
