import { buildVerifiedRagPersonalization } from '../../src/coach/workflow/coach-runtime.workflow';

const now = new Date('2026-09-08T12:00:00.000Z');

describe('verified RAG personalization filters', () => {
  it('applies only current verified profile and due-word facts', () => {
    const result = buildVerifiedRagPersonalization(
      {
        schemaVersion: 'coach.tool.v1',
        ok: true,
        snapshotAt: now.toISOString(),
        timezone: 'Asia/Shanghai',
        level: { cefr: 'B1', source: 'USER_DECLARED' },
        goal: { type: 'EXAM', text: 'Prepare for a test' },
        activeCourse: { id: 'course-a', name: 'Course A', value: 'course-a' },
        learnedWordSummary: {
          legacyCompletedCount: 0,
          coachEngagedCount: 2,
          recentWords: [],
        },
        weakItems: [
          {
            targetType: 'WORD',
            targetKey: 'word-weak',
            label: 'weak',
            reviewState: 'LEARNING',
            lastQuality: 2,
            dueAt: null,
          },
        ],
        errorTypes: [],
        recentPerformance: {
          attemptCount: 2,
          averageScore: 65,
          windowStart: '2026-09-01T00:00:00.000Z',
        },
        signals: [
          { dimension: 'LEVEL', status: 'AVAILABLE' },
          { dimension: 'GOAL', status: 'AVAILABLE' },
          { dimension: 'WEAK_ITEMS', status: 'AVAILABLE' },
          { dimension: 'RECENT_PERFORMANCE', status: 'AVAILABLE' },
          { dimension: 'ACTIVE_COURSE', status: 'AVAILABLE' },
        ],
      },
      {
        schemaVersion: 'coach.tool.v1',
        ok: true,
        asOf: now.toISOString(),
        totalDue: 1,
        truncated: false,
        words: [
          {
            wordId: 'word-due',
            word: 'due',
            definition: null,
            translation: null,
            reviewState: 'REVIEW',
            dueAt: '2026-09-08T00:00:00.000Z',
            priority: 1,
            reason: 'due',
            citation: {
              sourceId: 'word:due',
              materialType: 'word',
              title: 'due',
              locator: null,
              supports: 'due',
              accessScope: 'PUBLIC',
            },
          },
        ],
      },
      true,
      now,
    );

    expect(result.filters).toMatchObject({
      levels: ['B1'],
      courseIds: ['course-a'],
      wordIds: ['word-weak', 'word-due'],
      accessScopes: ['PUBLIC', 'OWNED_COURSE', 'PRIVATE_OWNER'],
    });
    expect(result.filters.categories).toEqual(
      expect.arrayContaining(['USER_ERROR', 'LEARNING_SUMMARY']),
    );
    expect(result.application).toMatchObject({
      level: 'APPLIED',
      course: 'APPLIED',
      goal: 'APPLIED',
      weakItems: 'APPLIED',
      dueWords: 'APPLIED',
      privateContent: 'APPLIED',
    });
  });

  it('does not infer filters from missing or stale signals', () => {
    const result = buildVerifiedRagPersonalization(
      {
        schemaVersion: 'coach.tool.v1',
        ok: true,
        snapshotAt: now.toISOString(),
        timezone: 'Asia/Shanghai',
        level: { cefr: 'C2', source: 'USER_DECLARED' },
        goal: { type: 'CUSTOM', text: 'must not apply' },
        activeCourse: { id: 'course-stale', name: 'Stale', value: 'stale' },
        learnedWordSummary: {
          legacyCompletedCount: 0,
          coachEngagedCount: 0,
          recentWords: [],
        },
        weakItems: [
          {
            targetType: 'WORD',
            targetKey: 'word-stale',
            label: 'stale',
            reviewState: 'LEARNING',
            lastQuality: 0,
            dueAt: null,
          },
        ],
        errorTypes: [],
        recentPerformance: {
          attemptCount: 1,
          averageScore: 0,
          windowStart: '2026-01-01T00:00:00.000Z',
        },
        signals: [
          { dimension: 'LEVEL', status: 'MISSING' },
          { dimension: 'GOAL', status: 'STALE' },
          { dimension: 'WEAK_ITEMS', status: 'STALE' },
          { dimension: 'RECENT_PERFORMANCE', status: 'STALE' },
          { dimension: 'ACTIVE_COURSE', status: 'MISSING' },
        ],
      },
      null,
      true,
      now,
    );

    expect(result.filters).toMatchObject({
      levels: [],
      courseIds: [],
      wordIds: [],
      accessScopes: ['PUBLIC'],
    });
    expect(result.filters.categories).not.toEqual(
      expect.arrayContaining(['USER_ERROR', 'LEARNING_SUMMARY']),
    );
    expect(result.application).toMatchObject({
      level: 'MISSING',
      course: 'MISSING',
      goal: 'STALE',
      weakItems: 'STALE',
      dueWords: 'UNAVAILABLE',
      privateContent: 'UNAVAILABLE',
    });
  });
});
