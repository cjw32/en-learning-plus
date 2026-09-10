import {
  CoachCostMeter,
  CoachRequestCostBudgetExceededError,
} from '../../src/coach/governance/coach-cost-meter';
import {
  CoachModelPriceCatalog,
  CoachPriceUnavailableError,
} from '../../src/coach/governance/model-price.catalog';

const at = new Date('2026-09-08T00:00:00.000Z');

const catalog = new CoachModelPriceCatalog([
  {
    provider: 'approved-test',
    modelName: 'embedding-test-v1',
    usageType: 'embedding',
    priceVersion: 'rag-price.v1',
    inputMicrosPerMillionTokens: 100_000,
    outputMicrosPerMillionTokens: 0,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2027-01-01T00:00:00.000Z',
    approved: true,
  },
  {
    provider: 'approved-test',
    modelName: 'coach-test-v1',
    usageType: 'model',
    priceVersion: 'rag-price.v1',
    inputMicrosPerMillionTokens: 1_000_000,
    outputMicrosPerMillionTokens: 2_000_000,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2027-01-01T00:00:00.000Z',
    approved: true,
  },
]);

describe('RAG request cost governance', () => {
  it.each(['estimated', 'actual'] as const)(
    'meters embedding and model usage in %s mode under one versioned budget',
    (mode) => {
      const result = new CoachCostMeter(catalog).measureRagRequest({
        mode,
        at,
        maxCostMicros: 500,
        embedding: {
          provider: 'approved-test',
          modelName: 'embedding-test-v1',
          priceVersion: 'rag-price.v1',
          inputTokens: 1_000,
        },
        model: {
          provider: 'approved-test',
          modelName: 'coach-test-v1',
          priceVersion: 'rag-price.v1',
          inputTokens: 100,
          outputTokens: 50,
        },
      });
      expect(result).toEqual({
        mode,
        priceVersion: 'rag-price.v1',
        embeddingTokens: 1_000,
        modelInputTokens: 100,
        modelOutputTokens: 50,
        embeddingCostMicros: 100,
        modelCostMicros: 200,
        totalCostMicros: 300,
        currency: 'USD',
      });
    },
  );

  it('fails closed when a request would exceed its approved budget', () => {
    expect(() =>
      new CoachCostMeter(catalog).measureRagRequest({
        mode: 'actual',
        at,
        maxCostMicros: 299,
        embedding: {
          provider: 'approved-test',
          modelName: 'embedding-test-v1',
          priceVersion: 'rag-price.v1',
          inputTokens: 1_000,
        },
        model: {
          provider: 'approved-test',
          modelName: 'coach-test-v1',
          priceVersion: 'rag-price.v1',
          inputTokens: 100,
          outputTokens: 50,
        },
      }),
    ).toThrow(CoachRequestCostBudgetExceededError);
  });

  it.each([
    ['unknown provider', 'unknown', 'coach-test-v1'],
    ['unknown price', 'approved-test', 'missing-model'],
  ])('does not fabricate zero cost for %s', (_label, provider, modelName) => {
    expect(() =>
      new CoachCostMeter(catalog).estimate({
        provider,
        modelName,
        priceVersion: 'rag-price.v1',
        inputTokens: 0,
        outputTokens: 0,
        at,
      }),
    ).toThrow(CoachPriceUnavailableError);
  });

  it('rejects an explicitly unapproved price entry', () => {
    const unapproved = new CoachModelPriceCatalog([
      {
        provider: 'test',
        modelName: 'candidate',
        usageType: 'model',
        priceVersion: 'candidate-price.v1',
        inputMicrosPerMillionTokens: 1,
        outputMicrosPerMillionTokens: 1,
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2027-01-01T00:00:00.000Z',
        approved: false,
      },
    ]);
    expect(() =>
      new CoachCostMeter(unapproved).estimate({
        provider: 'test',
        modelName: 'candidate',
        priceVersion: 'candidate-price.v1',
        inputTokens: 1,
        outputTokens: 1,
        at,
      }),
    ).toThrow(CoachPriceUnavailableError);
  });
});
