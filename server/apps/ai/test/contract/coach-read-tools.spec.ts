import {
  getLearnerProfileOutputSchema,
  searchLearningMaterialsOutputSchema,
} from '@en/common/coach';
import { createCoachExecutionContext } from '@libs/shared';
import { GetLearnerProfileTool } from '../../src/coach/tools/get-learner-profile.tool';
import { SearchLearningMaterialsTool } from '../../src/coach/tools/search-learning-materials.tool';
import { GetDueWordsTool } from '../../src/coach/tools/get-due-words.tool';

const context = createCoachExecutionContext(
  { userId: 'user-a', tokenType: 'access', exp: 1_788_307_260 },
  1_788_307_200,
);

describe('Coach read tool adapters', () => {
  it('uses only the immutable context subject for learner profile reads', async () => {
    const profiles = {
      getSnapshot: jest.fn(async () => ({
        snapshotAt: new Date('2026-09-02T00:00:00.000Z'),
        level: { cefr: 'A2', source: 'USER_DECLARED' },
        goal: null,
        activeCourse: null,
        timezone: 'Asia/Shanghai',
        learnedWordSummary: {
          legacyCompletedCount: 0,
          coachEngagedCount: 0,
          recentWords: [],
        },
        weakItems: [],
        errorTypes: [],
        recentPerformance: {
          attemptCount: 0,
          averageScore: null,
          windowStart: new Date('2026-08-03T00:00:00.000Z'),
        },
        signals: [{ dimension: 'LEVEL', status: 'AVAILABLE' }],
      })),
    };
    const output = await new GetLearnerProfileTool(profiles as never).execute(
      context,
      {
        schemaVersion: 'coach.tool.v1',
        dimensions: ['LEVEL'],
        perDimensionLimit: 10,
      },
    );
    expect(profiles.getSnapshot).toHaveBeenCalledWith('user-a', 10);
    expect(getLearnerProfileOutputSchema.safeParse(output).success).toBe(true);
  });

  it('rejects input identity before calling the learning service', async () => {
    const profiles = { getSnapshot: jest.fn() };
    const output = await new GetLearnerProfileTool(profiles as never).execute(
      context,
      {
        schemaVersion: 'coach.tool.v1',
        dimensions: ['LEVEL'],
        perDimensionLimit: 10,
        userId: 'user-b',
      },
    );
    expect(output).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(profiles.getSnapshot).not.toHaveBeenCalled();
  });

  it('returns validated owned material results', async () => {
    const materials = {
      search: jest.fn(async () => ({
        query: 'went',
        materials: [
          {
            citation: {
              sourceId: 'word:went',
              materialType: 'word',
              title: 'went',
              locator: 'dictionary/went',
              supports: 'past tense',
              accessScope: 'PUBLIC',
            },
            summary: 'past tense',
            freshness: new Date('2026-09-01T00:00:00.000Z'),
          },
        ],
        unavailableTypes: [],
      })),
    };
    const output = await new SearchLearningMaterialsTool(
      materials as never,
    ).execute(context, {
      schemaVersion: 'coach.tool.v1',
      query: 'went',
      materialTypes: ['word'],
      limit: 5,
    });
    expect(materials.search).toHaveBeenCalledWith(
      'user-a',
      expect.not.objectContaining({ userId: expect.anything() }),
    );
    expect(searchLearningMaterialsOutputSchema.safeParse(output).success).toBe(
      true,
    );
  });

  it('validates, caches, and times out due-word reads without accepting identity', async () => {
    const schedules = {
      getDueWords: jest.fn(async () => ({
        asOf: new Date('2026-09-02T00:00:00.000Z'),
        words: [],
        totalDue: 0,
        truncated: false,
      })),
    };
    const tool = new GetDueWordsTool(schedules as never, 20);
    const input = {
      schemaVersion: 'coach.tool.v1',
      learningDate: '2026-09-02',
      timezone: 'Asia/Shanghai',
      limit: 10,
    } as const;
    const first = await tool.execute(context, input);
    const second = await tool.execute(context, input);
    expect(first).toEqual(second);
    expect(schedules.getDueWords).toHaveBeenCalledTimes(1);
    expect(schedules.getDueWords).toHaveBeenCalledWith('user-a', {
      learningDate: '2026-09-02',
      timezone: 'Asia/Shanghai',
      limit: 10,
    });
    expect(
      await tool.execute(context, { ...input, userId: 'user-b' }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });

    const blocked = new GetDueWordsTool(
      { getDueWords: () => new Promise(() => undefined) } as never,
      5,
    );
    await expect(blocked.execute(context, input)).resolves.toMatchObject({
      ok: false,
      code: 'TOOL_TIMEOUT',
      retryable: true,
    });
  });
});
