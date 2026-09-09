import { createHash } from 'node:crypto';
import type {
  SearchLearningMaterialsV2Input,
  SearchLearningMaterialsV2Output,
} from '@en/common/coach';
import {
  CitationIssuerService,
  type CitationPersistence,
  ConflictDetector,
  type EmbeddingGateway,
  type KnowledgeRetrievalResult,
  PrismaKnowledgeVectorRepository,
  RagContextBuilder,
  type RagLearningMaterialSearchPort,
  RetrievalRankingService,
  RetrievalRequestFactory,
} from '@libs/learning';
import type { RagRuntimeConfig } from '../../coach/governance/coach-config.schema';

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

export function versionOrdinalForConflict(version: string): number {
  const explicit = /(?:^|[._-])v(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i.exec(
    version.trim(),
  );
  if (!explicit) return 0;
  return explicit
    .slice(1)
    .map((value) => Number(value ?? 0))
    .reduce((total, value) => total * 1_000 + value, 0);
}

function failureCode(
  error: unknown,
):
  | 'RAG_DISABLED'
  | 'EMBEDDING_UNAVAILABLE'
  | 'TOOL_TIMEOUT'
  | 'CONFIGURATION_UNAPPROVED'
  | 'SCHEMA_INVALID'
  | 'CANCELLED'
  | 'INTERNAL_ERROR' {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : String(error instanceof Error ? error.message : error);
  if (/CANCEL/i.test(code)) return 'CANCELLED';
  if (/TIMEOUT/i.test(code)) return 'TOOL_TIMEOUT';
  if (/EMBEDDING|RATE_LIMIT/i.test(code)) return 'EMBEDDING_UNAVAILABLE';
  if (
    /CONFIGURATION|APPROV|DISABLED|VERSION|DIMENSION|ACCESS_SCOPE/i.test(code)
  ) {
    return 'CONFIGURATION_UNAPPROVED';
  }
  if (/SCHEMA|VALIDATION/i.test(code)) return 'SCHEMA_INVALID';
  return 'INTERNAL_ERROR';
}

export class RagLearningMaterialSearchService implements RagLearningMaterialSearchPort {
  private readonly ranking = new RetrievalRankingService();
  private readonly conflicts = new ConflictDetector();
  private readonly citations: CitationIssuerService;

  constructor(
    private readonly config: RagRuntimeConfig,
    private readonly embedding: EmbeddingGateway,
    private readonly vectors: Pick<
      PrismaKnowledgeVectorRepository,
      'searchExact'
    >,
    citationRepository: CitationPersistence,
  ) {
    this.citations = new CitationIssuerService(citationRepository);
  }

  async search(
    subjectId: string,
    input: SearchLearningMaterialsV2Input,
    context?: Readonly<{
      requestId: string;
      deadline?: Date;
      signal?: AbortSignal;
    }>,
  ): Promise<SearchLearningMaterialsV2Output> {
    const requestId = context?.requestId ?? '';
    const factory = this.factory();
    let built: ReturnType<RetrievalRequestFactory['create']>;
    try {
      if (!requestId.trim()) throw new Error('RETRIEVAL_REQUEST_ID_REQUIRED');
      built = factory.create({
        requestId,
        subjectId,
        untrustedInput: input,
        deadline: context?.deadline,
        signal: context?.signal,
      });
    } catch (error) {
      return this.failed(input, failureCode(error));
    }
    try {
      const embedded = await this.embedding.embed({
        texts: [built.internal.query],
        expectedDimensions: built.internal.embeddingDimensions,
        embeddingVersion: built.internal.embeddingVersion,
        deadlineAt: built.internal.deadline,
        signal: built.internal.signal,
      });
      const candidates = await this.vectors.searchExact({
        subjectId,
        queryVector: embedded.vectors[0],
        embeddingVersion: built.internal.embeddingVersion,
        dimensions: built.internal.embeddingDimensions,
        sourceRightsSnapshotVersion: built.internal.sourceRightsSnapshotVersion,
        retrievalConfigVersion: built.internal.retrievalConfigVersion,
        indexVersion: built.internal.indexVersion,
        topK: built.internal.topK,
        candidateLimit: Math.min(
          100,
          Math.max(built.internal.topK, built.internal.topK * 4),
        ),
        minimumRelevance: built.internal.minimumRelevance,
        filters: {
          levels: built.internal.requestedFilters.levels ?? [],
          categories: built.internal.requestedFilters.categories ?? [],
          sources: built.internal.requestedFilters.sources ?? [],
          courseIds: built.internal.requestedFilters.courseIds ?? [],
          wordIds: built.internal.requestedFilters.wordIds ?? [],
          accessScopes: built.internal.enforcedAccessScopes,
        },
      });
      const ranked = this.ranking.rank(candidates, built.internal.topK);
      const issued = await this.citations.issue({ requestId, results: ranked });
      const issuedByChunk = new Map(
        ranked.map((result, index) => [result.chunkId, issued[index]] as const),
      );
      const evaluated = this.conflicts.evaluate(
        ranked.map((result) => ({
          ...result,
          citationId: issuedByChunk.get(result.chunkId)!.citationId,
          versionOrdinal: versionOrdinalForConflict(result.contentVersion),
          sourceStatus: 'ACTIVE',
        })),
      );
      const acceptedIds = new Set(
        evaluated.accepted.map((result) => result.chunkId),
      );
      const accepted = ranked.filter((result) =>
        acceptedIds.has(result.chunkId),
      );
      const context = new RagContextBuilder({
        // One UTF-8 byte per token is intentionally conservative. Production
        // enablement still requires the approved model counter and baseline.
        countTokens: (text) => Buffer.byteLength(text, 'utf8'),
        fallbackMode: true,
      }).build({
        results: accepted,
        tokenBudget: built.internal.contextTokenBudget,
      });
      const includedIds = new Set(
        context.includedResults.map((result) => result.chunkId),
      );
      const finalResults = accepted
        .filter((result) => includedIds.has(result.chunkId))
        .map((result, index) =>
          this.publicResult(
            result,
            issuedByChunk.get(result.chunkId)!.citationId,
            index + 1,
          ),
        );
      const publicCitations = issued.map((citation) => ({
        ...citation,
        usage:
          includedIds.has(
            ranked.find(
              (result) =>
                issuedByChunk.get(result.chunkId)?.citationId ===
                citation.citationId,
            )?.chunkId ?? '',
          ) &&
          evaluated.citationUsage[citation.citationId] === 'answer_evidence'
            ? ('answer_evidence' as const)
            : ('conflict_context' as const),
      }));
      return {
        schemaVersion: 'coach.tool.v2',
        ok: true,
        query: built.internal.query,
        appliedFilters: built.appliedFilters,
        results: finalResults,
        citations: finalResults.length > 0 ? publicCitations : [],
        conflicts: evaluated.conflicts.map((conflict) => ({
          conflictId: stableId('conflict', `${requestId}\0${conflict.topic}`),
          topic: conflict.topic,
          citationIds: conflict.citationIds,
          resolution: conflict.resolution,
        })),
        retrievalStatus: finalResults.length > 0 ? 'success' : 'insufficient',
      };
    } catch (error) {
      return {
        schemaVersion: 'coach.tool.v2',
        ok: false,
        query: built.internal.query,
        appliedFilters: built.appliedFilters,
        results: [],
        citations: [],
        conflicts: [],
        retrievalStatus: 'failed',
        failure: {
          code: failureCode(error),
          message: 'RAG 学习材料暂时不可用',
          retryable: /TIMEOUT|UNAVAILABLE/.test(failureCode(error)),
        },
      };
    }
  }

  private factory(): RetrievalRequestFactory {
    const required = {
      sourceRightsSnapshotVersion: this.config.sourceRightsSnapshotVersion,
      chunkingVersion: this.config.chunkingVersion,
      embeddingVersion: this.config.embeddingVersion,
      embeddingDimensions: this.config.embeddingDimensions,
      retrievalConfigVersion: this.config.retrievalConfigVersion,
      indexVersion: this.config.indexVersion,
    };
    if (Object.values(required).some((value) => value === null)) {
      throw new Error('RAG_CONFIGURATION_UNAPPROVED');
    }
    return new RetrievalRequestFactory({
      allowedAccessScopes: [
        'PUBLIC',
        'OWNED_COURSE',
        ...(this.config.privateContentEnabled
          ? (['PRIVATE_OWNER'] as const)
          : []),
      ],
      defaultMinimumRelevance: this.config.minimumRelevance,
      contextTokenBudget: this.config.contextTokenBudget,
      sourceRightsSnapshotVersion: required.sourceRightsSnapshotVersion!,
      contentVersionPolicy: 'content.sha256.v1',
      chunkingVersion: required.chunkingVersion!,
      embeddingVersion: required.embeddingVersion!,
      embeddingDimensions: required.embeddingDimensions!,
      retrievalConfigVersion: required.retrievalConfigVersion!,
      indexVersion: required.indexVersion!,
    });
  }

  private publicResult(
    result: KnowledgeRetrievalResult,
    citationId: string,
    rank: number,
  ) {
    return {
      resultId: stableId(
        'result',
        `${result.chunkId}\0${result.contentVersion}`,
      ),
      chunkId: result.chunkId,
      documentId: result.documentId,
      citationId,
      source: result.source,
      sourceId: result.sourceId,
      title: result.title,
      category: result.category,
      excerpt: result.content,
      level: result.level as 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null,
      courseId: result.courseId,
      wordId: result.wordId,
      accessScope: result.accessScope,
      rank,
      relevanceScore: result.relevanceScore,
      contentVersion: result.contentVersion,
      embeddingVersion: result.embeddingVersion,
      status: 'valid' as const,
    };
  }

  private failed(
    input: SearchLearningMaterialsV2Input,
    code: ReturnType<typeof failureCode>,
  ): SearchLearningMaterialsV2Output {
    const unavailable = 'unavailable';
    return {
      schemaVersion: 'coach.tool.v2',
      ok: false,
      query: input.query,
      appliedFilters: {
        levels: input.filters.levels ?? [],
        levelFilterApplied: Boolean(input.filters.levels?.length),
        categories: input.filters.categories,
        sources: input.filters.sources,
        courseIds: input.filters.courseIds,
        wordIds: input.filters.wordIds,
        accessScopes: ['PUBLIC'],
        privateOwnerEnforced: true,
        topK: input.topK,
        minimumRelevance:
          input.minimumRelevance ?? this.config.minimumRelevance,
        sourceRightsSnapshotVersion:
          this.config.sourceRightsSnapshotVersion ?? unavailable,
        contentVersionPolicy: 'content.sha256.v1',
        chunkingVersion: this.config.chunkingVersion ?? unavailable,
        embeddingVersion: this.config.embeddingVersion ?? unavailable,
        retrievalConfigVersion:
          this.config.retrievalConfigVersion ?? unavailable,
        indexVersion: this.config.indexVersion ?? unavailable,
      },
      results: [],
      citations: [],
      conflicts: [],
      retrievalStatus: 'failed',
      failure: {
        code,
        message: 'RAG 学习材料暂时不可用',
        retryable: false,
      },
    };
  }
}
