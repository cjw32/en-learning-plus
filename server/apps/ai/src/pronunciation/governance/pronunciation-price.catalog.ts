export type PronunciationRegionalPrice = Readonly<{
  provider: string;
  modelVersion: string;
  region: string;
  capability: 'BASE' | 'PROSODY';
  currency: string;
  microsPerSecond: number;
  minimumBillableMs: number;
  priceVersion: string;
  validFrom: string;
  validUntil: string;
  approved: boolean;
}>;

export class PronunciationPriceUnavailableError extends Error {
  readonly code = 'PRICE_UNKNOWN';

  constructor() {
    super('No approved regional pronunciation price is available');
    this.name = 'PronunciationPriceUnavailableError';
  }
}

export class PronunciationPriceCatalog {
  private readonly prices: readonly PronunciationRegionalPrice[];

  constructor(prices: readonly PronunciationRegionalPrice[]) {
    this.prices = Object.freeze(
      prices.map((price) => {
        if (
          !Number.isSafeInteger(price.microsPerSecond) ||
          price.microsPerSecond < 0 ||
          !Number.isSafeInteger(price.minimumBillableMs) ||
          price.minimumBillableMs < 0 ||
          !/^[A-Z]{3}$/.test(price.currency) ||
          !Number.isFinite(Date.parse(price.validFrom)) ||
          !Number.isFinite(Date.parse(price.validUntil)) ||
          Date.parse(price.validUntil) <= Date.parse(price.validFrom)
        ) {
          throw new Error('Pronunciation price entry is invalid');
        }
        return Object.freeze({ ...price });
      }),
    );
  }

  resolve(
    input: Readonly<{
      provider: string;
      modelVersion: string;
      region: string;
      capability: 'BASE' | 'PROSODY';
      currency: string;
      priceVersion: string;
      at: Date;
    }>,
  ): PronunciationRegionalPrice {
    const at = input.at.getTime();
    const price = this.prices.find(
      (candidate) =>
        candidate.approved &&
        candidate.provider === input.provider &&
        candidate.modelVersion === input.modelVersion &&
        candidate.region === input.region &&
        candidate.capability === input.capability &&
        candidate.currency === input.currency &&
        candidate.priceVersion === input.priceVersion &&
        at >= Date.parse(candidate.validFrom) &&
        at < Date.parse(candidate.validUntil),
    );
    if (!price) throw new PronunciationPriceUnavailableError();
    return price;
  }

  estimateMicros(
    price: PronunciationRegionalPrice,
    durationMs: number,
  ): number {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
      throw new Error('Billable duration must be a non-negative integer');
    }
    const billedMs = Math.max(durationMs, price.minimumBillableMs);
    const estimate = Math.ceil((billedMs * price.microsPerSecond) / 1_000);
    if (!Number.isSafeInteger(estimate)) {
      throw new PronunciationPriceUnavailableError();
    }
    return estimate;
  }
}
