import { CoachTraceService } from '../../src/coach/observability/coach-trace.service';
import { decideNextAction } from '../../src/coach/workflow/next-action.policy';

describe('Coach recommendation trace reconciliation', () => {
  it.each([
    {
      name: 'low current quality',
      qualities: [2],
      dueCount: 4,
      saveStatus: 'saved' as const,
      action: 'practice' as const,
      evidence: 'CURRENT_QUALITY_BELOW_FOUR',
    },
    {
      name: 'acceptable result with due items',
      qualities: [4],
      dueCount: 2,
      saveStatus: 'replayed' as const,
      action: 'review' as const,
      evidence: 'DUE_ITEMS_AVAILABLE',
    },
    {
      name: 'good result without due items',
      qualities: [5],
      dueCount: 0,
      saveStatus: 'saved' as const,
      action: 'continue' as const,
      evidence: 'NO_LOW_QUALITY_OR_DUE_ITEMS',
    },
    {
      name: 'grade valid but save failed',
      qualities: [3],
      dueCount: 0,
      saveStatus: 'not_saved' as const,
      action: 'practice' as const,
      evidence: 'CURRENT_QUALITY_BELOW_FOUR',
    },
  ])('records safe facts for $name', (scenario) => {
    const decision = decideNextAction({
      validCurrentQualities: scenario.qualities,
      dueCount: scenario.dueCount,
      profileSignals: [],
    });
    const trace = new CoachTraceService(
      'trace_recommendation_001',
      'subject_hash_001',
    );
    trace.recordRecommendation({
      nextAction: decision.nextAction,
      evidenceCodes: decision.evidenceCodes,
      learningSaveStatus: scenario.saveStatus,
    });
    const snapshot = trace.snapshot();
    expect(snapshot.recommendation).toEqual({
      nextAction: scenario.action,
      evidenceCodes: [scenario.evidence],
      learningSaveStatus: scenario.saveStatus,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /private answer|raw answer|prompt|reasoning/i,
    );
  });

  it('rejects unknown evidence instead of placing it in Trace', () => {
    const trace = new CoachTraceService(
      'trace_recommendation_002',
      'subject_hash_002',
    );
    expect(() =>
      trace.recordRecommendation({
        nextAction: 'continue',
        evidenceCodes: ['PRIVATE_RAW_ANSWER'] as never,
        learningSaveStatus: 'not_saved',
      }),
    ).toThrow('recommendation evidence');
  });
});
