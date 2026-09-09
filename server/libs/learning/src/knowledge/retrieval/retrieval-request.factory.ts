import {
  searchLearningMaterialsV2InputSchema,
  type SearchLearningMaterialsV2Input,
} from '@en/common/coach';
import {
  AppliedRetrievalFilters,
  KnowledgeAccessScope,
  KnowledgeRetrievalRequest,
} from '../domain/knowledge.types';

export type RetrievalRequestFactoryConfig = Readonly<{
  allowedAccessScopes: readonly KnowledgeAccessScope[];
  defaultMinimumRelevance: number;
  contextTokenBudget: number;
  sourceRightsSnapshotVersion: string;
  contentVersionPolicy: string;
  chunkingVersion: string;
  embeddingVersion: string;
  embeddingDimensions: number;
  retrievalConfigVersion: string;
  indexVersion: string;
}>;

export type BuiltRetrievalRequest = Readonly<{
  internal: KnowledgeRetrievalRequest;
  appliedFilters: AppliedRetrievalFilters &
    Readonly<{
      levelFilterApplied: boolean;
      contentVersionPolicy: string;
    }>;
}>;

export class RetrievalRequestFactory {
  constructor(private readonly config: RetrievalRequestFactoryConfig) {}

  create(input: {
    requestId: string;
    subjectId: string;
    untrustedInput: unknown;
    deadline?: Date;
    signal?: AbortSignal;
  }): BuiltRetrievalRequest {
    if (!input.requestId.trim() || !input.subjectId.trim()) {
      throw new Error('RETRIEVAL_IDENTITY_REQUIRED');
    }
    const parsed = searchLearningMaterialsV2InputSchema.parse(
      input.untrustedInput,
    ) as SearchLearningMaterialsV2Input;
    const requestedScopes = parsed.filters.accessScopes?.length
      ? parsed.filters.accessScopes
      : this.config.allowedAccessScopes;
    const enforcedAccessScopes = this.config.allowedAccessScopes.filter((scope) =>
      requestedScopes.includes(scope),
    );
    if (enforcedAccessScopes.length === 0) {
      throw new Error('RETRIEVAL_ACCESS_SCOPE_EMPTY');
    }
    const query = parsed.query.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const levels = parsed.filters.levels ?? [];
    const minimumRelevance =
      parsed.minimumRelevance ?? this.config.defaultMinimumRelevance;

    const appliedFilters = Object.freeze({
      levels: Object.freeze([...levels]),
      levelFilterApplied: levels.length > 0,
      categories: Object.freeze([...parsed.filters.categories]),
      sources: Object.freeze([...parsed.filters.sources]),
      courseIds: Object.freeze([...parsed.filters.courseIds]),
      wordIds: Object.freeze([...parsed.filters.wordIds]),
      accessScopes: Object.freeze([...enforcedAccessScopes]),
      privateOwnerEnforced: true as const,
      topK: parsed.topK,
      minimumRelevance,
      sourceRightsSnapshotVersion: this.config.sourceRightsSnapshotVersion,
      contentVersionPolicy: this.config.contentVersionPolicy,
      chunkingVersion: this.config.chunkingVersion,
      embeddingVersion: this.config.embeddingVersion,
      retrievalConfigVersion: this.config.retrievalConfigVersion,
      indexVersion: this.config.indexVersion,
    });
    return Object.freeze({
      appliedFilters,
      internal: Object.freeze({
        requestId: input.requestId,
        query,
        subjectId: input.subjectId,
        requestedFilters: Object.freeze({
          levels: Object.freeze([...levels]),
          categories: Object.freeze([...parsed.filters.categories]),
          sources: Object.freeze([...parsed.filters.sources]),
          courseIds: Object.freeze([...parsed.filters.courseIds]),
          wordIds: Object.freeze([...parsed.filters.wordIds]),
        }),
        enforcedAccessScopes: Object.freeze([...enforcedAccessScopes]),
        topK: parsed.topK,
        minimumRelevance,
        contextTokenBudget: this.config.contextTokenBudget,
        sourceRightsSnapshotVersion: this.config.sourceRightsSnapshotVersion,
        embeddingVersion: this.config.embeddingVersion,
        embeddingDimensions: this.config.embeddingDimensions,
        chunkingVersion: this.config.chunkingVersion,
        retrievalConfigVersion: this.config.retrievalConfigVersion,
        indexVersion: this.config.indexVersion,
        deadline: input.deadline,
        signal: input.signal,
      }),
    });
  }
}
