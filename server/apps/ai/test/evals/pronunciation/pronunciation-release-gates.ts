export type PronunciationZeroToleranceCounts = Readonly<{
  crossOwnerSuccesses: number;
  sensitiveLeaks: number;
  unauthorizedSamples: number;
  invalidLearningWrites: number;
  fabricatedProsody: number;
  maliciousAudioBypasses: number;
  overDeadlineLearningWrites: number;
}>;

export type PronunciationReleaseGateInput = Readonly<{
  eligibleProviderSuccessRate: number;
  repeatMaxDelta: number;
  accentResidualGap: number;
  uploadToTerminalP95Ms: number;
  zeroTolerance: PronunciationZeroToleranceCounts;
}>;

export function evaluatePronunciationReleaseGates(
  input: PronunciationReleaseGateInput,
) {
  const gates = [
    {
      id: 'provider-success',
      observed: input.eligibleProviderSuccessRate,
      threshold: 0.99,
      operator: '>=' as const,
      passed: input.eligibleProviderSuccessRate >= 0.99,
    },
    {
      id: 'repeat-stability',
      observed: input.repeatMaxDelta,
      threshold: 5,
      operator: '<=' as const,
      passed: input.repeatMaxDelta <= 5,
    },
    {
      id: 'accent-residual',
      observed: input.accentResidualGap,
      threshold: 5,
      operator: '<=' as const,
      passed: input.accentResidualGap <= 5,
    },
    {
      id: 'latency-p95',
      observed: input.uploadToTerminalP95Ms,
      threshold: 15_000,
      operator: '<=' as const,
      passed: input.uploadToTerminalP95Ms <= 15_000,
    },
    ...Object.entries(input.zeroTolerance).map(([name, observed]) => ({
      id: `zero:${name}`,
      observed,
      threshold: 0,
      operator: '===' as const,
      passed: observed === 0,
    })),
  ].map((gate) => {
    if (!Number.isFinite(gate.observed) || gate.observed < 0) {
      return Object.freeze({ ...gate, passed: false });
    }
    return Object.freeze(gate);
  });
  return Object.freeze({
    schemaVersion: 'pronunciation-release-gates.v1',
    releaseEligible: gates.every((gate) => gate.passed),
    gates: Object.freeze(gates),
    pendingMeasurement: Object.freeze([
      'WER baseline acceptance',
      'per-error precision/recall/F1 baseline acceptance',
      'timestamp and human-score agreement baseline acceptance',
      'authorized-human fairness evidence',
    ]),
  });
}
