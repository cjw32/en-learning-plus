export function linkEvalTrace(input: {
  caseId: string;
  datasetVersion: string;
  traceId: string;
  promptVersion: string;
  modelVersion: string;
  schemaVersion: string;
  feedback: 'UP' | 'DOWN' | null;
}) {
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && !/^[A-Za-z0-9_.-]+$/.test(value)) {
      throw new Error('Eval Trace links accept opaque ids and versions only');
    }
  }
  return Object.freeze({ ...input });
}

const opaque = /^[A-Za-z0-9_.-]+$/;

function assertOpaque(value: string): void {
  if (!opaque.test(value)) {
    throw new Error('Eval Trace links accept opaque ids and versions only');
  }
}

export function linkRagEvalTrace(input: {
  caseId: string;
  datasetVersion: string;
  trace: Readonly<{
    traceId: string;
    requestId: string;
    promptVersion: string;
    modelVersion: string;
    schemaVersion: string;
  }>;
  retrieval: Readonly<{
    metadataVersion: 'rag-trace.v1';
    status: 'success' | 'insufficient' | 'failed';
    usedCitationIds: readonly string[];
    unusedCitationIds: readonly string[];
  }>;
  claims: readonly Readonly<{
    claimPath: string;
    citationIds: readonly string[];
  }>[];
  feedback: Readonly<{
    feedbackId: string;
    rating: 'UP' | 'DOWN';
  }> | null;
}) {
  const stringValues = [
    input.caseId,
    input.datasetVersion,
    input.trace.traceId,
    input.trace.requestId,
    input.trace.promptVersion,
    input.trace.modelVersion,
    input.trace.schemaVersion,
    input.retrieval.metadataVersion,
    input.retrieval.status,
    ...input.retrieval.usedCitationIds,
    ...input.retrieval.unusedCitationIds,
    ...input.claims.flatMap((claim) => [claim.claimPath, ...claim.citationIds]),
    ...(input.feedback
      ? [input.feedback.feedbackId, input.feedback.rating]
      : []),
  ];
  for (const value of stringValues) assertOpaque(value);
  const used = new Set(input.retrieval.usedCitationIds);
  const unused = new Set(input.retrieval.unusedCitationIds);
  if ([...used].some((id) => unused.has(id))) {
    throw new Error('Used and unused citations must not overlap');
  }
  if (
    input.claims.some((claim) => claim.citationIds.some((id) => !used.has(id)))
  ) {
    throw new Error(
      'Every claim citation must be an actually used retrieval citation',
    );
  }
  return Object.freeze({
    caseId: input.caseId,
    datasetVersion: input.datasetVersion,
    trace: Object.freeze({ ...input.trace }),
    retrieval: Object.freeze({
      ...input.retrieval,
      usedCitationIds: Object.freeze([...input.retrieval.usedCitationIds]),
      unusedCitationIds: Object.freeze([...input.retrieval.unusedCitationIds]),
    }),
    claims: Object.freeze(
      input.claims.map((claim) =>
        Object.freeze({
          claimPath: claim.claimPath,
          citationIds: Object.freeze([...claim.citationIds]),
        }),
      ),
    ),
    feedback: input.feedback ? Object.freeze({ ...input.feedback }) : null,
  });
}
