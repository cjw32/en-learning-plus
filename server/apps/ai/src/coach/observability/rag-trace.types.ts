export const RETRIEVAL_TRACE_METADATA_VERSION = 'rag-trace.v1' as const;

export type RetrievalTraceStatus = 'success' | 'insufficient' | 'failed';

/** Safe, stable codes only. Provider messages and stack traces are never Trace data. */
export type RetrievalTraceFailureCode =
  | 'RAG_DISABLED'
  | 'RETRIEVAL_INSUFFICIENT'
  | 'EMPTY_RECALL'
  | 'LOW_RELEVANCE'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_INVALID'
  | 'CITATION_UNAVAILABLE'
  | 'EMBEDDING_UNAVAILABLE'
  | 'TOOL_TIMEOUT'
  | 'CONFIGURATION_UNAPPROVED'
  | 'SCHEMA_INVALID'
  | 'CANCELLED'
  | 'INTERNAL_ERROR';

export type RetrievalTraceCounts = Readonly<{
  rawRecall: number;
  accessEligible: number;
  relevanceEligible: number;
  deduplicated: number;
  contextSelected: number;
}>;

export type RetrievalTraceVersions = Readonly<{
  sourceRightsSnapshotVersion: string;
  contentVersion: string;
  chunkingVersion: string;
  embeddingVersion: string;
  retrievalConfigVersion: string;
  indexVersion: string;
}>;

export type RetrievalTraceFilters = Readonly<{
  levels: readonly string[];
  categories: readonly string[];
  sources: readonly string[];
  courseIds: readonly string[];
  wordIds: readonly string[];
  accessScopes: readonly ('PUBLIC' | 'OWNED_COURSE' | 'PRIVATE_OWNER')[];
}>;

export type RetrievalTraceRanking = Readonly<{
  citationId: string;
  /** HMAC/SHA-256 alias; never the source record ID. */
  sourceIdHash: string;
  sourceCategory: string;
  rank: number;
  relevanceScore: number;
  decision:
    | 'used'
    | 'unused'
    | 'deduplicated'
    | 'conflict_discarded'
    | 'below_threshold';
}>;

export type RetrievalClaimCitationTrace = Readonly<{
  claimPath: string;
  citationIds: readonly string[];
}>;

/**
 * Exhaustive allowlisted RAG Trace payload. It intentionally has no index
 * signature and no raw identity, query, document, excerpt, prompt or secret
 * fields. Callers must hash query/source aliases before constructing it.
 */
export type RetrievalTraceMetadata = Readonly<{
  metadataVersion: typeof RETRIEVAL_TRACE_METADATA_VERSION;
  queryHash: string;
  appliedFilters: RetrievalTraceFilters;
  topK: number;
  minimumRelevance: number;
  versions: RetrievalTraceVersions;
  counts: RetrievalTraceCounts;
  rankings: readonly RetrievalTraceRanking[];
  conflictCount: number;
  deduplicatedCount: number;
  retrievalDurationMs: number;
  contextTokens: number;
  tokenCountMode: 'model' | 'fallback';
  usedCitationIds: readonly string[];
  unusedCitationIds: readonly string[];
  claimCitations: readonly RetrievalClaimCitationTrace[];
  status: RetrievalTraceStatus;
  failureCode: RetrievalTraceFailureCode | null;
}>;
