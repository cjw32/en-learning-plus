import { McpLearningBridge } from '../../src/coach/mcp/mcp-learning.bridge';
import {
  McpCostMeter,
  type McpRagCostMetric,
} from '../../src/mcp/governance/mcp-cost-meter';

function meter() {
  const records: McpRagCostMetric[] = [];
  return {
    records,
    meter: new McpCostMeter({
      sink: { record: (metric) => records.push(metric) },
      hmacKey: 'test-mcp-cost-meter-hmac-key-00000001',
      provider: 'deterministic-provider',
      model: 'embedding-test-v2',
      inputMicrosPerMillionTokens: 10_000,
      outputMicrosPerMillionTokens: 20_000,
    }),
  };
}

const request = {
  userId: 'learner_sensitive_a',
  requestId: 'request_cost_0001',
  traceId: 'trace_cost_0001',
  input: {
    query: 'private learner query that must not be recorded',
    categories: ['COURSE_LESSON'],
    courseIds: ['course_private_a'],
    topK: 8,
  },
};

describe('MCP RAG cost and stage meter', () => {
  it('emits one bounded redacted metric for one RAG call', async () => {
    const test = meter();
    const searchV2 = jest.fn(async () => ({ ok: false }));
    const clock = [0, 12, 17];
    const bridge = new McpLearningBridge(
      { searchV2 } as never,
      undefined,
      test.meter,
      () => new Date(clock.shift() ?? 17),
    );

    await bridge.searchMaterials(request);

    expect(test.records).toHaveLength(1);
    expect(test.records[0]).toMatchObject({
      schemaVersion: 'mcp.rag-cost.v1',
      operation: 'search_learning_materials',
      measurementMode: 'estimated',
      tokenCountMode: 'utf8-byte-upper-bound',
      provider: 'deterministic-provider',
      model: 'embedding-test-v2',
      cacheOutcome: 'bypass',
      cancellationOutcome: 'completed',
      inputTokens: Buffer.byteLength(request.input.query, 'utf8'),
      outputTokens: 0,
      estimatedCostMicros: 1,
      currency: 'USD',
      stageTimingsMs: { retrieval: 12, projection: 5, total: 17 },
    });
    expect(test.records[0]?.correlationId).toMatch(/^mcp_corr_[a-f0-9]{24}$/u);
    const serialized = JSON.stringify(test.records[0]);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(2_048);
    expect(serialized).not.toContain(request.userId);
    expect(serialized).not.toContain(request.requestId);
    expect(serialized).not.toContain(request.traceId);
    expect(serialized).not.toContain(request.input.query);
    expect(serialized).not.toMatch(/prompt|chain.of.thought|Bearer|eyJ/u);
  });

  it('records cancellation once after a started retrieval and no raw token', async () => {
    const test = meter();
    const controller = new AbortController();
    const searchV2 = jest.fn(async () => {
      controller.abort();
      return { ok: false };
    });
    const bridge = new McpLearningBridge(
      { searchV2 } as never,
      undefined,
      test.meter,
    );

    await bridge.searchMaterials({ ...request, signal: controller.signal });

    expect(searchV2).toHaveBeenCalledTimes(1);
    expect(test.records).toHaveLength(1);
    expect(test.records[0]).toMatchObject({ cancellationOutcome: 'cancelled' });
    expect(JSON.stringify(test.records[0])).not.toContain('accessToken');
  });
});
