import { CoachModelPriceCatalog } from './model-price.catalog';

export class CoachRequestCostBudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED';

  constructor() {
    super('RAG request cost exceeds the approved per-request budget');
  }
}

export class CoachCostMeter {
  constructor(private readonly catalog: CoachModelPriceCatalog) {}

  estimate(input: {
    provider: string;
    modelName: string;
    usageType?: 'model' | 'embedding';
    priceVersion: string;
    inputTokens: number;
    outputTokens: number;
    at: Date;
  }) {
    for (const count of [input.inputTokens, input.outputTokens]) {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('Token counts must be non-negative safe integers');
      }
    }
    const price = this.catalog.resolve(input);
    const estimatedCostMicros = Math.ceil(
      (input.inputTokens * price.inputMicrosPerMillionTokens +
        input.outputTokens * price.outputMicrosPerMillionTokens) /
        1_000_000,
    );
    return Object.freeze({
      estimatedCostMicros,
      currency: 'USD' as const,
      priceVersion: price.priceVersion,
    });
  }

  measureRagRequest(input: {
    mode: 'estimated' | 'actual';
    at: Date;
    maxCostMicros: number;
    embedding: Readonly<{
      provider: string;
      modelName: string;
      priceVersion: string;
      inputTokens: number;
    }>;
    model: Readonly<{
      provider: string;
      modelName: string;
      priceVersion: string;
      inputTokens: number;
      outputTokens: number;
    }>;
  }) {
    if (
      !Number.isSafeInteger(input.maxCostMicros) ||
      input.maxCostMicros < 0 ||
      input.embedding.priceVersion !== input.model.priceVersion
    ) {
      throw new Error(
        'RAG cost budget and price version must be approved and consistent',
      );
    }
    const embedding = this.estimate({
      provider: input.embedding.provider,
      modelName: input.embedding.modelName,
      usageType: 'embedding',
      priceVersion: input.embedding.priceVersion,
      inputTokens: input.embedding.inputTokens,
      outputTokens: 0,
      at: input.at,
    });
    const model = this.estimate({
      provider: input.model.provider,
      modelName: input.model.modelName,
      usageType: 'model',
      priceVersion: input.model.priceVersion,
      inputTokens: input.model.inputTokens,
      outputTokens: input.model.outputTokens,
      at: input.at,
    });
    const totalCostMicros =
      embedding.estimatedCostMicros + model.estimatedCostMicros;
    if (totalCostMicros > input.maxCostMicros) {
      throw new CoachRequestCostBudgetExceededError();
    }
    return Object.freeze({
      mode: input.mode,
      priceVersion: embedding.priceVersion,
      embeddingTokens: input.embedding.inputTokens,
      modelInputTokens: input.model.inputTokens,
      modelOutputTokens: input.model.outputTokens,
      embeddingCostMicros: embedding.estimatedCostMicros,
      modelCostMicros: model.estimatedCostMicros,
      totalCostMicros,
      currency: 'USD' as const,
    });
  }
}
