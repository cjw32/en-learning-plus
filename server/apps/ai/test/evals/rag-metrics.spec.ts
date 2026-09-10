import { calculateRagMetrics } from './rag-metrics';

describe('versioned RAG evaluation metrics', () => {
  it('calculates exact quality, safety, latency, token and cost metrics', () => {
    const metrics = calculateRagMetrics([
      {
        caseId: 'rag_metric_1',
        expectedRelevantChunkIds: ['chunk_a', 'chunk_b'],
        retrievedChunkIds: ['chunk_a', 'chunk_x'],
        citations: [{ accurate: true }, { accurate: false }],
        claims: [
          {
            requiresCitation: true,
            hasValidCitation: true,
            supportedByContext: true,
          },
          {
            requiresCitation: true,
            hasValidCitation: false,
            supportedByContext: false,
          },
        ],
        schema: { firstPass: true, finalPass: true },
        security: { crossUserAttack: true, crossUserLeak: false },
        retrievalLatencyMs: 10,
        contextTokens: 20,
        totalTokens: 100,
        costMicros: 5,
      },
      {
        caseId: 'rag_metric_2',
        expectedRelevantChunkIds: ['chunk_c'],
        retrievedChunkIds: ['chunk_y', 'chunk_c'],
        citations: [{ accurate: true }],
        claims: [
          {
            requiresCitation: true,
            hasValidCitation: true,
            supportedByContext: true,
          },
          {
            requiresCitation: true,
            hasValidCitation: false,
            supportedByContext: false,
            adjudication: 'disputed',
          },
        ],
        schema: { firstPass: false, finalPass: true },
        security: { promptInjection: true, injectionResisted: true },
        retrievalLatencyMs: 30,
        contextTokens: 40,
        totalTokens: 200,
        costMicros: 15,
      },
    ]);

    expect(metrics.metricVersion).toBe('rag-metrics.v1');
    expect(metrics.quality).toEqual({
      recallAtK: 0.75,
      precisionAtK: 0.5,
      mrr: 0.75,
      citationAccuracy: 2 / 3,
      citationCoverage: 2 / 3,
      answerFaithfulness: 2 / 3,
      unsourcedClaimRate: 1 / 3,
      schemaFirstPassRate: 0.5,
      schemaFinalPassRate: 1,
    });
    expect(metrics.safety).toEqual({
      crossUserLeakageRate: 0,
      promptInjectionPassRate: 1,
    });
    expect(metrics.disputedClaimsExcluded).toBe(1);
    expect(metrics.distributions).toMatchObject({
      retrievalLatencyMs: { p50: 10, p95: 30, max: 30, unit: 'ms' },
      contextTokens: { p50: 20, p95: 40, max: 40, unit: 'tokens' },
      totalTokens: { p50: 100, p95: 200, max: 200, unit: 'tokens' },
      costMicros: { p50: 5, p95: 15, max: 15, unit: 'USD_micros' },
    });
  });

  it('reports null for empty denominators and treats expected empty recall separately', () => {
    const metrics = calculateRagMetrics([
      {
        caseId: 'rag_empty_recall',
        expectedRelevantChunkIds: [],
        retrievedChunkIds: [],
        citations: [],
        claims: [],
        schema: { firstPass: true, finalPass: true },
        security: {},
        retrievalLatencyMs: 1,
        contextTokens: 0,
        totalTokens: 0,
        costMicros: 0,
      },
    ]);
    expect(metrics.quality).toMatchObject({
      recallAtK: null,
      precisionAtK: null,
      mrr: null,
      citationAccuracy: null,
      citationCoverage: null,
      answerFaithfulness: null,
      unsourcedClaimRate: null,
    });
    expect(metrics.emptyRecall).toEqual({ cases: 1, passed: 1 });
  });
});
