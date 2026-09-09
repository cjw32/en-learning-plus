import { calculateRagMetrics } from './rag-metrics';
import { buildEvalReport, type EvalCaseResult } from './report';
import {
  evaluateReleaseGate,
  ZERO_TOLERANCE_RAG_FAILURES,
} from './release-gate';

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
  priceVersion: 'rag-price.v1',
  generatedAt: '2026-09-08T00:00:00.000Z',
} as const;

const metrics = calculateRagMetrics([
  {
    caseId: 'rag_gate_case',
    expectedRelevantChunkIds: ['chunk_safe'],
    retrievedChunkIds: ['chunk_safe'],
    citations: [{ accurate: true }],
    claims: [
      { requiresCitation: true, hasValidCitation: true, supportedByContext: true },
    ],
    schema: { firstPass: true, finalPass: true },
    security: { crossUserAttack: true, crossUserLeak: false },
    retrievalLatencyMs: 1,
    contextTokens: 1,
    totalTokens: 1,
    costMicros: 1,
  },
]);

const baseCase: EvalCaseResult = {
  caseId: 'rag_gate_case',
  deterministicFailures: [],
  securityFailures: [],
  qualityState: 'pass',
  measurements: {
    ttftMs: 1,
    totalDurationMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    estimatedCostMicros: 1,
  },
  toolPath: ['search_learning_materials'],
};

function gate(securityFailures: readonly string[]) {
  const report = buildEvalReport({
    mode: 'mock',
    versions,
    cases: [{ ...baseCase, securityFailures }],
    ragMetrics: metrics,
  });
  return evaluateReleaseGate({
    report,
    baseline: {
      status: 'approved',
      approved: true,
      datasetVersion: versions.datasetVersion,
      modelVersion: versions.modelVersion,
      minimumQualityPassRate: 1,
    },
    budget: {
      status: 'approved',
      approved: true,
      maxP95TtftMs: 10,
      maxP95TotalDurationMs: 10,
      maxP95CostMicros: 10,
    },
  });
}

describe('RAG zero-tolerance release gate', () => {
  it('allows only a complete report with approved baseline/budget and no failures', () => {
    expect(gate([])).toEqual({ allowed: true, failures: [] });
  });

  it.each(ZERO_TOLERANCE_RAG_FAILURES)(
    'blocks singleton %s even when aggregate quality is perfect',
    (failure) => {
      const result = gate([failure]);
      expect(result.allowed).toBe(false);
      expect(result.failures).toContain(`zero_tolerance:${failure}`);
    },
  );

  it('blocks an incomplete report independently of averages', () => {
    const report = buildEvalReport({
      mode: 'mock',
      versions: { ...versions, embeddingVersion: '' },
      cases: [baseCase],
      ragMetrics: metrics,
    });
    const result = evaluateReleaseGate({
      report,
      baseline: {
        status: 'approved',
        approved: true,
        datasetVersion: versions.datasetVersion,
      },
      budget: { status: 'approved', approved: true },
    });
    expect(result.allowed).toBe(false);
    expect(result.failures).toContain('report_incomplete');
  });
});
