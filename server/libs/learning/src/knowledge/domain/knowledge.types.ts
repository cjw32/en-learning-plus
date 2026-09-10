export const KNOWLEDGE_ACCESS_SCOPES = [
  'PUBLIC',
  'OWNED_COURSE',
  'PRIVATE_OWNER',
] as const;

export type KnowledgeAccessScope = (typeof KNOWLEDGE_ACCESS_SCOPES)[number];
export type KnowledgeVisibility = 'public' | 'private';

export const KNOWLEDGE_SOURCE_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
  'REVOKED',
  'DELETED',
] as const;
export type KnowledgeSourceStatus = (typeof KNOWLEDGE_SOURCE_STATUSES)[number];

export const KNOWLEDGE_RELEASE_STATUSES = [
  'BUILDING',
  'READY',
  'ACTIVE',
  'SUPERSEDED',
  'INVALID',
  'PURGED',
] as const;
export type KnowledgeReleaseStatus =
  (typeof KNOWLEDGE_RELEASE_STATUSES)[number];

export const KNOWLEDGE_INGESTION_STATUSES = [
  'PENDING',
  'DISPATCHED',
  'RUNNING',
  'SUCCEEDED',
  'RETRYABLE_FAILED',
  'TERMINAL_FAILED',
  'CANCELLED',
] as const;
export type KnowledgeIngestionStatus =
  (typeof KNOWLEDGE_INGESTION_STATUSES)[number];

export const KNOWLEDGE_CITATION_STATUSES = [
  'ACTIVE',
  'SUPERSEDED',
  'SOURCE_INVALID',
  'ACCESS_REVOKED',
  'SOURCE_DELETED',
  'PRIVATE_DATA_DELETED',
  'PURGED',
] as const;
export type KnowledgeCitationStatus =
  (typeof KNOWLEDGE_CITATION_STATUSES)[number];

