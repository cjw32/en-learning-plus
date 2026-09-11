export type McpCostRecord = Readonly<{
  invocationId: string;
  idempotencyKeyHash: string | null;
  outcome: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number | null;
}>;

export function createMcpCostReport(records: readonly McpCostRecord[]) {
  const charged = records.filter(
    (item) =>
      item.inputTokens + item.outputTokens > 0 ||
      (item.estimatedCostMicros ?? 0) > 0,
  );
  const replayCharges = records.filter(
    (item) =>
      ['REPLAYED', 'PENDING', 'RECONCILED'].includes(item.outcome) &&
      (item.inputTokens + item.outputTokens > 0 ||
        (item.estimatedCostMicros ?? 0) > 0),
  );
  return Object.freeze({
    schemaVersion: 'mcp-cost-report.v1',
    invocationCount: records.length,
    chargedInvocationCount: charged.length,
    knownEstimatedCostMicros: records.reduce(
      (sum, item) => sum + (item.estimatedCostMicros ?? 0),
      0,
    ),
    unknownPriceCount: records.filter(
      (item) => item.estimatedCostMicros === null,
    ).length,
    replayIncrementalCostZero: replayCharges.length === 0,
    replayChargeViolations: replayCharges.map((item) => item.invocationId),
    basis: 'estimate_not_billed',
  });
}
