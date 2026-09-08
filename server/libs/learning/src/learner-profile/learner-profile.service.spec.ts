import {
  LearnerProfileRepository,
  LearnerProfileService,
} from './learner-profile.service';

function repository(): LearnerProfileRepository {
  let profile: any = null;
  return {
    async findProfile() {
      return profile;
    },
    async findPurchasedCourse(subjectId, courseId) {
      if (subjectId === 'user-a' && courseId === 'course-owned') {
        return { id: courseId, name: 'CET4', value: 'cet4' };
      }
      return null;
    },
    async upsertProfile(_subjectId, update) {
      profile = {
        cefrLevel: null,
        levelSource: null,
        goalType: null,
        goalText: null,
        activeCourseId: null,
        timezone: 'Asia/Shanghai',
        updatedAt: new Date('2026-09-02T00:00:00.000Z'),
        ...profile,
        ...update,
      };
      return profile;
    },
    async readSignals() {
      return {
        legacyCompletedCount: 0,
        coachEngagedCount: 0,
        recentWords: [],
        weakItems: [],
        errorTypes: [],
        recentPerformance: {
          attemptCount: 0,
          averageScore: null,
          windowStart: new Date('2026-08-03T00:00:00.000Z'),
        },
      };
    },
  };
}

describe('LearnerProfileService', () => {
  it('returns an explicit missing snapshot without inventing a CEFR level', async () => {
    const service = new LearnerProfileService(repository());
    const snapshot = await service.getSnapshot('user-a', 10);

    expect(snapshot.level).toBeNull();
    expect(snapshot.goal).toBeNull();
    expect(snapshot.activeCourse).toBeNull();
    expect(snapshot.learnedWordSummary).toEqual({
      legacyCompletedCount: 0,
      coachEngagedCount: 0,
      recentWords: [],
    });
    expect(snapshot.signals).toEqual(
      expect.arrayContaining([
        { dimension: 'LEVEL', status: 'MISSING' },
        { dimension: 'LEARNED_WORDS', status: 'AVAILABLE' },
        { dimension: 'WEAK_ITEMS', status: 'NOT_APPLICABLE' },
        { dimension: 'RECENT_PERFORMANCE', status: 'MISSING' },
      ]),
    );
  });

  it('accepts controlled CEFR/goal/timezone and an owned purchased course', async () => {
    const service = new LearnerProfileService(repository());
    const profile = await service.updateProfile('user-a', {
      cefrLevel: 'A2',
      goalType: 'TRAVEL',
      goalText: 'Handle airport conversations',
      timezone: 'Asia/Shanghai',
      activeCourseId: 'course-owned',
    });
    expect(profile).toMatchObject({
      cefrLevel: 'A2',
      levelSource: 'USER_DECLARED',
      goalType: 'TRAVEL',
      activeCourseId: 'course-owned',
    });
  });

  it('rejects an unpurchased course without exposing its existence', async () => {
    const service = new LearnerProfileService(repository());
    await expect(
      service.updateProfile('user-a', { activeCourseId: 'course-foreign' }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: '学习资源不存在或不可访问',
    });
  });

  it('rejects invalid timezone and free-form enum injection', async () => {
    const service = new LearnerProfileService(repository());
    await expect(
      service.updateProfile('user-a', {
        timezone: 'not/a_timezone',
        cefrLevel: 'EXPERT' as never,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
