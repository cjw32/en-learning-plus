import { ExerciseTargetingService } from './exercise-targeting.service';

describe('ExerciseTargetingService', () => {
  it('selects due and weak targets in stable order and adds a one-level challenge', () => {
    const service = new ExerciseTargetingService();
    const input = {
      profile: {
        level: { cefr: 'A2' as const, source: 'USER_DECLARED' as const },
        weakItems: [
          {
            targetType: 'ERROR_TYPE' as const,
            targetKey: 'TENSE',
            label: 'TENSE',
            reviewState: 'LEARNING' as const,
            lastQuality: 2,
            dueAt: null,
          },
        ],
        recentPerformance: { attemptCount: 4, averageScore: 90 },
      },
      dueWords: [
        { wordId: 'word-2', word: 'beta', priority: 2 },
        { wordId: 'word-1', word: 'alpha', priority: 1 },
      ],
      limit: 3,
    };
    const first = service.select(input);
    const second = service.select(input);
    expect(first).toEqual(second);
    expect(first.difficulty).toBe('B1');
    expect(first.challengeNotice).toContain('一级挑战');
    expect(first.targets.map((target) => target.targetKey)).toEqual([
      'word-1',
      'word-2',
      'TENSE',
    ]);
  });

  it('uses UNKNOWN difficulty and an explicit fallback reason when level is missing', () => {
    const selected = new ExerciseTargetingService().select({
      profile: {
        level: null,
        weakItems: [],
        recentPerformance: { attemptCount: 0, averageScore: null },
      },
      dueWords: [{ wordId: 'word-1', word: 'alpha', priority: 1 }],
      limit: 1,
    });
    expect(selected.difficulty).toBe('UNKNOWN');
    expect(selected.personalizationReason).toContain('尚未设置英语水平');
  });
});
