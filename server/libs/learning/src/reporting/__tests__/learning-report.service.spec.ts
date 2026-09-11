import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type ReportSnapshot = Readonly<{
  timezone: string;
  contentVersion: string;
  updatedAt: Date;
  attempts: readonly Readonly<{
    id: string;
    occurredAt: Date;
    score: number;
    wordIds: readonly string[];
    errorTypes: readonly string[];
  }>[];
  reviews: readonly Readonly<{
    wordId: string;
    word: string;
    reviewState: 'LEARNING' | 'REVIEW' | 'MASTERED';
    dueAt: Date;
    completedAt: Date | null;
    priority: number;
    reason: string;
  }>[];
  learnedWordCount: number | null;
}>;

type ReportRepository = Readonly<{
  getTimezone(userId: string): Promise<string>;
  loadSnapshot(
    input: Readonly<{
      userId: string;
      timezone: string;
      windowStart: string;
      windowEnd: string;
      learningDate: string;
    }>,
  ): Promise<ReportSnapshot>;
}>;

type LearningReportService = Readonly<{
  getDueReviews(
    input: Readonly<{
      userId: string;
      limit: number;
      cursor?: string;
    }>,
  ): Promise<unknown>;
  getSummary(input: Readonly<{ userId: string }>): Promise<unknown>;
  getWeaknesses(
    input: Readonly<{
      userId: string;
      limit: number;
      cursor?: string;
    }>,
  ): Promise<unknown>;
}>;

type LearningReportServiceConstructor = new (
  repository: ReportRepository,
  options: Readonly<{
    now: () => Date;
    summaryWindowDays: number;
    weaknessStaleAfterDays: number;
    weaknessMinimumEvidence: number;
  }>,
) => LearningReportService;

const implementationPath = resolve(__dirname, '../learning-report.service.ts');

function loadService(): LearningReportServiceConstructor {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing LearningReportService (T055)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Service = require(implementationPath).LearningReportService as
    | LearningReportServiceConstructor
    | undefined;
  if (!Service) throw new Error('Missing LearningReportService export (T055)');
  return Service;
}

const now = new Date('2026-09-11T00:30:00.000Z');

function snapshot(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return Object.freeze({
    timezone: 'Asia/Shanghai',
    contentVersion: 'learning-report-fixture.v1',
    updatedAt: new Date('2026-09-11T00:20:00.000Z'),
    attempts: Object.freeze([]),
    reviews: Object.freeze([]),
    learnedWordCount: null,
    ...overrides,
  });
}

function fixture(overrides: Partial<ReportSnapshot> = {}) {
  const value = snapshot(overrides);
  const repository: ReportRepository = {
    getTimezone: jest.fn(async () => value.timezone),
    loadSnapshot: jest.fn(async () => value),
  };
  const Service = loadService();
  const service = new Service(repository, {
    now: () => new Date(now),
    summaryWindowDays: 7,
    weaknessStaleAfterDays: 14,
    weaknessMinimumEvidence: 2,
  });
  return { service, repository };
}

