import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  SearchLearningMaterialsV2Input,
  SearchLearningMaterialsV2Output,
} from '@en/common/coach';
import {
  LearningDomainError,
  ownedResourceNotFound,
} from '../common/learning-errors';
import type {
  LearningMaterial,
  LearningMaterialCitation,
  LearningMaterialProvider,
  LearningMaterialSearchResult,
  LearningMaterialType,
} from './learning-material.provider';

export const LEARNING_MATERIAL_PROVIDERS = Symbol(
  'LEARNING_MATERIAL_PROVIDERS',
);
export const RAG_LEARNING_MATERIAL_SEARCH = Symbol(
  'RAG_LEARNING_MATERIAL_SEARCH',
);

export interface RagLearningMaterialSearchPort {
  search(
    subjectId: string,
    input: SearchLearningMaterialsV2Input,
    context?: Readonly<{
      requestId: string;
      deadline?: Date;
      signal?: AbortSignal;
    }>,
  ): Promise<SearchLearningMaterialsV2Output>;
}

@Injectable()
export class LearningMaterialService {
  constructor(
    @Inject(LEARNING_MATERIAL_PROVIDERS)
    private readonly providers: readonly LearningMaterialProvider[],
    @Optional()
    @Inject(RAG_LEARNING_MATERIAL_SEARCH)
    private readonly ragSearch?: RagLearningMaterialSearchPort,
  ) {}

  async searchV2(
    subjectId: string,
    input: SearchLearningMaterialsV2Input,
    context?: Readonly<{
      requestId: string;
      deadline?: Date;
      signal?: AbortSignal;
    }>,
    overrideSearch?: RagLearningMaterialSearchPort,
  ): Promise<SearchLearningMaterialsV2Output> {
    const search = overrideSearch ?? this.ragSearch;
    if (!search) {
      throw new LearningDomainError(
        'DATA_NOT_AVAILABLE',
        'RAG learning material search is disabled',
        503,
      );
    }
    return search.search(subjectId, input, context);
  }

  async search(
    subjectId: string,
    input: {
      query: string;
      materialTypes: LearningMaterialType[];
      limit: number;
      cefrLevel?: string | null;
      courseId?: string;
    },
  ): Promise<LearningMaterialSearchResult> {
    const query = input.query.trim();
    if (
      !subjectId ||
      !query ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50 ||
      input.materialTypes.length < 1 ||
      new Set(input.materialTypes).size !== input.materialTypes.length
    ) {
      throw new LearningDomainError(
        'VALIDATION_FAILED',
        '学习材料查询参数无效',
        400,
      );
    }
    const materials: LearningMaterial[] = [];
    const unavailableTypes: LearningMaterialType[] = [];
    for (const materialType of input.materialTypes) {
      const provider = this.providers.find(
        (candidate) => candidate.materialType === materialType,
      );
      if (!provider) {
        unavailableTypes.push(materialType);
        continue;
      }
      const result = await provider.search({
        subjectId,
        query,
        limit: input.limit,
        cefrLevel: input.cefrLevel,
        courseId: input.courseId,
      });
      if (!result.available) unavailableTypes.push(materialType);
      materials.push(...result.materials);
    }
    const deduplicated = [
      ...new Map(
        materials.map((material) => [material.citation.sourceId, material]),
      ).values(),
    ].slice(0, input.limit);
    return { query, materials: deduplicated, unavailableTypes };
  }

  validateCitations(
    searchResult: LearningMaterialSearchResult,
    citations: readonly LearningMaterialCitation[],
  ): void {
    const authorized = new Map(
      searchResult.materials.map((material) => [
        material.citation.sourceId,
        material.citation,
      ]),
    );
    for (const citation of citations) {
      const source = authorized.get(citation.sourceId);
      if (
        !source ||
        source.materialType !== citation.materialType ||
        source.accessScope !== citation.accessScope
      ) {
        throw ownedResourceNotFound();
      }
    }
  }
}
