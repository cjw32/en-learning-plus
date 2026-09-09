import {
  ReviewScheduleService,
  type ReviewScheduleRepository,
} from './review-schedule.service';

describe('ReviewScheduleService', () => {
  it('uses the learner local day, owned course scope, stable ordering and cap', async () => {
    const calls: unknown[] = [];
    const repository: ReviewScheduleRepository = {
      async findPurchasedCourseTag(subjectId, courseId) {
        calls.push(['course', subjectId, courseId]);
        return 'cet4';
      },
      async findDueWordStates(subjectId, query) {
        calls.push(['due', subjectId, query]);
        return {
          total: 3,
          rows: [
            {
              wordId: 'word-1',
              word: 'alpha',
              definition: 'first',
              translation: '第一',
              reviewState: 'REVIEW',
              dueAt: new Date('2026-09-01T15:00:00.000Z'),
              lastQuality: 1,
            },
            {
              wordId: 'word-2',
              word: 'beta',
              definition: 'second',
              translation: '第二',
              reviewState: 'LEARNING',
              dueAt: new Date('2026-09-01T16:00:00.000Z'),
              lastQuality: 2,
            },
          ],
        };
      },
    };
    const service = new ReviewScheduleService(repository, () =>
      new Date('2026-09-02T02:00:00.000Z'),
    );

    const first = await service.getDueWords('user-a', {
      learningDate: '2026-09-02',
      timezone: 'Asia/Shanghai',
      limit: 2,
      courseId: 'course-a',
    });
    const second = await service.getDueWords('user-a', {
      learningDate: '2026-09-02',
      timezone: 'Asia/Shanghai',
      limit: 2,
      courseId: 'course-a',
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ totalDue: 3, truncated: true });
    expect(first.words.map((word) => word.word)).toEqual(['alpha', 'beta']);
    expect(calls[1]).toEqual([
      'due',
      'user-a',
      expect.objectContaining({
        before: new Date('2026-09-02T16:00:00.000Z'),
        courseTag: 'cet4',
        limit: 2,
      }),
    ]);
  });

  it('returns an empty successful result and rejects invalid timezone/foreign course', async () => {
    const repository: ReviewScheduleRepository = {
      async findPurchasedCourseTag() {
        return null;
      },
      async findDueWordStates() {
        return { rows: [], total: 0 };
      },
    };
    const service = new ReviewScheduleService(repository);
    await expect(
      service.getDueWords('user-a', {
        learningDate: '2026-09-02',
        timezone: 'Invalid/Timezone',
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.getDueWords('user-a', {
        learningDate: '2026-09-02',
        timezone: 'Asia/Shanghai',
        limit: 10,
        courseId: 'foreign',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

