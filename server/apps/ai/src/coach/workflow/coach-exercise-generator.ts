import { Injectable } from '@nestjs/common';
import type { CoachExerciseGenerator } from '../tools/create-exercise.tool';
import type {
  CoachModelTelemetry,
  CoachStructuredModel,
} from './coach-model.gateway';
import type { CoachExerciseBudgetGate } from '../tools/create-exercise.tool';
import { resolveCoachRuntimeConfig } from '../governance/coach-config.schema';

@Injectable()
export class CoachModelExerciseGenerator implements CoachExerciseGenerator {
  constructor(private readonly model: CoachStructuredModel) {}

  generateDefinition(
    input: { prompt: string; jsonSchema: unknown },
    signal?: AbortSignal,
    telemetry?: CoachModelTelemetry,
  ) {
    return this.model.invokeStructured({
      schemaName: 'coach_exercise_v1',
      prompt: input.prompt,
      jsonSchema: input.jsonSchema,
      signal,
      telemetry,
    });
  }
}

export class EnvironmentCoachExerciseBudgetGate
  implements CoachExerciseBudgetGate
{
  assertCanGenerate(): void {
    const config = resolveCoachRuntimeConfig(process.env);
    if (
      !config.liveModelEnabled ||
      process.env.COACH_BUDGET_POLICY_APPROVED !== 'true'
    ) {
      throw Object.assign(new Error('Coach model budget is not approved'), {
        code: 'BUDGET_EXCEEDED',
      });
    }
  }
}
