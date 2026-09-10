import { recommendPronunciationNextAction } from '@libs/learning';

describe('pronunciation Coach recommendation evaluation', () => {
  it.each([
    ['REFERENCE_ONLY', 'ACTIVE', 0, 0, 'retry'],
    ['REJECTED', 'ACTIVE', 2, 1, 'retry'],
    ['RELIABLE', 'UNAVAILABLE', 2, 1, 'retry'],
    ['RELIABLE', 'ACTIVE', 1, 0, 'review'],
    ['RELIABLE', 'ACTIVE', 0, 1, 'review'],
    ['RELIABLE', 'ACTIVE', 0, 0, 'continue'],
  ] as const)(
    'grounds %s/%s with %i weak and %i review changes as %s',
    (
      confidenceTier,
      sourceStatus,
      weakWordCount,
      reviewChangeCount,
      expected,
    ) => {
      const decision = recommendPronunciationNextAction({
        assessmentStatus:
          confidenceTier === 'REJECTED' ? 'UNRECOGNIZABLE' : 'COMPLETED',
        confidenceTier,
        sourceStatus,
        weakWordCount,
        reviewChangeCount,
      });

      expect(decision.nextAction).toBe(expected);
      expect(decision.reason).toMatch(/评测|录音|来源|薄弱|复习|继续/);
      expect(decision.reason).not.toMatch(/诊断|病理|绝对|口音不正确/);
    },
  );

  it('never treats unreliable facts as confirmed learning evidence', () => {
    const decision = recommendPronunciationNextAction({
      assessmentStatus: 'REFERENCE_ONLY',
      confidenceTier: 'REFERENCE_ONLY',
      sourceStatus: 'ACTIVE',
      weakWordCount: 12,
      reviewChangeCount: 8,
    });

    expect(decision).toEqual({
      nextAction: 'retry',
      reason: '本次评测仅供参考，请改善录音条件后重新朗读。',
    });
  });
});
