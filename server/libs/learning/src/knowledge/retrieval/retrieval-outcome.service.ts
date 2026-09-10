export type RetrievalOutcomeResult = Readonly<{
  status: string;
  relevanceScore: number;
  [key: string]: unknown;
}>;

export type RetrievalOutcomeCitation = Readonly<{
  status: string;
  [key: string]: unknown;
}>;

export class RetrievalOutcomeService {
  classify<
    T extends RetrievalOutcomeResult,
    C extends RetrievalOutcomeCitation,
  >(input: {
    results: readonly T[];
    citations: readonly C[];
    minimumRelevance: number;
    unavailableCategories: readonly string[];
    failure?: Readonly<{ code: string; retryable: boolean }>;
  }) {
    if (input.failure) {
      return Object.freeze({
        status: 'failed' as const,
        results: Object.freeze([] as T[]),
        citations: Object.freeze([] as C[]),
        diagnosticCode: input.failure.code,
        retryable: input.failure.retryable,
      });
    }
    const active = input.results.filter((result) => result.status === 'ACTIVE');
    const eligible = active.filter(
      (result) => result.relevanceScore >= input.minimumRelevance,
    );
    const activeCitations = input.citations.filter(
      (citation) => citation.status === 'active',
    );
    if (eligible.length > 0 && activeCitations.length > 0) {
      return Object.freeze({
        status: 'success' as const,
        results: Object.freeze([...eligible]),
        citations: Object.freeze([...activeCitations]),
        diagnosticCode: null,
        retryable: false,
      });
    }
    const diagnosticCode =
      input.results.length > 0 && active.length === 0
        ? 'SOURCE_INVALID'
        : active.length > 0 && eligible.length === 0
          ? 'LOW_RELEVANCE'
          : input.unavailableCategories.length > 0
            ? 'SOURCE_UNAVAILABLE'
            : eligible.length > 0 && activeCitations.length === 0
              ? 'CITATION_UNAVAILABLE'
              : 'EMPTY_RECALL';
    return Object.freeze({
      status: 'insufficient' as const,
      results: Object.freeze([] as T[]),
      citations: Object.freeze([] as C[]),
      diagnosticCode,
      retryable: false,
    });
  }
}
