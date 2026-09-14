import { subject } from './test-support';

const api = subject('core/budget-ledger');
const call = {
  callId: 'c1',
  itemId: 'i1',
  attemptId: 'a1',
  purpose: 'candidate',
  provider: 'synthetic',
  priceVersion: 'synthetic-1',
  currency: 'USD',
  upperBoundMicros: 7,
};
describe('T008 global budget admission', () => {
  test('all callers compete for the same reservations; repeated admission is idempotent', () => {
    const events: unknown[] = [];
    const ledger = api.createBudgetLedger?.({
      budgetMicros: 10,
      currency: 'USD',
      profile: 'full',
      record: (type: string, payload: unknown) =>
        events.push({ type, payload }),
    });
    expect(ledger?.reserve(call)).toMatchObject({
      callId: 'c1',
      state: 'RESERVED',
    });
    expect(ledger?.reserve(call)).toMatchObject({ callId: 'c1' });
    expect(ledger?.available()).toBe(3);
    expect(() =>
      ledger?.reserve({
        ...call,
        callId: 'c2',
        purpose: 'judge',
        upperBoundMicros: 4,
      }),
    ).toThrow();
    expect(events).toHaveLength(1);
    expect(() => ledger?.reserve({ ...call, upperBoundMicros: 6 })).toThrow();
  });
  test('unknown accepted charge retains full reservation; no automatic release', () => {
    const ledger = api.createBudgetLedger?.({
      budgetMicros: 10,
      currency: 'USD',
      profile: 'full',
      record: () => {},
    });
    ledger?.reserve(call);
    ledger?.dispatch('c1');
    ledger?.uncertain('c1', 'provider_not_returned');
    expect(ledger?.available()).toBe(3);
    expect(() => ledger?.release('c1', false)).toThrow();
    expect(ledger?.snapshot()).toMatchObject({
      potentialMicros: 7,
      actualMicros: 0,
      unknownCalls: 1,
    });
    ledger?.settle('c1', 5);
    ledger?.settle('c1', 5);
    expect(ledger?.available()).toBe(5);
    expect(() => ledger?.settle('c1', 4)).toThrow();
  });
  test('zero-cost quick forbids external calls; malformed or unknown bounds denied', () => {
    const ledger = api.createBudgetLedger?.({
      budgetMicros: 0,
      currency: 'USD',
      profile: 'quick',
      record: () => {},
    });
    expect(() => ledger?.reserve({ ...call, upperBoundMicros: 0 })).toThrow();
    for (const budgetMicros of [
      -1,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() =>
        api.createBudgetLedger?.({
          budgetMicros,
          currency: 'USD',
          profile: 'full',
          record: () => {},
        }),
      ).toThrow();
    }
  });
  test('write failure denies admission without consuming state; overcharge stops dispatch', () => {
    const ledger = api.createBudgetLedger?.({
      budgetMicros: 10,
      currency: 'USD',
      profile: 'full',
      record: () => {
        throw Error('disk');
      },
    });
    expect(() => ledger?.reserve(call)).toThrow();
    expect(ledger?.available()).toBe(10);
    const over = api.createBudgetLedger?.({
      budgetMicros: 10,
      currency: 'USD',
      profile: 'full',
      record: () => {},
    });
    over?.reserve(call);
    over?.dispatch('c1');
    over?.settle('c1', 12);
    expect(over?.snapshot()).toMatchObject({ stopped: true, actualMicros: 12 });
    expect(() =>
      over?.reserve({ ...call, callId: 'c2', upperBoundMicros: 1 }),
    ).toThrow();
  });
});
