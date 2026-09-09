import { Injectable } from '@nestjs/common';
import {
  CoachBudgetExceededError,
  CoachBudgetService,
  type CoachBudgetLimits,
} from './coach-budget.service';
import { CoachCostMeter } from './coach-cost-meter';
import { CoachModelPriceCatalog } from './model-price.catalog';
import { resolveCoachRuntimeConfig } from './coach-config.schema';

const POLICY_FIELDS = {
  maxInputTokens: 'COACH_MAX_INPUT_TOKENS',
  maxOutputTokens: 'COACH_MAX_OUTPUT_TOKENS',
  maxModelCalls: 'COACH_MAX_MODEL_CALLS',
  maxToolCalls: 'COACH_MAX_TOOL_CALLS',
  maxCostMicros: 'COACH_MAX_COST_MICROS',
  maxDurationMs: 'COACH_MAX_DURATION_MS',
} as const;

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export interface CoachRuntimeBudgetFactory {
  create(deadlineRemainingMs: number): CoachBudgetService;
  policyVersion(): string;
  projectModelUsage(at?: Date): {
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
    toolCalls: number;
    costMicros: number;
  };
  measureModelUsage(input: {
    inputTokens: number;
    outputTokens: number;
    at: Date;
  }): {
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
    toolCalls: number;
    costMicros: number;
  };
}

@Injectable()
export class EnvironmentCoachRuntimeBudgetFactory
  implements CoachRuntimeBudgetFactory
{
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  create(deadlineRemainingMs: number) {
    const policyVersion = this.policyVersion();
    const values = Object.fromEntries(
      Object.entries(POLICY_FIELDS).map(([key, environmentName]) => [
        key,
        positiveInteger(this.environment[environmentName]),
      ]),
    ) as Record<keyof CoachBudgetLimits, number | null>;
    if (
      this.environment.COACH_BUDGET_POLICY_APPROVED !== 'true' ||
      !policyVersion ||
      Object.values(values).some((value) => value === null)
    ) {
      throw new CoachBudgetExceededError(
        'Coach budget policy has not been measured and approved',
      );
    }
    return new CoachBudgetService({
      maxInputTokens: values.maxInputTokens!,
      maxOutputTokens: values.maxOutputTokens!,
      maxModelCalls: values.maxModelCalls!,
      maxToolCalls: values.maxToolCalls!,
      maxCostMicros: values.maxCostMicros!,
      maxDurationMs: Math.min(values.maxDurationMs!, deadlineRemainingMs),
    });
  }

  policyVersion() {
    return this.environment.COACH_BUDGET_POLICY_VERSION?.trim() ?? '';
  }

  projectModelUsage(at: Date = new Date()) {
    const inputTokens = this.requiredPositive(
      'COACH_MAX_MODEL_INPUT_TOKENS_PER_CALL',
    );
    const outputTokens = this.requiredPositive(
      'COACH_MAX_MODEL_OUTPUT_TOKENS_PER_CALL',
    );
    return this.measureModelUsage({ inputTokens, outputTokens, at });
  }

  measureModelUsage(input: {
    inputTokens: number;
    outputTokens: number;
    at: Date;
  }) {
    const config = resolveCoachRuntimeConfig(this.environment);
    if (
      !config.liveModelEnabled ||
      !config.modelName ||
      !config.modelPriceVersion
    ) {
      throw new CoachBudgetExceededError('Approved live model policy is missing');
    }
    const meter = new CoachCostMeter(
      new CoachModelPriceCatalog([
        {
          provider: 'deepseek',
          modelName: config.modelName,
          priceVersion: config.modelPriceVersion,
          inputMicrosPerMillionTokens: this.requiredPositive(
            'COACH_MODEL_INPUT_PRICE_MICROS_PER_MILLION_TOKENS',
          ),
          outputMicrosPerMillionTokens: this.requiredPositive(
            'COACH_MODEL_OUTPUT_PRICE_MICROS_PER_MILLION_TOKENS',
          ),
          validFrom: this.requiredValue('COACH_MODEL_PRICE_VALID_FROM'),
          validUntil: this.requiredValue('COACH_MODEL_PRICE_VALID_UNTIL'),
        },
      ]),
    );
    const cost = meter.estimate({
      provider: 'deepseek',
      modelName: config.modelName,
      priceVersion: config.modelPriceVersion,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      at: input.at,
    });
    return {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      modelCalls: 1,
      toolCalls: 0,
      costMicros: cost.estimatedCostMicros,
    };
  }

  private requiredPositive(name: string) {
    const value = positiveInteger(this.environment[name]);
    if (value === null) {
      throw new CoachBudgetExceededError(`${name} is not approved`);
    }
    return value;
  }

  private requiredValue(name: string) {
    const value = this.environment[name]?.trim();
    if (!value) throw new CoachBudgetExceededError(`${name} is not approved`);
    return value;
  }
}