export const KNOWLEDGE_CATEGORIES = [
  'WORD_MEANING',
  'WORD_TRANSLATION',
  'WORD_PRONUNCIATION',
  'WORD_FORM',
  'WORD_USAGE',
  'COLLOCATION',
  'EXAMPLE_SENTENCE',
  'GRAMMAR_RULE',
  'GRAMMAR_EXCEPTION',
  'COURSE_LESSON',
  'EXERCISE_KNOWLEDGE',
  'USER_ERROR',
  'LEARNING_SUMMARY',
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const KNOWLEDGE_ERROR_CODES = [
  'KNOWLEDGE_INVALID_STATE_TRANSITION',
  'KNOWLEDGE_INVALID_ACCESS_SCOPE',
  'KNOWLEDGE_CONFIGURATION_DISABLED',
  'SOURCE_NOT_FOUND',
  'SOURCE_NOT_ACTIVE',
  'SOURCE_RIGHTS_NOT_STARTED',
  'SOURCE_RIGHTS_EXPIRED',
  'SOURCE_USE_NOT_ALLOWED',
  'SOURCE_FIELD_NOT_ALLOWED',
  'CONTENT_EMPTY',
  'CONTENT_TOO_SHORT',
  'CONTENT_TOO_LONG',
  'CONTENT_STRUCTURE_INVALID',
  'CONTENT_TEMPLATE_REJECTED',
  'CONTENT_PII_REJECTED',
  'PRIVATE_OWNER_REQUIRED',
  'EMBEDDING_PROVIDER_UNAPPROVED',
  'EMBEDDING_PRIVATE_CONTENT_UNAPPROVED',
  'EMBEDDING_REQUEST_INVALID',
  'EMBEDDING_RESPONSE_INVALID',
  'EMBEDDING_TIMEOUT',
  'EMBEDDING_RATE_LIMITED',
  'RETRIEVAL_INSUFFICIENT',
  'RETRIEVAL_FAILED',
  'RETRIEVAL_CANCELLED',
  'CITATION_INVALID',
  'CITATION_UNAVAILABLE',
] as const;
export type KnowledgeErrorCode = (typeof KNOWLEDGE_ERROR_CODES)[number];

export class KnowledgeDomainError extends Error {
  constructor(
    readonly code: KnowledgeErrorCode,
    message: string = code,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'KnowledgeDomainError';
  }
}

type KnowledgeStateMachine = 'release' | 'ingestion' | 'citation';

const releaseTransitions: Readonly<
  Record<KnowledgeReleaseStatus, readonly KnowledgeReleaseStatus[]>
> = {
  BUILDING: ['READY', 'INVALID'],
  READY: ['ACTIVE', 'INVALID'],
  ACTIVE: ['SUPERSEDED', 'INVALID'],
  SUPERSEDED: ['PURGED'],
  INVALID: ['PURGED'],
  PURGED: [],
};

const ingestionTransitions: Readonly<
  Record<KnowledgeIngestionStatus, readonly KnowledgeIngestionStatus[]>
> = {
  PENDING: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['RUNNING', 'PENDING', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'RETRYABLE_FAILED', 'TERMINAL_FAILED', 'CANCELLED'],
  SUCCEEDED: [],
  RETRYABLE_FAILED: ['PENDING', 'CANCELLED'],
  TERMINAL_FAILED: [],
  CANCELLED: [],
};

const citationTransitions: Readonly<
  Record<KnowledgeCitationStatus, readonly KnowledgeCitationStatus[]>
> = {
  ACTIVE: [
    'SUPERSEDED',
    'SOURCE_INVALID',
    'ACCESS_REVOKED',
    'SOURCE_DELETED',
    'PRIVATE_DATA_DELETED',
    'PURGED',
  ],
  SUPERSEDED: ['PURGED'],
  SOURCE_INVALID: ['PURGED'],
  ACCESS_REVOKED: ['PURGED'],
  SOURCE_DELETED: ['PURGED'],
  PRIVATE_DATA_DELETED: ['PURGED'],
  PURGED: [],
};

export function assertKnowledgeStateTransition(
  machine: 'release',
  from: KnowledgeReleaseStatus,
  to: KnowledgeReleaseStatus,
): void;
export function assertKnowledgeStateTransition(
  machine: 'ingestion',
  from: KnowledgeIngestionStatus,
  to: KnowledgeIngestionStatus,
): void;
export function assertKnowledgeStateTransition(
  machine: 'citation',
  from: KnowledgeCitationStatus,
  to: KnowledgeCitationStatus,
): void;
export function assertKnowledgeStateTransition(
  machine: KnowledgeStateMachine,
  from: string,
  to: string,
): void {
  const transitions = {
    release: releaseTransitions,
    ingestion: ingestionTransitions,
    citation: citationTransitions,
  }[machine] as Readonly<Record<string, readonly string[]>>;

  if (from === to || !transitions[from]?.includes(to)) {
    throw new KnowledgeDomainError(
      'KNOWLEDGE_INVALID_STATE_TRANSITION',
      `KNOWLEDGE_INVALID_STATE_TRANSITION:${machine}:${from}->${to}`,
    );
  }
}

export type RetrievalFilters = Readonly<{
  levels?: readonly string[];
  courseIds?: readonly string[];
  wordIds?: readonly string[];
  categories?: readonly KnowledgeCategory[];
  sources?: readonly string[];
}>;

export type AppliedRetrievalFilters = Readonly<{
  levels: readonly string[];
  courseIds: readonly string[];
  wordIds: readonly string[];
  categories: readonly KnowledgeCategory[];
  sources: readonly string[];
  accessScopes: readonly KnowledgeAccessScope[];
  privateOwnerEnforced: boolean;
  topK: number;
  minimumRelevance: number;
  sourceRightsSnapshotVersion: string;
  embeddingVersion: string;
  chunkingVersion: string;
  retrievalConfigVersion: string;
  indexVersion: string;
}>;

export type KnowledgeRetrievalRequest = Readonly<{
  requestId: string;
  query: string;
  subjectId: string;
  requestedFilters: RetrievalFilters;
  enforcedAccessScopes: readonly KnowledgeAccessScope[];
  topK: number;
  minimumRelevance: number;
  contextTokenBudget: number;
  sourceRightsSnapshotVersion: string;
  embeddingVersion: string;
  embeddingDimensions: number;
  chunkingVersion: string;
  retrievalConfigVersion: string;
  indexVersion: string;
  deadline?: Date;
  signal?: AbortSignal;
}>;

export type KnowledgeRetrievalResult = Readonly<{
  chunkId: string;
  documentId: string;
  releaseId: string;
  source: string;
  sourceId: string;
  title: string;
  category: KnowledgeCategory;
  level: string | null;
  courseId: string | null;
  wordId: string | null;
  visibility: KnowledgeVisibility;
  accessScope: KnowledgeAccessScope;
  contentVersion: string;
  embeddingVersion: string;
  content: string;
  factKey: string | null;
  factValueHash: string | null;
  authorityRank: number | null;
  rank: number;
  relevanceScore: number;
}>;
