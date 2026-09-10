import {
  InMemoryPronunciationBudgetStore,
  PronunciationBudgetError,
  PronunciationBudgetService,
  type PronunciationBudgetCaps,
} from './pronunciation-budget.service';
import {
  PronunciationPriceCatalog,
  PronunciationPriceUnavailableError,
} from './pronunciation-price.catalog';

const price = {
  provider: 'azure',
  modelVersion: 'speech-v1',
  region: 'eastasia',
  capability: 'BASE' as const,
  currency: 'USD',
  microsPerSecond: 10,
  minimumBillableMs: 1_000,
  priceVersion: 'price-2026-09',
  validFrom: '2026-09-01T00:00:00.000Z',
  validUntil: '2026-10-01T00:00:00.000Z',
  approved: true,
};

const caps: PronunciationBudgetCaps = {
  maxCallCostMicros: 100,
  subjectDailyBudgetMicros: 150,
  systemDailyBudgetMicros: 200,
  systemMonthlyBudgetMicros: 250,
  currency: 'USD',
  budgetVersion: 'budget-v1',
};

const at = new Date('2026-09-10T10:00:00.000Z');

function reserve(
  service: PronunciationBudgetService,
  reservationId: string,
  subjectId: string,
  estimatedCostMicros = 100,
  date = at,
) {
  return service.reserve({
    reservationId,
    subjectId,
    estimatedCostMicros,
    currency: 'USD',
    budgetVersion: 'budget-v1',
    at: date,
  });
}

describe('pronunciation price and budgets', () => {
  it('requires an exact approved regional price/currency/version', () => {
    const catalog = new PronunciationPriceCatalog([price]);
    const resolved = catalog.resolve({
      provider: 'azure',
      modelVersion: 'speech-v1',
      region: 'eastasia',
      capability: 'BASE',
      currency: 'USD',
      priceVersion: 'price-2026-09',
      at,
    });
    expect(catalog.estimateMicros(resolved, 1_500)).toBe(15);
    for (const override of [
      { region: 'westus' },
      { currency: 'CNY' },
      { priceVersion: 'unknown' },
      { capability: 'PROSODY' as const },
    ]) {
      expect(() =>
        catalog.resolve({
          provider: 'azure',
          modelVersion: 'speech-v1',
          region: 'eastasia',
          capability: 'BASE',
          currency: 'USD',
          priceVersion: 'price-2026-09',
          at,
          ...override,
        }),
      ).toThrow(PronunciationPriceUnavailableError);
    }
  });

  it.each([
    'maxCallCostMicros',
    'subjectDailyBudgetMicros',
    'systemDailyBudgetMicros',
    'systemMonthlyBudgetMicros',
    'currency',
    'budgetVersion',
  ] as const)('rejects an absent %s approval', (key) => {
    expect(
      () =>
        new PronunciationBudgetService(new InMemoryPronunciationBudgetStore(), {
          ...caps,
          [key]: null,
        }),
    ).toThrow(new PronunciationBudgetError('BUDGET_NOT_APPROVED'));
  });

  it('enforces per-call, subject-day, system-day and system-month caps', async () => {
    const store = new InMemoryPronunciationBudgetStore();
    const service = new PronunciationBudgetService(store, caps);
    await expect(
      reserve(service, 'too-large', 'u0', 101),
    ).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
    });
    await reserve(service, 'r1', 'u1');
    await expect(reserve(service, 'r2', 'u1')).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
    });
    await reserve(service, 'r3', 'u2');
    await expect(reserve(service, 'r4', 'u3')).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
    });

    const monthStore = new InMemoryPronunciationBudgetStore();
    const monthService = new PronunciationBudgetService(monthStore, {
      ...caps,
      systemDailyBudgetMicros: 250,
    });
    await reserve(
      monthService,
      'm1',
      'u1',
      100,
      new Date('2026-09-10T00:00:00Z'),
    );
    await reserve(
      monthService,
      'm2',
      'u2',
      100,
      new Date('2026-09-11T00:00:00Z'),
    );
    await expect(
      reserve(monthService, 'm3', 'u3', 100, new Date('2026-09-12T00:00:00Z')),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });

  it('reserves and settles idempotently without double accounting', async () => {
    const service = new PronunciationBudgetService(
      new InMemoryPronunciationBudgetStore(),
      caps,
    );
    await reserve(service, 'r1', 'u1', 80);
    await reserve(service, 'r1', 'u1', 80);
    await service.settle('r1', 30);
    await service.settle('r1', 30);
    await expect(service.settle('r1', 31)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    await expect(reserve(service, 'r2', 'u1', 100)).resolves.toBeDefined();
  });

  it('rejects mismatched currency or budget version', async () => {
    const service = new PronunciationBudgetService(
      new InMemoryPronunciationBudgetStore(),
      caps,
    );
    await expect(
      service.reserve({
        reservationId: 'r1',
        subjectId: 'u1',
        estimatedCostMicros: 1,
        currency: 'CNY',
        budgetVersion: 'budget-v1',
        at,
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_NOT_APPROVED' });
    await expect(
      service.reserve({
        reservationId: 'r2',
        subjectId: 'u1',
        estimatedCostMicros: 1,
        currency: 'USD',
        budgetVersion: 'unknown',
        at,
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_NOT_APPROVED' });
  });
});