describe('LearningReportService deterministic aggregation', () => {
  it('returns legal empty states without inventing performance', async () => {
    const test = fixture();

    await expect(
      test.service.getDueReviews({ userId: 'learner_a', limit: 20 }),
    ).resolves.toMatchObject({
      learningDate: '2026-09-11',
      timezone: 'Asia/Shanghai',
      totalDue: 0,
      items: [],
      contentVersion: 'learning-report-fixture.v1',
    });
    await expect(
      test.service.getSummary({ userId: 'learner_a' }),
    ).resolves.toMatchObject({
      report: {
        attemptCount: 0,
        averageScore: null,
        reviewsDue: 0,
        reviewsCompleted: 0,
        dataCompleteness: 'insufficient',
      },
    });
    await expect(
      test.service.getWeaknesses({ userId: 'learner_a', limit: 10 }),
    ).resolves.toMatchObject({
      dataCompleteness: 'insufficient',
      items: [],
    });
  });

  it.each([
    {
      timezone: 'Asia/Shanghai',
      learningDate: '2026-09-11',
      windowStart: '2026-09-05',
    },
    {
      timezone: 'America/Los_Angeles',
      learningDate: '2026-09-10',
      windowStart: '2026-09-04',
    },
  ])(
    'uses the learner timezone $timezone at a UTC date boundary',
    async ({ timezone, learningDate, windowStart }) => {
      const test = fixture({ timezone });
      await test.service.getSummary({ userId: 'learner_a' });

      expect(test.repository.loadSnapshot).toHaveBeenCalledWith({
        userId: 'learner_a',
        timezone,
        learningDate,
        windowStart,
        windowEnd: learningDate,
      });
    },
  );

  it('selects due reviews in stable dueAt/id order and respects the bound', async () => {
    const test = fixture({
      reviews: Object.freeze([
        {
          wordId: 'word_c',
          word: 'close',
          reviewState: 'REVIEW',
          dueAt: new Date('2026-09-11T00:20:00.000Z'),
          completedAt: null,
          priority: 30,
          reason: 'Due now.',
        },
        {
          wordId: 'word_b',
          word: 'business',
          reviewState: 'LEARNING',
          dueAt: new Date('2026-09-10T23:00:00.000Z'),
          completedAt: null,
          priority: 20,
          reason: 'Initial review.',
        },
        {
          wordId: 'word_a',
          word: 'agenda',
          reviewState: 'REVIEW',
          dueAt: new Date('2026-09-10T23:00:00.000Z'),
          completedAt: null,
          priority: 10,
          reason: 'Due now.',
        },
        {
          wordId: 'word_future',
          word: 'future',
          reviewState: 'REVIEW',
          dueAt: new Date('2026-09-11T01:00:00.000Z'),
          completedAt: null,
          priority: 40,
          reason: 'Not due yet.',
        },
      ]),
    });

    await expect(
      test.service.getDueReviews({ userId: 'learner_a', limit: 2 }),
    ).resolves.toMatchObject({
      totalDue: 3,
      items: [
        { wordId: 'word_a', dueAt: '2026-09-10T23:00:00.000Z' },
        { wordId: 'word_b', dueAt: '2026-09-10T23:00:00.000Z' },
      ],
      truncated: true,
    });
  });

  it('computes summary counts and a deterministic rounded score', async () => {
    const test = fixture({
      learnedWordCount: 12,
      attempts: Object.freeze([
        {
          id: 'attempt_a',
          occurredAt: new Date('2026-09-09T08:00:00.000Z'),
          score: 83,
          wordIds: ['word_a'],
          errorTypes: ['article_usage'],
        },
        {
          id: 'attempt_b',
          occurredAt: new Date('2026-09-10T08:00:00.000Z'),
          score: 88,
          wordIds: ['word_b'],
          errorTypes: [],
        },
      ]),
      reviews: Object.freeze([
        {
          wordId: 'word_a',
          word: 'agenda',
          reviewState: 'REVIEW',
          dueAt: new Date('2026-09-09T07:00:00.000Z'),
          completedAt: new Date('2026-09-09T08:00:00.000Z'),
          priority: 10,
          reason: 'Completed.',
        },
        {
          wordId: 'word_b',
          word: 'business',
          reviewState: 'REVIEW',
          dueAt: new Date('2026-09-10T07:00:00.000Z'),
          completedAt: null,
          priority: 20,
          reason: 'Due.',
        },
      ]),
    });

    await expect(
      test.service.getSummary({ userId: 'learner_a' }),
    ).resolves.toMatchObject({
      report: {
        windowStart: '2026-09-05',
        windowEnd: '2026-09-11',
        attemptCount: 2,
        averageScore: 86,
        reviewsDue: 2,
        reviewsCompleted: 1,
        learnedWordCount: 12,
        dataCompleteness: 'complete',
        policyVersion: 'learning-report.v1',
      },
    });
  });

  it('aggregates and stably orders current and stale weakness evidence', async () => {
    const test = fixture({
      attempts: Object.freeze([
        {
          id: 'attempt_recent_a',
          occurredAt: new Date('2026-09-10T08:00:00.000Z'),
          score: 60,
          wordIds: ['word_agenda'],
          errorTypes: ['article_usage'],
        },
        {
          id: 'attempt_recent_b',
          occurredAt: new Date('2026-09-09T08:00:00.000Z'),
          score: 65,
          wordIds: ['word_agenda'],
          errorTypes: ['article_usage'],
        },
        {
          id: 'attempt_old_a',
          occurredAt: new Date('2026-08-20T08:00:00.000Z'),
          score: 55,
          wordIds: ['word_budget'],
          errorTypes: ['verb_tense'],
        },
        {
          id: 'attempt_old_b',
          occurredAt: new Date('2026-08-19T08:00:00.000Z'),
          score: 50,
          wordIds: ['word_budget'],
          errorTypes: ['verb_tense'],
        },
      ]),
    });

    await expect(
      test.service.getWeaknesses({ userId: 'learner_a', limit: 3 }),
    ).resolves.toMatchObject({
      dataCompleteness: 'complete',
      items: [
        {
          type: 'error_type',
          key: 'article_usage',
          count: 2,
          evidenceStatus: 'current',
        },
        {
          type: 'error_type',
          key: 'verb_tense',
          count: 2,
          evidenceStatus: 'stale',
        },
        {
          type: 'word',
          key: 'word_agenda',
          count: 2,
          evidenceStatus: 'current',
        },
      ],
    });
  });
});
