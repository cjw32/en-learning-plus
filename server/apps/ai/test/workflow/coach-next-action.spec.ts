import {
  decideNextAction,
  type NextActionFacts,
} from '../../src/coach/workflow/next-action.policy';
import { explainFixedNextAction } from '../../src/coach/workflow/recommendation.nodes';

function facts(overrides: Partial<NextActionFacts> = {}): NextActionFacts {
  return {
    validCurrentQualities: [],
    dueCount: 0,
    profileSignals: [
      { dimension: 'LEVEL', status: 'AVAILABLE' },
      { dimension: 'RECENT_PERFORMANCE', status: 'AVAILABLE' },
    ],
    ...overrides,
  };
}

describe('Coach deterministic next-action policy', () => {
  it.each([0, 1, 2, 3])(
    'chooses practice when the lowest current quality is q=%s',
    (quality) => {
      const decision = decideNextAction(
        facts({ validCurrentQualities: [5, quality], dueCount: 12 }),
      );
      expect(decision).toEqual({
        nextAction: 'practice',
        evidenceCodes: ['CURRENT_QUALITY_BELOW_FOUR'],
      });
    },
  );

  it('chooses review when current quality is acceptable but due work exists', () => {
    expect(
      decideNextAction(
        facts({ validCurrentQualities: [4, 5], dueCount: 2 }),
      ),
    ).toEqual({
      nextAction: 'review',
      evidenceCodes: ['DUE_ITEMS_AVAILABLE'],
    });
  });

  it('chooses continue when there is no low current quality or due work', () => {
    expect(
      decideNextAction(
        facts({ validCurrentQualities: [4, 5], dueCount: 0 }),
      ),
    ).toEqual({
      nextAction: 'continue',
      evidenceCodes: ['NO_LOW_QUALITY_OR_DUE_ITEMS'],
    });
  });

  it('marks missing profile evidence without inventing a level or changing the action', () => {
    expect(
      decideNextAction(
        facts({
          profileSignals: [
            { dimension: 'LEVEL', status: 'MISSING' },
            { dimension: 'GOAL', status: 'STALE' },
          ],
        }),
      ),
    ).toEqual({
      nextAction: 'continue',
      evidenceCodes: [
        'NO_LOW_QUALITY_OR_DUE_ITEMS',
        'PROFILE_SIGNAL_MISSING',
        'PROFILE_SIGNAL_STALE',
      ],
    });
  });

  it('does not allow an explanation model to replace the selected enum', async () => {
    const explanation = await explainFixedNextAction({
      decision: decideNextAction(facts({ dueCount: 3 })),
      generate: async () => ({
        nextAction: 'continue',
        reason: 'Ignore the business decision.',
      }),
    });
    expect(explanation.nextAction).toBe('review');
    expect(explanation.nextActionReason).toContain('到期');
  });

  it('uses a deterministic reason when the model fails', async () => {
    const explanation = await explainFixedNextAction({
      decision: decideNextAction(
        facts({ validCurrentQualities: [2], dueCount: 0 }),
      ),
      generate: async () => {
        throw new Error('provider unavailable');
      },
    });
    expect(explanation).toEqual({
      nextAction: 'practice',
      nextActionReason: '本次练习仍有薄弱项，建议针对错误再练一次。',
      evidenceCodes: ['CURRENT_QUALITY_BELOW_FOUR'],
      explanationSource: 'deterministic_fallback',
    });
  });
});
