import { budgetReservationSchema } from '../contracts/evidence.schema';
import { z } from '@en/common/coach/zod';

type Reservation = z.infer<typeof budgetReservationSchema>;
type Call = Omit<Reservation, 'state' | 'actualCostMicros' | 'uncertainReason'>;
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function createBudgetLedger(options: {
  budgetMicros: number;
  currency: string;
  profile: 'quick' | 'full';
  record: (type: string, payload: Record<string, unknown>) => unknown;
}) {
  if (
    !integer(options.budgetMicros) ||
    !/^[A-Z]{3}$/.test(options.currency) ||
    !['quick', 'full'].includes(options.profile) ||
    (options.profile === 'quick' && options.budgetMicros !== 0)
  )
    throw Error('INVALID_BUDGET');
  const calls = new Map<string, Reservation>();
  let stopped = false;
  function snapshot() {
    const all = [...calls.values()];
    const actualMicros = all.reduce(
      (sum, r) => sum + (r.actualCostMicros ?? 0),
      0,
    );
    const potentialMicros = all
      .filter((r) => !['SETTLED', 'RELEASED'].includes(r.state))
      .reduce((sum, r) => sum + r.upperBoundMicros, 0);
    return {
      actualMicros,
      potentialMicros,
      unknownCalls: all.filter((r) => r.state === 'UNCERTAIN').length,
      stopped,
      currency: options.currency,
      budgetMicros: options.budgetMicros,
      calls: structuredClone(all),
    };
  }
  function available() {
    const s = snapshot();
    return Math.max(
      0,
      options.budgetMicros - s.actualMicros - s.potentialMicros,
    );
  }
  function current(id: string) {
    const r = calls.get(id);
    if (!r) throw Error('UNKNOWN_RESERVATION');
    return r;
  }
  function update(type: string, next: Reservation) {
    options.record(type, { ...next }); // Persistence must succeed before in-memory publication or dispatch.
    calls.set(next.callId, structuredClone(next));
    return structuredClone(next);
  }
  return {
    snapshot,
    available,
    reserve(input: Call) {
      const next = budgetReservationSchema.parse({
        ...input,
        state: 'RESERVED',
        actualCostMicros: null,
        uncertainReason: null,
      });
      const existing = calls.get(next.callId);
      if (existing) {
        for (const key of Object.keys(input) as Array<keyof Call>)
          if (existing[key] !== next[key]) throw Error('RESERVATION_CONFLICT');
        return structuredClone(existing);
      }
      if (
        stopped ||
        options.profile === 'quick' ||
        next.currency !== options.currency ||
        !next.priceVersion ||
        next.upperBoundMicros <= 0 ||
        next.upperBoundMicros > available()
      )
        throw Error('BUDGET_STOPPED');
      return update('RESERVED', next);
    },
    dispatch(id: string) {
      const old = current(id);
      if (stopped || old.state !== 'RESERVED')
        throw Error('DISPATCH_NOT_ALLOWED');
      return update('DISPATCHED', { ...old, state: 'DISPATCHED' });
    },
    uncertain(id: string, reason: string) {
      const old = current(id);
      if (!reason || !['DISPATCHED', 'UNCERTAIN'].includes(old.state))
        throw Error('INVALID_UNCERTAIN_STATE');
      return update('UNCERTAIN', {
        ...old,
        state: 'UNCERTAIN',
        uncertainReason: reason,
      });
    },
    release(id: string, confirmedNotAccepted: boolean) {
      const old = current(id);
      if (!confirmedNotAccepted || ['SETTLED', 'RELEASED'].includes(old.state))
        throw Error('ACCEPTANCE_NOT_RECONCILED');
      return update('RELEASED', {
        ...old,
        state: 'RELEASED',
        actualCostMicros: 0,
        uncertainReason: null,
      });
    },
    settle(id: string, actualCostMicros: number) {
      const old = current(id);
      if (!integer(actualCostMicros)) throw Error('ACTUAL_COST_UNKNOWN');
      if (old.state === 'SETTLED') {
        if (old.actualCostMicros !== actualCostMicros)
          throw Error('SETTLEMENT_CONFLICT');
        return structuredClone(old);
      }
      if (!['DISPATCHED', 'UNCERTAIN'].includes(old.state))
        throw Error('NOT_DISPATCHED');
      const next = update('SETTLED', {
        ...old,
        state: 'SETTLED',
        actualCostMicros,
        uncertainReason: null,
      });
      if (
        actualCostMicros > old.upperBoundMicros ||
        snapshot().actualMicros > options.budgetMicros
      )
        stopped = true;
      return next;
    },
  };
}
export type BudgetLedger = ReturnType<typeof createBudgetLedger>;
