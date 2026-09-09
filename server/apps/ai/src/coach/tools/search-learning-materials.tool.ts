import { Injectable } from '@nestjs/common';
import {
  COACH_TOOL_SCHEMA_VERSION,
  COACH_RAG_TOOL_SCHEMA_VERSION,
  searchLearningMaterialsInputSchema,
  searchLearningMaterialsOutputSchema,
  searchLearningMaterialsV2InputSchema,
  searchLearningMaterialsV2OutputSchema,
  type SearchLearningMaterialsOutput,
  type SearchLearningMaterialsV2Output,
} from '@en/common/coach';
import {
  LearningDomainError,
  LearningMaterialService,
  type RagLearningMaterialSearchPort,
} from '@libs/learning';
import { CoachExecutionContext } from '@libs/shared';

@Injectable()
export class SearchLearningMaterialsTool {
  readonly name = 'search_learning_materials' as const;
  readonly mode = 'read' as const;

  constructor(
    private readonly materials: LearningMaterialService,
    private readonly ragEnabled = false,
    private readonly ragSearch?: RagLearningMaterialSearchPort,
  ) {}

  async execute(
    context: CoachExecutionContext,
    untrustedInput: unknown,
    execution?: Readonly<{
      requestId: string;
      deadline?: Date;
      signal?: AbortSignal;
    }>,
  ): Promise<SearchLearningMaterialsOutput | SearchLearningMaterialsV2Output> {
    if (this.ragEnabled) {
      const input = searchLearningMaterialsV2InputSchema.safeParse(untrustedInput);
      if (!input.success) {
        return {
          schemaVersion: COACH_TOOL_SCHEMA_VERSION,
          ok: false,
          code: 'VALIDATION_FAILED',
          message: 'RAG 学习材料工具参数无效',
          retryable: false,
        };
      }
      try {
        const result =
          execution || this.ragSearch
            ? await this.materials.searchV2(
                context.subjectId,
                input.data,
                execution,
                this.ragSearch,
              )
            : await this.materials.searchV2(context.subjectId, input.data);
        return searchLearningMaterialsV2OutputSchema.parse(
          result,
        );
      } catch {
        return {
          schemaVersion: COACH_RAG_TOOL_SCHEMA_VERSION,
          ok: false,
          query: input.data.query,
          appliedFilters: {
            levels: input.data.filters.levels ?? [],
            levelFilterApplied: Boolean(input.data.filters.levels?.length),
            categories: input.data.filters.categories,
            sources: input.data.filters.sources,
            courseIds: input.data.filters.courseIds,
            wordIds: input.data.filters.wordIds,
            accessScopes: ['PUBLIC'],
            privateOwnerEnforced: true,
            topK: input.data.topK,
            minimumRelevance: input.data.minimumRelevance ?? 0.65,
            sourceRightsSnapshotVersion: 'unavailable',
            contentVersionPolicy: 'unavailable',
            chunkingVersion: 'unavailable',
            embeddingVersion: 'unavailable',
            retrievalConfigVersion: 'unavailable',
            indexVersion: 'unavailable',
          },
          results: [],
          citations: [],
          conflicts: [],
          retrievalStatus: 'failed',
          failure: {
            code: 'CONFIGURATION_UNAPPROVED',
            message: 'RAG 学习材料暂时不可用',
            retryable: false,
          },
        };
      }
    }
    return this.executeLegacy(context, untrustedInput);
  }

  async executeLegacy(
    context: CoachExecutionContext,
    untrustedInput: unknown,
  ): Promise<SearchLearningMaterialsOutput> {
    const input = searchLearningMaterialsInputSchema.safeParse(untrustedInput);
    if (!input.success) {
      return {
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: false,
        code: 'VALIDATION_FAILED',
        message: '学习材料工具参数无效',
        retryable: false,
      };
    }
    try {
      const result = await this.materials.search(context.subjectId, input.data);
      return searchLearningMaterialsOutputSchema.parse({
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: true,
        query: result.query,
        materials: result.materials.map((material) => ({
          ...material,
          freshness: material.freshness.toISOString(),
        })),
        unavailableTypes: result.unavailableTypes,
      });
    } catch (error) {
      const code =
        error instanceof LearningDomainError
          ? error.code
          : 'DATA_NOT_AVAILABLE';
      return searchLearningMaterialsOutputSchema.parse({
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: false,
        code,
        message: '学习材料暂时不可用',
        retryable: code === 'DATA_NOT_AVAILABLE',
      });
    }
  }
}
