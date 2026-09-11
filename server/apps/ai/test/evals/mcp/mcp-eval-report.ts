import type { McpEvalObservation } from './mcp-eval.types';

function rate(values: readonly boolean[]) {
  return values.length ? values.filter(Boolean).length / values.length : null;
}
function percentile(values: readonly number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

export function aggregateMcpMetrics(items: readonly McpEvalObservation[]) {
  const quality = items
    .map((item) => item.qualityScore)
    .filter((value): value is number => value !== null);
  const citation = items
    .filter((item) => item.citationValid !== null)
    .map((item) => item.citationValid as boolean);
  const clients = Object.fromEntries(
    [...new Set(items.map((item) => item.client))].sort().map((client) => {
      const rows = items.filter((item) => item.client === client);
      return [
        client,
        {
          sampleCount: rows.length,
          passCount: rows.filter((item) => item.passed).length,
        },
      ];
    }),
  );
  return Object.freeze({
    schemaVersion: 'mcp-eval-report.v1',
    sampleCount: items.length,
    passCount: items.filter((item) => item.passed).length,
    quality: {
      sampleCount: quality.length,
      mean: quality.length
        ? Number(
            (quality.reduce((a, b) => a + b, 0) / quality.length).toFixed(6),
          )
        : null,
    },
    successRate: rate(items.map((item) => item.passed)),
    accuracy: {
      tool: rate(items.map((item) => item.toolAccurate)),
      schema: rate(items.map((item) => item.schemaAccurate)),
      citation: rate(citation),
    },
    latencyMs: {
      p50: percentile(
        items.map((item) => item.latencyMs),
        0.5,
      ),
      p95: percentile(
        items.map((item) => item.latencyMs),
        0.95,
      ),
    },
    tokens: {
      input: items.reduce((sum, item) => sum + item.inputTokens, 0),
      output: items.reduce((sum, item) => sum + item.outputTokens, 0),
    },
    cost: {
      knownMicros: items.reduce(
        (sum, item) => sum + (item.estimatedCostMicros ?? 0),
        0,
      ),
      unknownCount: items.filter((item) => item.estimatedCostMicros === null)
        .length,
      basis: 'estimate_not_billed',
    },
    cancellation: {
      requested: items.filter((item) => item.cancelled).length,
      terminal: items.filter((item) => item.cancelled).length,
    },
    clients,
  });
}

export function createMcpEvalReport(
  items: readonly McpEvalObservation[],
  context: Readonly<Record<string, string | null>>,
) {
  return Object.freeze({
    context: {
      fixtureVersion: context.fixtureVersion ?? null,
      rubricVersion: context.rubricVersion ?? null,
      commit: context.commit ?? null,
      environment: context.environment ?? null,
    },
    metrics: aggregateMcpMetrics(items),
  });
}
