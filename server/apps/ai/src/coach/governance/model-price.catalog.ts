export type CoachModelPrice = Readonly<{
  provider: string;
  modelName: string;
  usageType?: 'model' | 'embedding';
  priceVersion: string;
  inputMicrosPerMillionTokens: number;
  outputMicrosPerMillionTokens: number;
  validFrom: string;
  validUntil: string;
  approved?: boolean;
}>;

export class CoachPriceUnavailableError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
  constructor() {
    super('No approved active model price is available');
  }
}

export class CoachModelPriceCatalog {
  private readonly prices: readonly CoachModelPrice[];

  constructor(prices: readonly CoachModelPrice[]) {
    this.prices = Object.freeze(
      prices.map((price) => {
        for (const rate of [
          price.inputMicrosPerMillionTokens,
          price.outputMicrosPerMillionTokens,
        ]) {
          if (!Number.isSafeInteger(rate) || rate < 0) {
            throw new Error('Model prices must be non-negative safe integers');
          }
        }
        if (
          !Number.isFinite(Date.parse(price.validFrom)) ||
          !Number.isFinite(Date.parse(price.validUntil)) ||
          Date.parse(price.validUntil) <= Date.parse(price.validFrom)
        ) {
          throw new Error('Model price validity range is invalid');
        }
        return Object.freeze({ ...price });
      }),
    );
  }

  resolve(input: {
    provider: string;
    modelName: string;
    usageType?: 'model' | 'embedding';
    priceVersion: string;
    at: Date;
  }): CoachModelPrice {
    const timestamp = input.at.getTime();
    const price = this.prices.find(
      (candidate) =>
        candidate.provider === input.provider &&
        candidate.modelName === input.modelName &&
        (candidate.usageType ?? 'model') === (input.usageType ?? 'model') &&
        candidate.priceVersion === input.priceVersion &&
        candidate.approved !== false &&
        timestamp >= Date.parse(candidate.validFrom) &&
        timestamp < Date.parse(candidate.validUntil),
    );
    if (!price) throw new CoachPriceUnavailableError();
    return price;
  }
}
