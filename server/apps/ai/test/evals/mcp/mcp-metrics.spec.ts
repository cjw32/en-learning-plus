import { aggregateMcpMetrics } from './mcp-eval-report';

describe('MCP metric aggregation', () => {
  it('computes deterministic denominators, quality, accuracy, P50/P95, tokens, cost, cancellation and clients', () => {
    const report = aggregateMcpMetrics([
      {
        id: '1',
        passed: true,
        qualityScore: 0.8,
        toolAccurate: true,
        schemaAccurate: true,
        citationValid: true,
        latencyMs: 10,
        inputTokens: 5,
        outputTokens: 7,
        estimatedCostMicros: 11,
        cancelled: false,
        client: 'Codex',
      },
      {
        id: '2',
        passed: false,
        qualityScore: 0.6,
        toolAccurate: false,
        schemaAccurate: true,
        citationValid: false,
        latencyMs: 100,
        inputTokens: 3,
        outputTokens: 4,
        estimatedCostMicros: 13,
        cancelled: true,
        client: 'Claude Desktop',
      },
      {
        id: '3',
        passed: true,
        qualityScore: null,
        toolAccurate: true,
        schemaAccurate: true,
        citationValid: null,
        latencyMs: 20,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicros: null,
        cancelled: false,
        client: 'Codex',
      },
    ]);
    expect(report).toMatchObject({
      sampleCount: 3,
      passCount: 2,
      quality: { sampleCount: 2, mean: 0.7 },
      successRate: 2 / 3,
      latencyMs: { p50: 20, p95: 100 },
      tokens: { input: 8, output: 11 },
      cost: { knownMicros: 24, unknownCount: 1 },
      cancellation: { requested: 1, terminal: 1 },
    });
    expect(report.clients.Codex).toEqual({ sampleCount: 2, passCount: 2 });
  });
});
