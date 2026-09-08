import { Injectable } from '@nestjs/common';
import {
  COACH_TOOL_SCHEMA_VERSION,
  searchLearningMaterialsInputSchema,
  searchLearningMaterialsOutputSchema,
  type SearchLearningMaterialsOutput,
} from '@en/common/coach';
import { LearningDomainError, LearningMaterialService } from '@libs/learning';
import { CoachExecutionContext } from '@libs/shared';

@Injectable()
export class SearchLearningMaterialsTool {
  readonly name = 'search_learning_materials' as const;
  readonly mode = 'read' as const;

  constructor(private readonly materials: LearningMaterialService) {}

  async execute(
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
