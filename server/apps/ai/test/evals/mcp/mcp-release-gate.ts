import { MCP_RUBRICS_V1 } from './rubrics/mcp-rubrics.v1';

export type McpReleaseGateInput = Readonly<{
  approvals: Readonly<{
    sourceRights: boolean;
    retention: boolean;
    realProviderBudget: boolean;
  }>;
  baselinesApproved: boolean;
  requiredClients: readonly string[];
  clientsPassed: readonly string[];
  regressionsPassed: boolean;
  evidenceComplete: boolean;
  zeroToleranceViolations: readonly string[];
}>;

export function decideMcpRelease(input: McpReleaseGateInput) {
  const blockers = [
    ...(!input.approvals.sourceRights ? ['GATE_B_SOURCE_RIGHTS'] : []),
    ...(!input.approvals.retention ? ['GATE_D_RETENTION'] : []),
    ...(!input.approvals.realProviderBudget ? ['GATE_E_BUDGET'] : []),
    ...(!input.baselinesApproved ? ['APPROVED_BASELINES_MISSING'] : []),
    ...(!input.regressionsPassed ? ['REGRESSION_FAILURE'] : []),
    ...(!input.evidenceComplete ? ['EVIDENCE_INCOMPLETE'] : []),
    ...input.requiredClients
      .filter((client) => !input.clientsPassed.includes(client))
      .map((client) => `CLIENT_MISSING:${client}`),
    ...input.zeroToleranceViolations.map((value) =>
      MCP_RUBRICS_V1.zeroTolerance.includes(value as never)
        ? `ZERO_TOLERANCE:${value}`
        : `UNCLASSIFIED_VIOLATION:${value}`,
    ),
  ];
  return Object.freeze({
    schemaVersion: 'mcp-release-decision.v1',
    status: blockers.length ? ('NOT_READY' as const) : ('READY' as const),
    passed: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}
