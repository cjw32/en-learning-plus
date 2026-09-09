import { calculateRagMetrics } from './rag-metrics';
import { buildEvalReport, type EvalCaseResult } from './report';

const result: EvalCaseResult = {
  caseId: 'rag_report_case',
  deterministicFailures: [],
  securityFailures: [],
  qualityState: 'pass',
  measurements: {
    ttftMs: 10,
    totalDurationMs: 20,
    inputTokens: 30,
    outputTokens: 40,
    estimatedCostMicros: 5,
  },
  toolPath: ['search_learning_materials'],
};

const metrics = calculateRagMetrics([
  {
    caseId: result.caseId,
    expectedRelevantChunkIds: ['chunk_expected'],
    retrievedChunkIds: ['chunk_expected'],
    citations: [{ accurate: true }],
    claims: [
      { requiresCitation: true, hasValidCitation: true, supportedByContext: true },
    ],
    schema: { firstPass: true, finalPass: true },
    security: { crossUserAttack: true, crossUserLeak: false },
    retrievalLatencyMs: 8,
    contextTokens: 12,
    totalTokens: 70,
    costMicros: 5,
  },
]);

const versions = {
  datasetVersion: 'rag-eval.synthetic.v1',
  sourceRightsSnapshotVersion: 'rights.synthetic.v1',
  promptVersion: 'coach.rag.v1',
  modelVersion: 'mock-rag-v1',
  embeddingVersion: 'embedding.fake.8d.v1',
  chunkingVersion: 'chunking.v1',
  indexVersion: 'exact-cosine.v1',
  retrievalConfigVersion: 'retrieval.exact.v1',
  schemaVersion: 'coach.result.v2',
  rubricVersion: 'rag-quality.v1',
  priceVersion: 'rag-price.pending.v1',
  generatedAt: '2026-09-08T00:00:00.000Z',
} as const;

describe('RAG evaluation report completeness', () => {
  it('reports all versions plus quality, safety, latency, token and cost evidence', () => {
    const report = buildEvalReport({ mode: 'mock', versions, cases: [result], ragMetrics: metrics });
    expect(report.completeness).toEqual({
      status: 'complete',
      missingVersions: [],
      hasRagMetrics: true,
    });
    expect(report.ragMetrics).toMatchObject({
      metricVersion: 'rag-metrics.v1',
      quality: { recallAtK: 1, citationAccuracy: 1 },
      safety: { crossUserLeakageRate: 0 },
      distributions: {
        retrievalLatencyMs: { p50: 8, p95: 8, unit: 'ms' },
        contextTokens: { p50: 12, unit: 'tokens' },
        totalTokens: { p50: 70, unit: 'tokens' },
        costMicros: { p50: 5, unit: 'USD_micros' },
      },
    });
  });

  it.each([
    'sourceRightsSnapshotVersion',
    'promptVersion',
    'embeddingVersion',
    'chunkingVersion',
    'indexVersion',
    'retrievalConfigVersion',
    'schemaVersion',
    'datasetVersion',
    'rubricVersion',
    'priceVersion',
  ] as const)('marks a report incomplete without %s', (field) => {
    const incomplete = { ...versions, [field]: '' };
    const report = buildEvalReport({
      mode: 'mock',
      versions: incomplete,
      cases: [result],
      ragMetrics: metrics,
    });
    expect(report.completeness.status).toBe('incomplete');
    expect(report.completeness.missingVersions).toContain(field);
  });

  it('marks a report incomplete without measured RAG metrics', () => {
    expect(
      buildEvalReport({ mode: 'mock', versions, cases: [result] }).completeness,
    ).toMatchObject({ status: 'incomplete', hasRagMetrics: false });
  });
});
