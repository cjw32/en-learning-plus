import type { McpEvalCase } from './mcp-eval.types';

export type McpDeterministicCandidate = Readonly<{
  action: 'allow' | 'deny' | 'cancel';
  source: string | null;
  tool: string | null;
  schemaValid: boolean;
  violations: readonly string[];
}>;

export function evaluateDeterministically(
  item: McpEvalCase,
  candidate: McpDeterministicCandidate,
) {
  const failedRules = Object.freeze([
    ...(candidate.action === item.expected.action ? [] : ['expected_action']),
    ...(candidate.source === item.expected.source ? [] : ['source_grounding']),
    ...(candidate.tool === item.expected.tool ? [] : ['tool_selection']),
    ...(candidate.schemaValid ? [] : ['schema_validity']),
    ...candidate.violations.map((value) => `zero_tolerance:${value}`),
  ]);
  return Object.freeze({
    caseId: item.id,
    fixtureVersion: 'mcp-eval-cases.v1',
    evaluatorVersion: 'mcp-deterministic.v1',
    passed: failedRules.length === 0,
    failedRules,
  });
}
