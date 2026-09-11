import { createHash } from 'node:crypto';
import type { PrismaClient } from '@libs/shared/generated/prisma/client';

export type LearningReportAttemptFact = Readonly<{
  id: string;
  occurredAt: Date;
  score: number;
  wordIds: readonly string[];
  errorTypes: readonly string[];
}>;

export type LearningReportReviewFact = Readonly<{
  wordId: string;
  word: string;
  reviewState: 'LEARNING' | 'REVIEW' | 'MASTERED';
  dueAt: Date;
  completedAt: Date | null;
  priority: number;
  reason: string;
}>;

export type LearningReportSnapshot = Readonly<{
  timezone: string;
  contentVersion: string;
  updatedAt: Date;
  attempts: readonly LearningReportAttemptFact[];
  reviews: readonly LearningReportReviewFact[];
  learnedWordCount: number | null;
}>;

export interface LearningReportRepository {
  getTimezone(userId: string): Promise<string>;
  loadSnapshot(
    input: Readonly<{
      userId: string;
      timezone: string;
      windowStart: string;
      windowEnd: string;
      learningDate: string;
    }>,
  ): Promise<LearningReportSnapshot>;
}

type LearningReportPrismaClient = Pick<
  PrismaClient,
  | '$transaction'
  | 'learnerProfile'
  | 'learningAttempt'
  | 'learningItemState'
  | 'wordBookRecord'
>;

function nextIsoDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

function zonedStartOfDay(date: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter(({ type }) => type !== 'literal')
        .map(({ type, value }) => [type, Number(value)]),
    );
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    guess += target - represented;
  }
  return new Date(guess);
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    [
      ...new Set(
        value.filter((item): item is string => typeof item === 'string'),
      ),
    ]
      .map((item) => item.normalize('NFKC').trim())
      .filter(Boolean)
      .slice(0, 50),
  );
}

function version(input: {
  attempts: readonly { id: string; savedAt: Date }[];
  reviews: readonly { id: string; updatedAt: Date }[];
  learnedWordCount: number;
}): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        attempts: input.attempts.map(({ id, savedAt }) => [
          id,
          savedAt.toISOString(),
        ]),
        reviews: input.reviews.map(({ id, updatedAt }) => [
          id,
          updatedAt.toISOString(),
        ]),
        learnedWordCount: input.learnedWordCount,
      }),
    )
    .digest('hex')
    .slice(0, 24);
  return `learning-report.${digest}`;
}

export class PrismaLearningReportRepository implements LearningReportRepository {
  constructor(private readonly prisma: LearningReportPrismaClient) {}

  async getTimezone(userId: string): Promise<string> {
    const profile = await this.prisma.learnerProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return profile?.timezone ?? 'Asia/Shanghai';
  }

  async loadSnapshot(
    input: Readonly<{
      userId: string;
      timezone: string;
      windowStart: string;
      windowEnd: string;
      learningDate: string;
    }>,
  ): Promise<LearningReportSnapshot> {
    const windowStart = zonedStartOfDay(input.windowStart, input.timezone);
    const windowEnd = zonedStartOfDay(
      nextIsoDate(input.windowEnd),
      input.timezone,
    );
    const learningDayEnd = zonedStartOfDay(
      nextIsoDate(input.learningDate),
      input.timezone,
    );
    const [attempts, reviews, learnedWordCount] =
      await this.prisma.$transaction([
        this.prisma.learningAttempt.findMany({
          where: {
            userId: input.userId,
            savedAt: { gte: windowStart, lt: windowEnd },
          },
          orderBy: [{ savedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            savedAt: true,
            score: true,
            errorTypes: true,
            reviewEvents: {
              where: { userId: input.userId, voidedAt: null },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: { targetType: true, targetKey: true },
            },
          },
        }),
        this.prisma.learningItemState.findMany({
          where: {
            userId: input.userId,
            targetType: 'WORD',
            wordId: { not: null },
            dueAt: { not: null, lt: learningDayEnd },
            reviewState: { in: ['LEARNING', 'REVIEW', 'MASTERED'] },
          },
          orderBy: [{ dueAt: 'asc' }, { targetKey: 'asc' }],
          select: {
            id: true,
            targetKey: true,
            reviewState: true,
            dueAt: true,
            lastReviewedAt: true,
            lastQuality: true,
            updatedAt: true,
            word: { select: { id: true, word: true } },
          },
        }),
        this.prisma.wordBookRecord.count({
          where: { userId: input.userId, isMaster: true },
        }),
      ]);

    const attemptFacts = attempts.map((attempt) =>
      Object.freeze({
        id: attempt.id,
        occurredAt: attempt.savedAt,
        score: attempt.score,
        wordIds: Object.freeze(
          [
            ...new Set(
              attempt.reviewEvents
                .filter(({ targetType }) => targetType === 'WORD')
                .map(({ targetKey }) => targetKey),
            ),
          ].sort(),
        ),
        errorTypes: stringArray(attempt.errorTypes),
      }),
    );
    const reviewFacts = reviews
      .filter(
        (
          review,
        ): review is typeof review & {
          dueAt: Date;
          word: NonNullable<typeof review.word>;
        } => Boolean(review.dueAt && review.word),
      )
      .map((review, index) =>
        Object.freeze({
          wordId: review.word.id,
          word: review.word.word,
          reviewState:
            review.reviewState as LearningReportReviewFact['reviewState'],
          dueAt: review.dueAt,
          completedAt: review.lastReviewedAt,
          priority: index + 1,
          reason:
            review.lastQuality !== null && review.lastQuality < 3
              ? 'Recent evidence is weak and review is due.'
              : 'Scheduled review is due.',
        }),
      );
    const timestamps = [
      ...attempts.map(({ savedAt }) => savedAt),
      ...reviews.map(({ updatedAt }) => updatedAt),
    ];
    const updatedAt = timestamps.length
      ? new Date(Math.max(...timestamps.map((value) => value.getTime())))
      : windowEnd;

    return Object.freeze({
      timezone: input.timezone,
      contentVersion: version({ attempts, reviews, learnedWordCount }),
      updatedAt,
      attempts: Object.freeze(attemptFacts),
      reviews: Object.freeze(reviewFacts),
      learnedWordCount,
    });
  }
}
