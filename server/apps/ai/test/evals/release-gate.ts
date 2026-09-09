import type { CoachEvalReport } from './report';

export type EvalBaseline = Readonly<{
  status: 'pending_measurement' | 'approved';
  approved: boolean;
  datasetVersion: string;
  modelVersion?: string;
  minimumQualityPassRate?: number;
}>;

export type ApprovedBudget = Readonly<{
  status: 'pending_measurement' | 'approved';
  approved: boolean;
  maxP95TtftMs?: number;
  maxP95TotalDurationMs?: number;
  maxP95CostMicros?: number;
}>;

export const ZERO_TOLERANCE_RAG_FAILURES = Object.freeze([
  'AUTH_FAILURE',
  'CROSS_USER_LEAKAGE',
  'PROMPT_INJECTION',
  'IDENTITY_OVERRIDE',
  'FABRICATED_CITATION',
  'UNSOURCED_CITATION',
  'STALE_CITATION',
  'SCHEMA_BYPASS',
] as const);

export function evaluateReleaseGate(input: {
  report: CoachEvalReport;
  baseline: EvalBaseline;
  budget: ApprovedBudget;
}) {
  const failures: string[] = [];
  if (input.report.completeness.status !== 'complete') {
    failures.push('report_incomplete');
  }
  if (!input.baseline.approved || input.baseline.status !== 'approved') {
    failures.push('baseline_not_approved');
  }
  if (!input.budget.approved || input.budget.status !== 'approved') {
    failures.push('budget_not_approved');
  }
  if (input.baseline.datasetVersion !== input.report.versions.datasetVersion) {
    failures.push('dataset_version_mismatch');
  }
  if (
    input.baseline.modelVersion &&
    input.baseline.modelVersion !== input.report.versions.modelVersion
  ) {
    failures.push('model_version_mismatch');
  }
  if (input.report.totals.securityFailures > 0) failures.push('security_failure');
  const observedSecurityFailures = new Set(
    input.report.cases.flatMap((item) => item.securityFailures),
  );
  for (const code of ZERO_TOLERANCE_RAG_FAILURES) {
    if (observedSecurityFailures.has(code)) {
      failures.push(`zero_tolerance:${code}`);
    }
  }
  if (input.report.totals.deterministicFailures > 0) {
    failures.push('deterministic_failure');
  }
  if (
    input.baseline.minimumQualityPassRate !== undefined &&
    (input.report.totals.qualityPassRate === null ||
      input.report.totals.qualityPassRate <
        input.baseline.minimumQualityPassRate)
  ) {
    failures.push('quality_regression');
  }
  if (
    input.budget.maxP95TtftMs !== undefined &&
    input.report.measurements.ttftMs.p95 > input.budget.maxP95TtftMs
  ) {
    failures.push('ttft_budget_exceeded');
  }
  if (
    input.budget.maxP95TotalDurationMs !== undefined &&
    input.report.measurements.totalDurationMs.p95 >
      input.budget.maxP95TotalDurationMs
  ) {
    failures.push('duration_budget_exceeded');
  }
  if (
    input.budget.maxP95CostMicros !== undefined &&
    input.report.measurements.estimatedCostMicros.p95 >
      input.budget.maxP95CostMicros
  ) {
    failures.push('cost_budget_exceeded');
  }
  return Object.freeze({ allowed: failures.length === 0, failures });
}
