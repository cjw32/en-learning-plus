import { ItemResult } from '../contracts/run.schema';
import { countResults } from './counts';
import { decideGate } from './gate';

export function summarize(
  cases: readonly ItemResult[],
  options: {
    scopeClaim: string;
    policyHash: string;
    runId: string;
    missingRequirements?: string[];
    purpose?: string;
  },
) {
  return {
    runId: options.runId,
    scopeClaim: options.scopeClaim,
    counts: countResults(cases),
    cases: structuredClone(cases),
    gate: decideGate(cases, options),
    usage: {
      actualCostMicros: null,
      inputTokens: null,
      outputTokens: null,
      unavailableReason: 'NO_USAGE_EVIDENCE',
    },
  };
}
export type Summary = ReturnType<typeof summarize>;
