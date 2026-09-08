import { CoachModelPriceCatalog } from './model-price.catalog';

export class CoachCostMeter {
  constructor(private readonly catalog: CoachModelPriceCatalog) {}

  estimate(input: {
    provider: string;
    modelName: string;
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
}
