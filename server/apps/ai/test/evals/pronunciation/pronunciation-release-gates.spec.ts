import { evaluatePronunciationReleaseGates } from './pronunciation-release-gates';

const passing = {
  eligibleProviderSuccessRate: 0.99,
  repeatMaxDelta: 5,
  accentResidualGap: 5,
  uploadToTerminalP95Ms: 15_000,
  zeroTolerance: {
    crossOwnerSuccesses: 0,
    sensitiveLeaks: 0,
    unauthorizedSamples: 0,
    invalidLearningWrites: 0,
    fabricatedProsody: 0,
    maliciousAudioBypasses: 0,
    overDeadlineLearningWrites: 0,
  },
};

describe('pronunciation independent release gates', () => {
  it('passes exact inclusive thresholds without inventing other quality gates', () => {
    const result = evaluatePronunciationReleaseGates(passing);
    expect(result.releaseEligible).toBe(true);
    expect(result.gates.every((gate) => gate.passed)).toBe(true);
  });

  it.each([
    ['provider-success', { eligibleProviderSuccessRate: 0.989 }],
    ['repeat-stability', { repeatMaxDelta: 5.01 }],
    ['accent-residual', { accentResidualGap: 5.01 }],
    ['latency-p95', { uploadToTerminalP95Ms: 15_001 }],
  ])('fails %s independently', (gateId, override) => {
    const result = evaluatePronunciationReleaseGates({
      ...passing,
      ...override,
    });
    expect(result.releaseEligible).toBe(false);
    expect(
      result.gates.filter((gate) => !gate.passed).map((gate) => gate.id),
    ).toEqual([gateId]);
  });

  it.each(Object.keys(passing.zeroTolerance))(
    'treats non-zero %s as an independent blocker',
    (field) => {
      const result = evaluatePronunciationReleaseGates({
        ...passing,
        zeroTolerance: { ...passing.zeroTolerance, [field]: 1 },
      });
      expect(result.releaseEligible).toBe(false);
      expect(
        result.gates.find((gate) => gate.id === `zero:${field}`),
      ).toMatchObject({
        passed: false,
        observed: 1,
        threshold: 0,
      });
    },
  );

  it('does not allow strong metrics to average away a blocker', () => {
    const result = evaluatePronunciationReleaseGates({
      ...passing,
      eligibleProviderSuccessRate: 1,
      repeatMaxDelta: 0,
      accentResidualGap: 0,
      uploadToTerminalP95Ms: 1,
      zeroTolerance: { ...passing.zeroTolerance, sensitiveLeaks: 1 },
    });
    expect(result.releaseEligible).toBe(false);
    expect(result.gates.filter((gate) => !gate.passed)).toHaveLength(1);
  });
});
