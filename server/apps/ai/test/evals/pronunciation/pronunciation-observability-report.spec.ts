import { buildPronunciationObservabilityReport } from './pronunciation-observability-report';

const completeTrace = {
  assessmentId: 'assessment-1',
  traceId: 'trace-1',
  terminalStatus: 'COMPLETED',
  durations: { uploadMs: 1, queueMs: 2, providerMs: 3, totalMs: 6 },
  cost: { actualMicros: 10, currency: 'USD' },
  versions: {
    dataset: 'synthetic-v1',
    provider: 'fake',
    model: 'fake-v1',
    rule: 'rules-v1',
    schema: 'result-v1',
    normalization: 'normalization-v1',
    budget: 'budget-v1',
    price: 'price-v1',
  },
  stepsComplete: true,
};

describe('pronunciation observability completeness report', () => {
  it('requires 100% Trace linkage and complete dimensions', () => {
    const report = buildPronunciationObservabilityReport({
      assessmentIds: ['assessment-1'],
      traces: [completeTrace],
    });
    expect(report).toMatchObject({
      assessmentCount: 1,
      linkedTraceCount: 1,
      linkageRate: 1,
      incompleteTraceIds: [],
      sensitiveMatches: [],
      passed: true,
    });
  });

  it('fails one missing Trace instead of rounding linkage up', () => {
    const report = buildPronunciationObservabilityReport({
      assessmentIds: ['assessment-1', 'assessment-2'],
      traces: [completeTrace],
    });
    expect(report.linkageRate).toBe(0.5);
    expect(report.missingAssessmentIds).toEqual(['assessment-2']);
    expect(report.passed).toBe(false);
  });

  it.each([
    ['subscriptionKey', 'secret'],
    ['userId', 'real-subject'],
    ['referenceText', 'private text'],
    ['recognizedText', 'spoken text'],
    ['audioBytes', 'voice'],
    ['objectKey', 'private/key'],
    ['rawResponse', 'provider raw'],
    ['stack', 'internal stack'],
  ])('fails any forbidden %s field', (key, value) => {
    const report = buildPronunciationObservabilityReport({
      assessmentIds: ['assessment-1'],
      traces: [{ ...completeTrace, metadata: { [key]: value } }],
    });
    expect(report.sensitiveMatches).toContain(`trace-1:${key}`);
    expect(report.passed).toBe(false);
  });
});
