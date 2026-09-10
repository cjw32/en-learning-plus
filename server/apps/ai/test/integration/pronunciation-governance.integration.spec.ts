import {
  InMemoryPronunciationAdmissionStore,
  PronunciationAdmissionService,
} from '../../src/pronunciation/governance/pronunciation-admission.service';
import {
  InMemoryPronunciationBudgetStore,
  PronunciationBudgetService,
} from '../../src/pronunciation/governance/pronunciation-budget.service';
import { PronunciationCostMeter } from '../../src/pronunciation/governance/pronunciation-cost-meter';
import { PronunciationPriceCatalog } from '../../src/pronunciation/governance/pronunciation-price.catalog';

const now = new Date('2026-09-10T10:00:00.000Z');
const caps = {
  maxCallCostMicros: 100,
  subjectDailyBudgetMicros: 150,
  systemDailyBudgetMicros: 200,
  systemMonthlyBudgetMicros: 250,
  currency: 'USD',
  budgetVersion: 'budget-v1',
};
const price = {
  provider: 'fake',
  modelVersion: 'model-v1',
  region: 'eastasia',
  capability: 'BASE' as const,
  currency: 'USD',
  microsPerSecond: 10,
  minimumBillableMs: 1_000,
  priceVersion: 'price-v1',
  validFrom: '2026-09-01T00:00:00.000Z',
  validUntil: '2026-10-01T00:00:00.000Z',
  approved: true,
};

describe('pronunciation governance races', () => {
  it('admits exactly one of parallel requests for one subject', async () => {
    const service = new PronunciationAdmissionService(
      new InMemoryPronunciationAdmissionStore(),
      () => now.getTime(),
    );
    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        service.admit({
          subjectId: 'subject-1',
          assessmentId: `assessment-${index}`,
          activeTtlSeconds: 30,
        }),
      ),
    );
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(
      11,
    );
  });

  it('holds the exact six/minute and 120/day limits', async () => {
    let clock = now.getTime();
    const service = new PronunciationAdmissionService(
      new InMemoryPronunciationAdmissionStore(),
      () => clock,
    );
    for (let index = 0; index < 120; index += 1) {
      clock = now.getTime() + Math.floor(index / 6) * 60_000;
      const lease = await service.admit({
        subjectId: 'subject-1',
        assessmentId: `assessment-${index}`,
        activeTtlSeconds: 30,
      });
      await lease.release();
      if ((index + 1) % 6 === 0 && index < 119) {
        await expect(
          service.admit({
            subjectId: 'subject-1',
            assessmentId: `blocked-${index}`,
            activeTtlSeconds: 30,
          }),
        ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      }
    }
    clock = now.getTime() + 20 * 60_000;
    await expect(
      service.admit({
        subjectId: 'subject-1',
        assessmentId: 'assessment-121',
        activeTtlSeconds: 30,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('atomically enforces all four budgets under parallel reservations', async () => {
    const budget = new PronunciationBudgetService(
      new InMemoryPronunciationBudgetStore(),
      caps,
    );
    await expect(
      budget.reserve({
        reservationId: 'too-large',
        subjectId: 's0',
        estimatedCostMicros: 101,
        currency: 'USD',
        budgetVersion: 'budget-v1',
        at: now,
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });

    const outcomes = await Promise.allSettled([
      budget.reserve({
        reservationId: 'r1',
        subjectId: 's1',
        estimatedCostMicros: 100,
        currency: 'USD',
        budgetVersion: 'budget-v1',
        at: now,
      }),
      budget.reserve({
        reservationId: 'r2',
        subjectId: 's1',
        estimatedCostMicros: 100,
        currency: 'USD',
        budgetVersion: 'budget-v1',
        at: now,
      }),
      budget.reserve({
        reservationId: 'r3',
        subjectId: 's2',
        estimatedCostMicros: 100,
        currency: 'USD',
        budgetVersion: 'budget-v1',
        at: now,
      }),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(
      2,
    );
    expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(
      1,
    );

    await expect(
      budget.reserve({
        reservationId: 'r4',
        subjectId: 's3',
        estimatedCostMicros: 1,
        currency: 'USD',
        budgetVersion: 'budget-v1',
        at: now,
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });

  it('settles actual duration once and preserves potential cost after unknown acceptance', async () => {
    const budget = new PronunciationBudgetService(
      new InMemoryPronunciationBudgetStore(),
      caps,
    );
    const meter = new PronunciationCostMeter(
      new PronunciationPriceCatalog([price]),
      budget,
    );
    const reservation = await meter.reserve({
      reservationId: 'meter-1',
      subjectId: 's1',
      provider: 'fake',
      modelVersion: 'model-v1',
      region: 'eastasia',
      capability: 'BASE',
      currency: 'USD',
      priceVersion: 'price-v1',
      budgetVersion: 'budget-v1',
      estimatedDurationMs: 10_000,
      at: now,
    });
    const settled = await Promise.all([
      meter.settle(reservation, 4_000, true),
      meter.settle(reservation, 4_000, true),
    ]);
    expect(settled).toEqual([
      { status: 'SETTLED', actualCostMicros: 40, potentialCostMicros: 0 },
      { status: 'REPLAYED', actualCostMicros: 40, potentialCostMicros: 0 },
    ]);

    const unknown = await meter.reserve({
      reservationId: 'meter-unknown',
      subjectId: 's2',
      provider: 'fake',
      modelVersion: 'model-v1',
      region: 'eastasia',
      capability: 'BASE',
      currency: 'USD',
      priceVersion: 'price-v1',
      budgetVersion: 'budget-v1',
      estimatedDurationMs: 5_000,
      at: now,
    });
    expect(meter.markUnknownAcceptance(unknown)).toEqual({
      status: 'POTENTIALLY_BILLABLE',
      actualCostMicros: 0,
      potentialCostMicros: 50,
    });
  });
});
