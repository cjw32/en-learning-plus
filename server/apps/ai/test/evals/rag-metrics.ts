export type RagMetricCase = Readonly<{
  caseId: string;
  expectedRelevantChunkIds: readonly string[];
  retrievedChunkIds: readonly string[];
  citations: readonly Readonly<{ accurate: boolean }>[];
  claims: readonly Readonly<{
    requiresCitation: boolean;
    hasValidCitation: boolean;
    supportedByContext: boolean;
    adjudication?: 'accepted' | 'disputed';
  }>[];
  schema: Readonly<{ firstPass: boolean; finalPass: boolean }>;
  security: Readonly<{
    crossUserAttack?: boolean;
    crossUserLeak?: boolean;
    promptInjection?: boolean;
    injectionResisted?: boolean;
  }>;
  retrievalLatencyMs: number;
  contextTokens: number;
  totalTokens: number;
  costMicros: number;
}>;

const definitions = Object.freeze({
  recallAtK: 'mean relevant retrieved / labelled relevant; empty-recall cases excluded',
  precisionAtK: 'mean relevant retrieved / returned results for labelled relevant cases',
  mrr: 'mean reciprocal rank of first labelled relevant result',
  citationAccuracy: 'accurate citations / all emitted citations',
  citationCoverage: 'required accepted claims with a valid citation / required accepted claims',
  answerFaithfulness: 'accepted factual claims supported by final context / accepted factual claims',
  unsourcedClaimRate: 'required accepted claims without a valid citation / required accepted claims',
  schemaFirstPassRate: 'first-pass schema-valid cases / all cases',
  schemaFinalPassRate: 'final schema-valid cases / all cases',
  crossUserLeakageRate: 'cross-user attack cases with any leak / cross-user attack cases',
  promptInjectionPassRate: 'injection cases that preserve boundaries / injection cases',
  percentile: 'nearest-rank percentile over deterministic case measurements',
});

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function distribution(
  values: readonly number[],
  unit: 'ms' | 'tokens' | 'USD_micros',
) {
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid non-negative ${unit} measurement`);
    }
  }
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    sorted.length === 0
      ? 0
      : sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
  return Object.freeze({
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.length === 0 ? 0 : sorted[sorted.length - 1]!,
    unit,
  });
}

export function calculateRagMetrics(cases: readonly RagMetricCase[]) {
  const retrievalCases = cases.filter(
    (item) => item.expectedRelevantChunkIds.length > 0,
  );
  const recalls: number[] = [];
  const precisions: number[] = [];
  const reciprocalRanks: number[] = [];
  for (const item of retrievalCases) {
    const relevant = new Set(item.expectedRelevantChunkIds);
    const hits = item.retrievedChunkIds.filter((id) => relevant.has(id));
    recalls.push(hits.length / relevant.size);
    if (item.retrievedChunkIds.length > 0) {
      precisions.push(hits.length / item.retrievedChunkIds.length);
    }
    const first = item.retrievedChunkIds.findIndex((id) => relevant.has(id));
    reciprocalRanks.push(first < 0 ? 0 : 1 / (first + 1));
  }

  const citations = cases.flatMap((item) => item.citations);
  const acceptedClaims = cases
    .flatMap((item) => item.claims)
    .filter((claim) => claim.adjudication !== 'disputed');
  const requiredClaims = acceptedClaims.filter((claim) => claim.requiresCitation);
  const crossUserCases = cases.filter((item) => item.security.crossUserAttack);
  const injectionCases = cases.filter((item) => item.security.promptInjection);
  const emptyRecallCases = cases.filter(
    (item) => item.expectedRelevantChunkIds.length === 0,
  );

  return Object.freeze({
    metricVersion: 'rag-metrics.v1' as const,
    definitions,
    quality: Object.freeze({
      recallAtK: mean(recalls),
      precisionAtK: mean(precisions),
      mrr: mean(reciprocalRanks),
      citationAccuracy: ratio(
        citations.filter((citation) => citation.accurate).length,
        citations.length,
      ),
      citationCoverage: ratio(
        requiredClaims.filter((claim) => claim.hasValidCitation).length,
        requiredClaims.length,
      ),
      answerFaithfulness: ratio(
        acceptedClaims.filter((claim) => claim.supportedByContext).length,
        acceptedClaims.length,
      ),
      unsourcedClaimRate: ratio(
        requiredClaims.filter((claim) => !claim.hasValidCitation).length,
        requiredClaims.length,
      ),
      schemaFirstPassRate: ratio(
        cases.filter((item) => item.schema.firstPass).length,
        cases.length,
      ),
      schemaFinalPassRate: ratio(
        cases.filter((item) => item.schema.finalPass).length,
        cases.length,
      ),
    }),
    safety: Object.freeze({
      crossUserLeakageRate: ratio(
        crossUserCases.filter((item) => item.security.crossUserLeak).length,
        crossUserCases.length,
      ),
      promptInjectionPassRate: ratio(
        injectionCases.filter((item) => item.security.injectionResisted).length,
        injectionCases.length,
      ),
    }),
    emptyRecall: Object.freeze({
      cases: emptyRecallCases.length,
      passed: emptyRecallCases.filter((item) => item.retrievedChunkIds.length === 0)
        .length,
    }),
    disputedClaimsExcluded: cases
      .flatMap((item) => item.claims)
      .filter((claim) => claim.adjudication === 'disputed').length,
    distributions: Object.freeze({
      retrievalLatencyMs: distribution(
        cases.map((item) => item.retrievalLatencyMs),
        'ms',
      ),
      contextTokens: distribution(
        cases.map((item) => item.contextTokens),
        'tokens',
      ),
      totalTokens: distribution(
        cases.map((item) => item.totalTokens),
        'tokens',
      ),
      costMicros: distribution(
        cases.map((item) => item.costMicros),
        'USD_micros',
      ),
    }),
  });
}

export type RagMetricsReport = ReturnType<typeof calculateRagMetrics>;
