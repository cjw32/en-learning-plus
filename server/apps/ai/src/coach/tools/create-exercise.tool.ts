import { Injectable } from '@nestjs/common';
import {
  COACH_TOOL_SCHEMA_VERSION,
  createExerciseInputSchema,
  createExerciseOutputSchema,
  type CreateExerciseOutput,
} from '@en/common/coach';
import {
  ExerciseService,
  LearningDomainError,
  exerciseDefinitionSchema,
  type SelectedExerciseTarget,
} from '@libs/learning';
import type { CoachExecutionContext } from '@libs/shared';
import { buildCreateExercisePrompt } from '../prompts/create-exercise.prompt';
import type { CoachPromptMaterial } from '../prompts/answer.prompt';
import type { CoachModelTelemetry } from '../workflow/coach-model.gateway';

export type CreateExerciseToolScope = Readonly<{
  requestId: string;
  conversationId: string;
  targets: SelectedExerciseTarget[];
  materials: CoachPromptMaterial[];
  personalizationReason: string;
  signal?: AbortSignal;
  beforeModelCall?: () => void;
  modelTelemetry?: CoachModelTelemetry;
  onSchemaFailure?: () => void;
  onRetry?: () => void;
}>;

export interface CoachExerciseGenerator {
  generateDefinition(
    input: {
      prompt: string;
      jsonSchema: unknown;
    },
    signal?: AbortSignal,
    telemetry?: CoachModelTelemetry,
  ): Promise<unknown>;
}

export interface CoachExerciseBudgetGate {
  assertCanGenerate(): void;
}

@Injectable()
export class CreateExerciseTool {
  readonly name = 'create_exercise' as const;
  readonly mode = 'compute' as const;

  constructor(
    private readonly exercises: ExerciseService,
    private readonly generator: CoachExerciseGenerator,
    private readonly budget: CoachExerciseBudgetGate,
  ) {}

  async execute(
    context: CoachExecutionContext,
    scope: CreateExerciseToolScope,
    untrustedInput: unknown,
  ): Promise<CreateExerciseOutput> {
    const parsed = createExerciseInputSchema.safeParse(untrustedInput);
    if (!parsed.success) return this.failure('VALIDATION_FAILED', false);
    const allowedTargets = new Set(
      scope.targets.map((target) => `${target.targetType}:${target.targetKey}`),
    );
    const allowedSources = new Set(
      scope.materials.map((material) => material.citation.sourceId),
    );
    const targetSubset = parsed.data.targetRefs.every((target) =>
      allowedTargets.has(`${target.targetType}:${target.targetKey}`),
    );
    const materialSubset = parsed.data.materialSourceIds.every((sourceId) =>
      allowedSources.has(sourceId),
    );
    if (!targetSubset || parsed.data.targetRefs.length === 0) {
      return this.failure('VALIDATION_FAILED', false);
    }
    if (scope.materials.length === 0 || allowedSources.size === 0) {
      return this.failure('DATA_NOT_AVAILABLE', true);
    }
    if (!materialSubset) return this.failure('VALIDATION_FAILED', false);

    const built = buildCreateExercisePrompt({
      type: parsed.data.types[0],
      count: parsed.data.count,
      difficulty: parsed.data.difficulty,
      scenario: parsed.data.scenario,
      personalizationReason: scope.personalizationReason,
      targets: scope.targets.filter((target) =>
        parsed.data.targetRefs.some(
          (selected) =>
            selected.targetType === target.targetType &&
            selected.targetKey === target.targetKey,
        ),
      ),
      materials: scope.materials.filter((material) =>
        parsed.data.materialSourceIds.includes(material.citation.sourceId),
      ),
    });
    try {
      let definition: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        this.budget.assertCanGenerate();
        scope.beforeModelCall?.();
        definition = await this.generator.generateDefinition(
          built,
          scope.signal,
          scope.modelTelemetry,
        );
        const validated = exerciseDefinitionSchema.safeParse(definition);
        if (validated.success) {
          return createExerciseOutputSchema.parse(
            await this.exercises.createReady({
              subjectId: context.subjectId,
              conversationId: scope.conversationId,
              requestId: scope.requestId,
              definition: validated.data,
              allowedTargetRefs: parsed.data.targetRefs,
              allowedMaterialSourceIds: parsed.data.materialSourceIds,
            }),
          );
        }
        scope.onSchemaFailure?.();
        if (attempt === 0) scope.onRetry?.();
      }
      return this.failure('SCHEMA_INVALID', false);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'BUDGET_EXCEEDED'
      ) {
        return this.failure('BUDGET_EXCEEDED', false);
      }
      if (error instanceof LearningDomainError) {
        return this.failure(error.code, error.retryable);
      }
      return this.failure('INTERNAL_ERROR', true);
    }
  }

  private failure(
    code:
      | 'VALIDATION_FAILED'
      | 'DATA_NOT_AVAILABLE'
      | 'SCHEMA_INVALID'
      | 'BUDGET_EXCEEDED'
      | 'RESOURCE_NOT_FOUND'
      | 'FORBIDDEN'
      | 'STATE_CONFLICT'
      | 'INTERNAL_ERROR',
    retryable: boolean,
  ): CreateExerciseOutput {
    return {
      schemaVersion: COACH_TOOL_SCHEMA_VERSION,
      ok: false,
      code,
      message: '暂时无法创建可靠练习',
      retryable,
    };
  }
}
