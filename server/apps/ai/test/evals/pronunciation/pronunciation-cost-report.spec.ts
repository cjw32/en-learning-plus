import { buildPronunciationCostReport } from './pronunciation-cost-report';

const caps = {
  maxCallCostMicros: 100,
  subjectDailyBudgetMicros: 150,
  systemDailyBudgetMicros: 200,
  systemMonthlyBudgetMicros: 250,
};

describe('pronunciation cost report', () => {
  it('groups approved costs by Provider/region/capability/model/price and separates prosody', () => {
    const calls = [
      {
        callId: 'a:1',
        subjectHash: 'subject-a',
        day: '2026-09-10',
        month: '2026-09',
        provider: 'fake',
        region: 'eastasia',
        capability: 'BASE' as const,
        modelVersion: 'model-v1',
        priceVersion: 'price-v1',
        budgetVersion: 'budget-v1',
        priceApproved: true,
        actualCostMicros: 40,
        potentialCostMicros: 0,
      },
      {
        callId: 'b:1',
        subjectHash: 'subject-b',
        day: '2026-09-10',
        month: '2026-09',
        provider: 'fake',
        region: 'eastasia',
        capability: 'PROSODY' as const,
        modelVersion: 'model-v1',
        priceVersion: 'price-v1',
        budgetVersion: 'budget-v1',
        priceApproved: true,
        actualCostMicros: 60,
        potentialCostMicros: 0,
      },
    ];
    const report = buildPronunciationCostReport({
      calls,
      settlements: calls.map((call) => ({
        callId: call.callId,
        accountedMicros: call.actualCostMicros + call.potentialCostMicros,
      })),
      caps,
    });
    expect(report.reconciledCallCount).toBe(2);
    expect(report.unreconciledCallIds).toEqual([]);
    expect(report.groups).toHaveLength(2);
    expect(report.groups.map((group) => group.capability)).toEqual([
      'BASE',
      'PROSODY',
    ]);
    expect(report.budgetEvidence.systemDay).toEqual({ '2026-09-10': 100 });
    expect(report.passed).toBe(true);
  });

  it('blocks unknown/unapproved price and preserves unknown-acceptance potential cost', () => {
    const report = buildPronunciationCostReport({
      calls: [
        {
          callId: 'unknown:1',
          subjectHash: 'subject-a',
          day: '2026-09-10',
          month: '2026-09',
          provider: 'fake',
          region: 'eastasia',
          capability: 'BASE',
          modelVersion: 'model-v1',
          priceVersion: 'unknown',
          budgetVersion: 'budget-v1',
          priceApproved: false,
          actualCostMicros: 0,
          potentialCostMicros: 80,
        },
      ],
      settlements: [{ callId: 'unknown:1', accountedMicros: 80 }],
      caps,
    });
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('UNAPPROVED_PRICE:unknown:1');
    expect(report.totalPotentialCostMicros).toBe(80);
  });

  it('fails missing ledger reconciliation and every budget cap independently', () => {
    const call = {
      callId: 'a:1',
      subjectHash: 'subject-a',
      day: '2026-09-10',
      month: '2026-09',
      provider: 'fake',
      region: 'eastasia',
      capability: 'BASE' as const,
      modelVersion: 'model-v1',
      priceVersion: 'price-v1',
      budgetVersion: 'budget-v1',
      priceApproved: true,
      actualCostMicros: 101,
      potentialCostMicros: 0,
    };
    const report = buildPronunciationCostReport({
      calls: [call],
      settlements: [],
      caps,
    });
    expect(report.passed).toBe(false);
    expect(report.unreconciledCallIds).toEqual(['a:1']);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        'UNRECONCILED_CALL:a:1',
        'CALL_BUDGET_EXCEEDED:a:1',
      ]),
    );
  });
});
