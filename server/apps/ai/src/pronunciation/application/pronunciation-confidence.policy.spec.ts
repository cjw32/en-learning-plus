import { PronunciationConfidencePolicy } from './pronunciation-confidence.policy';

const valid = {
  confidence: 0.9,
  overallScore: 80,
  providerOutcome: 'SUCCESS' as const,
  schemaValid: true,
  alignmentReliable: true,
  sourceValid: true,
  audioValid: true,
  versionsPinned: true,
  cancelled: false,
  timedOut: false,
  learningWriteEnabled: true,
};

describe('PronunciationConfidencePolicy', () => {
  const policy = new PronunciationConfidencePolicy();

  it.each([
    [0.59, 'REJECTED', false, false],
    [0.6, 'REFERENCE_ONLY', true, false],
    [0.79, 'REFERENCE_ONLY', true, false],
    [0.8, 'RELIABLE', true, true],
  ] as const)(
    'classifies confidence %s as %s',
    (confidence, confidenceTier, resultEligible, learningWriteEligible) => {
      expect(policy.decide({ ...valid, confidence })).toMatchObject({
        confidenceTier,
        resultEligible,
        learningWriteEligible,
      });
    },
  );

  it.each([
    ['providerOutcome', 'UNRECOGNIZABLE', 'PROVIDER_OUTCOME'],
    ['schemaValid', false, 'SCHEMA_INVALID'],
    ['alignmentReliable', false, 'ALIGNMENT_UNRELIABLE'],
    ['sourceValid', false, 'SOURCE_INVALID'],
    ['audioValid', false, 'AUDIO_INVALID'],
    ['versionsPinned', false, 'VERSIONS_UNPINNED'],
    ['cancelled', true, 'CANCELLED'],
    ['timedOut', true, 'TIMED_OUT'],
    ['learningWriteEnabled', false, 'LEARNING_WRITE_DISABLED'],
  ] as const)('prevents learning writes when %s=%s', (key, value, reason) => {
    const decision = policy.decide({ ...valid, [key]: value });
    expect(decision.learningWriteEligible).toBe(false);
    expect(decision.noWriteReasons).toContain(reason);
  });

  it('selects deterministic next actions from confidence and score', () => {
    expect(policy.decide({ ...valid, overallScore: 74.99 }).nextAction).toBe(
      'review',
    );
    expect(policy.decide({ ...valid, overallScore: 75 }).nextAction).toBe(
      'continue',
    );
    expect(policy.decide({ ...valid, confidence: 0.79 }).nextAction).toBe(
      'retry',
    );
  });
});
