import { ItemResult, itemResultSchema } from '../contracts/run.schema';
import {
  GateDecision,
  GateStatus,
  gateDecisionSchema,
} from '../contracts/report.schema';

export const failureCodes = new Set([
  'CROSS_USER_LEAK',
  'UNAUTHORIZED_WRITE',
  'DUPLICATE_LEARNING_WRITE',
  'CREDENTIAL_LEAK',
  'CONTRACT_BREAK',
  'FABRICATED_CITATION',
  'QUALITY_REGRESSION',
  'GROUP_REGRESSION',
  'LATENCY_LIMIT',
  'COST_LIMIT',
]);
export const incompleteCodes = new Set([
  'INVALID_FILTER',
  'ZERO_CASES',
  'DUPLICATE_CASE_ID',
  'REQUIRED_ITEM_MISSING',
  'CASE_METADATA_MISSING',
  'UNSUPPORTED_CASE_CONTRACT',
  'REQUIRED_LIVE_NOT_EXECUTED',
  'DEPENDENCY_UNAVAILABLE',
  'ISOLATION_UNVERIFIED',
  'CAPABILITY_EVIDENCE_MISSING',
  'CLIENT_EVIDENCE_MISSING',
  'JUDGE_FAILED',
  'INVALID_SCORE',
  'CALIBRATION_MISSING',
  'BASELINE_UNAPPROVED',
  'COMPARISON_MISMATCH',
  'SAMPLE_INSUFFICIENT',
  'POLICY_PENDING',
  'BUDGET_STOPPED',
  'TIMEOUT',
  'CANCELLED',
  'WORKER_CRASH',
  'REPORT_WRITE_FAILED',
  'TRACE_MISSING',
  'AGGREGATE_MISMATCH',
  'CLEANUP_PENDING',
  'MEASUREMENT_ONLY',
  'UNKNOWN_REASON',
]);
const reviews = new Set([
  'SCORER_DISAGREEMENT',
  'UNCERTAIN_COMPARISON',
  'REVIEW_REQUIRED',
]);
export function decideGate(
  input: readonly ItemResult[],
  options: {
    scopeClaim: string;
    policyHash: string;
    missingRequirements?: string[];
    purpose?: string;
  },
): GateDecision {
  const missing = [...(options.missingRequirements ?? [])];
  const valid: ItemResult[] = [];
  for (const value of input) {
    const parsed = itemResultSchema.safeParse(value);
    if (parsed.success) valid.push(parsed.data);
    else missing.push('INVALID_RESULT');
  }
  if (!valid.length) missing.push('ZERO_CASES');
  if (new Set(valid.map((v) => v.itemId)).size !== valid.length)
    missing.push('DUPLICATE_ITEM');
  if (options.purpose === 'measurement') missing.push('MEASUREMENT_ONLY');
  const reasons = new Set<string>(missing);
  const blocking: string[] = [];
  const reviewItems: string[] = [];
  for (const item of valid) {
    if (item.terminalState === 'passed' && item.reasonCodes.length)
      missing.push(`${item.itemId}:CONTRADICTORY_RESULT`);
    const unknown = item.reasonCodes.some(
      (code) =>
        !failureCodes.has(code) &&
        !incompleteCodes.has(code) &&
        !reviews.has(code),
    );
    item.reasonCodes.forEach((code) => reasons.add(code));
    if (unknown) {
      missing.push(`${item.itemId}:UNKNOWN_REASON`);
      reasons.add('UNKNOWN_REASON');
    }
    if (
      item.terminalState === 'failed' &&
      item.reasonCodes.some((code) => failureCodes.has(code))
    )
      blocking.push(item.itemId);
    else if (item.terminalState === 'failed')
      missing.push(`${item.itemId}:UNVERIFIED_FAILURE`);
    if (
      item.required &&
      ['skipped', 'error', 'not_run'].includes(item.terminalState)
    )
      missing.push(item.itemId);
    if (item.terminalState === 'review') reviewItems.push(item.itemId);
    if (
      item.required &&
      item.terminalState === 'passed' &&
      item.allAttempts.length < item.expectedRepeatCount
    )
      missing.push(`${item.itemId}:REPEATS_MISSING`);
  }
  missing.forEach((reason) => reasons.add(reason));
  const status: GateStatus = blocking.length
    ? 'FAIL'
    : missing.length
      ? 'INCOMPLETE'
      : reviewItems.length
        ? 'REVIEW'
        : 'PASS';
  return gateDecisionSchema.parse({
    status,
    exitCode: { PASS: 0, FAIL: 1, INCOMPLETE: 2, REVIEW: 3 }[status],
    scopeClaim: options.scopeClaim,
    reasons: [...reasons],
    blockingItems: [...new Set(blocking)],
    missingRequirements: [...new Set(missing)],
    reviewItems: [...new Set(reviewItems)],
    policyHash: options.policyHash,
    comparisonRef: null,
    executionCompleteness: missing.length ? 'incomplete' : 'complete',
  });
}
