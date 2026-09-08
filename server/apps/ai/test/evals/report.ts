export type EvalMetricName =
  | 'ttftMs'
  | 'totalDurationMs'
  | 'inputTokens'
  | 'outputTokens'
  | 'estimatedCostMicros';

export type EvalCaseResult = Readonly<{
  caseId: string;
  deterministicFailures: readonly string[];
  securityFailures: readonly string[];
  qualityState: 'pass' | 'fail' | 'unscored';
  measurements: Record<EvalMetricName, number>;
  toolPath: readonly string[];
}>;

export type CoachEvalReport = Readonly<{
  reportVersion: 'coach-eval-report.v1';
  mode: 'mock' | 'live';
  versions: Readonly<{
    datasetVersion: string;
    promptVersion: string;
    modelVersion: string;
    schemaVersion: string;
    priceVersion: string;
    generatedAt: string;
  }>;
  totals: Readonly<{
    cases: number;
    deterministicFailures: number;
    securityFailures: number;
    qualityPassRate: number | null;
  }>;
  measurements: Record<
    EvalMetricName,
    Readonly<{ p50: number; p95: number; max: number }>
  >;
  cases: readonly EvalCaseResult[];
}>;

const metricNames: readonly EvalMetricName[] = [
  'ttftMs',
  'totalDurationMs',
  'inputTokens',
  'outputTokens',
  'estimatedCostMicros',
];

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

export function buildEvalReport(input: {
  mode: 'mock' | 'live';
  versions: CoachEvalReport['versions'];
  cases: readonly EvalCaseResult[];
}): CoachEvalReport {
  const scored = input.cases.filter((item) => item.qualityState !== 'unscored');
  const measurements = Object.fromEntries(
    metricNames.map((name) => {
      const values = input.cases.map((item) => item.measurements[name]);
      return [
        name,
        Object.freeze({
          p50: percentile(values, 0.5),
          p95: percentile(values, 0.95),
          max: values.length ? Math.max(...values) : 0,
        }),
      ];
    }),
  ) as CoachEvalReport['measurements'];
  return Object.freeze({
    reportVersion: 'coach-eval-report.v1' as const,
    mode: input.mode,
    versions: Object.freeze({ ...input.versions }),
    totals: Object.freeze({
      cases: input.cases.length,
      deterministicFailures: input.cases.reduce(
        (sum, item) => sum + item.deterministicFailures.length,
        0,
      ),
      securityFailures: input.cases.reduce(
        (sum, item) => sum + item.securityFailures.length,
        0,
      ),
      qualityPassRate:
        scored.length === 0
          ? null
          : scored.filter((item) => item.qualityState === 'pass').length /
            scored.length,
    }),
    measurements,
    cases: Object.freeze(input.cases.map((item) => Object.freeze(item))),
  });
}
