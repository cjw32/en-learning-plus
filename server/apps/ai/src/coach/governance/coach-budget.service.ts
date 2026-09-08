export type CoachBudgetLimits = Readonly<{
  maxInputTokens: number;
  maxOutputTokens: number;
  maxModelCalls?: number;
  maxToolCalls: number;
  maxCostMicros: number;
  maxDurationMs: number;
}>;

export type CoachBudgetUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  modelCalls?: number;
  toolCalls: number;
  costMicros: number;
}>;

export class CoachBudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

export class CoachBudgetService {
  private usage: Required<CoachBudgetUsage> = {
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
    toolCalls: 0,
    costMicros: 0,
  };

  constructor(private readonly limits: CoachBudgetLimits) {
    for (const [name, value] of Object.entries(limits)) {
      assertNonNegativeInteger(value, name);
    }
  }

  record(usage: CoachBudgetUsage): void {
    for (const [name, value] of Object.entries(usage)) {
      assertNonNegativeInteger(value, name);
    }
    this.assertCanStartNode({ ...usage, elapsedMs: 0 });
    this.usage = {
      inputTokens: this.usage.inputTokens + usage.inputTokens,
      outputTokens: this.usage.outputTokens + usage.outputTokens,
      modelCalls: this.usage.modelCalls + (usage.modelCalls ?? 0),
      toolCalls: this.usage.toolCalls + usage.toolCalls,
      costMicros: this.usage.costMicros + usage.costMicros,
    };
  }

  assertCanStartNode(
    projected: CoachBudgetUsage & { elapsedMs: number },
  ): void {
    const exceeds =
      this.usage.inputTokens + projected.inputTokens >
        this.limits.maxInputTokens ||
      this.usage.outputTokens + projected.outputTokens >
        this.limits.maxOutputTokens ||
      this.usage.modelCalls + (projected.modelCalls ?? 0) >
        (this.limits.maxModelCalls ?? Number.MAX_SAFE_INTEGER) ||
      this.usage.toolCalls + projected.toolCalls > this.limits.maxToolCalls ||
      this.usage.costMicros + projected.costMicros >
        this.limits.maxCostMicros ||
      projected.elapsedMs >= this.limits.maxDurationMs;
    if (exceeds) {
      throw new CoachBudgetExceededError(
        'Coach request budget exhausted before node start',
      );
    }
  }

  snapshot(): CoachBudgetUsage {
    return Object.freeze({ ...this.usage });
  }
}
