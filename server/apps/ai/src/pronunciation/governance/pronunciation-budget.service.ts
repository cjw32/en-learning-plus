/* eslint-disable @typescript-eslint/require-await -- The in-memory budget adapter must execute its promise-returning port atomically without yielding. */

import { createHash } from 'node:crypto';

export type PronunciationBudgetCaps = Readonly<{
  maxCallCostMicros: number | null;
  subjectDailyBudgetMicros: number | null;
  systemDailyBudgetMicros: number | null;
  systemMonthlyBudgetMicros: number | null;
  currency: string | null;
  budgetVersion: string | null;
}>;

type ApprovedPronunciationBudgetCaps = Readonly<{
  maxCallCostMicros: number;
  subjectDailyBudgetMicros: number;
  systemDailyBudgetMicros: number;
  systemMonthlyBudgetMicros: number;
  currency: string;
  budgetVersion: string;
}>;

export type PronunciationBudgetReservation = Readonly<{
  reservationId: string;
  subjectHash: string;
  day: string;
  month: string;
  reservedMicros: number;
  currency: string;
  budgetVersion: string;
}>;

export interface PronunciationBudgetStore {
  reserve(
    reservation: PronunciationBudgetReservation,
    caps: ApprovedPronunciationBudgetCaps,
  ): Promise<'RESERVED' | 'REPLAY' | 'EXCEEDED' | 'CONFLICT'>;
  settle(
    reservationId: string,
    actualCostMicros: number,
  ): Promise<'SETTLED' | 'REPLAY' | 'NOT_FOUND' | 'CONFLICT'>;
  release(reservationId: string): Promise<void>;
}

export class PronunciationBudgetError extends Error {
  constructor(
    readonly code: 'BUDGET_NOT_APPROVED' | 'BUDGET_EXCEEDED' | 'STATE_CONFLICT',
  ) {
    super(code);
    this.name = 'PronunciationBudgetError';
  }
}

type StoredReservation = {
  reservation: PronunciationBudgetReservation;
  settledMicros: number | null;
  released: boolean;
};

export class InMemoryPronunciationBudgetStore implements PronunciationBudgetStore {
  private readonly reservations = new Map<string, StoredReservation>();
  private readonly subjectDays = new Map<string, number>();
  private readonly systemDays = new Map<string, number>();
  private readonly systemMonths = new Map<string, number>();

  async reserve(
    reservation: PronunciationBudgetReservation,
    caps: ApprovedPronunciationBudgetCaps,
  ): Promise<'RESERVED' | 'REPLAY' | 'EXCEEDED' | 'CONFLICT'> {
    const existing = this.reservations.get(reservation.reservationId);
    if (existing) {
      return JSON.stringify(existing.reservation) ===
        JSON.stringify(reservation)
        ? 'REPLAY'
        : 'CONFLICT';
    }
    const subjectKey = `${reservation.subjectHash}:${reservation.day}`;
    const subjectTotal = this.subjectDays.get(subjectKey) ?? 0;
    const dayTotal = this.systemDays.get(reservation.day) ?? 0;
    const monthTotal = this.systemMonths.get(reservation.month) ?? 0;
    if (
      reservation.reservedMicros > caps.maxCallCostMicros ||
      subjectTotal + reservation.reservedMicros >
        caps.subjectDailyBudgetMicros ||
      dayTotal + reservation.reservedMicros > caps.systemDailyBudgetMicros ||
      monthTotal + reservation.reservedMicros > caps.systemMonthlyBudgetMicros
    ) {
      return 'EXCEEDED';
    }
    this.reservations.set(reservation.reservationId, {
      reservation,
      settledMicros: null,
      released: false,
    });
    this.add(reservation, reservation.reservedMicros);
    return 'RESERVED';
  }

  async settle(
    reservationId: string,
    actualCostMicros: number,
  ): Promise<'SETTLED' | 'REPLAY' | 'NOT_FOUND' | 'CONFLICT'> {
    const stored = this.reservations.get(reservationId);
    if (!stored || stored.released) return 'NOT_FOUND';
    if (stored.settledMicros !== null) {
      return stored.settledMicros === actualCostMicros ? 'REPLAY' : 'CONFLICT';
    }
    if (actualCostMicros > stored.reservation.reservedMicros) return 'CONFLICT';
    this.add(
      stored.reservation,
      actualCostMicros - stored.reservation.reservedMicros,
    );
    stored.settledMicros = actualCostMicros;
    return 'SETTLED';
  }

  async release(reservationId: string): Promise<void> {
    const stored = this.reservations.get(reservationId);
    if (!stored || stored.released || stored.settledMicros !== null) return;
    stored.released = true;
    this.add(stored.reservation, -stored.reservation.reservedMicros);
  }

  private add(
    reservation: PronunciationBudgetReservation,
    delta: number,
  ): void {
    const subjectKey = `${reservation.subjectHash}:${reservation.day}`;
    this.subjectDays.set(
      subjectKey,
      (this.subjectDays.get(subjectKey) ?? 0) + delta,
    );
    this.systemDays.set(
      reservation.day,
      (this.systemDays.get(reservation.day) ?? 0) + delta,
    );
    this.systemMonths.set(
      reservation.month,
      (this.systemMonths.get(reservation.month) ?? 0) + delta,
    );
  }
}

function positiveInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

function approvedCaps(
  caps: PronunciationBudgetCaps,
): ApprovedPronunciationBudgetCaps {
  if (
    !positiveInteger(caps.maxCallCostMicros) ||
    !positiveInteger(caps.subjectDailyBudgetMicros) ||
    !positiveInteger(caps.systemDailyBudgetMicros) ||
    !positiveInteger(caps.systemMonthlyBudgetMicros) ||
    !caps.currency ||
    !/^[A-Z]{3}$/.test(caps.currency) ||
    !caps.budgetVersion?.trim()
  ) {
    throw new PronunciationBudgetError('BUDGET_NOT_APPROVED');
  }
  return caps as ApprovedPronunciationBudgetCaps;
}

export class PronunciationBudgetService {
  private readonly approved: ApprovedPronunciationBudgetCaps;

  constructor(
    private readonly store: PronunciationBudgetStore,
    caps: PronunciationBudgetCaps,
  ) {
    this.approved = approvedCaps(caps);
  }

  async reserve(
    input: Readonly<{
      reservationId: string;
      subjectId: string;
      estimatedCostMicros: number;
      currency: string;
      budgetVersion: string;
      at: Date;
    }>,
  ): Promise<PronunciationBudgetReservation> {
    if (
      !input.reservationId ||
      !input.subjectId ||
      !Number.isSafeInteger(input.estimatedCostMicros) ||
      input.estimatedCostMicros < 0 ||
      input.currency !== this.approved.currency ||
      input.budgetVersion !== this.approved.budgetVersion ||
      !Number.isFinite(input.at.getTime())
    ) {
      throw new PronunciationBudgetError('BUDGET_NOT_APPROVED');
    }
    const iso = input.at.toISOString();
    const reservation = Object.freeze({
      reservationId: input.reservationId,
      subjectHash: createHash('sha256')
        .update(`pronunciation-budget:${input.subjectId}`)
        .digest('hex'),
      day: iso.slice(0, 10),
      month: iso.slice(0, 7),
      reservedMicros: input.estimatedCostMicros,
      currency: input.currency,
      budgetVersion: input.budgetVersion,
    });
    const result = await this.store.reserve(reservation, this.approved);
    if (result === 'EXCEEDED') {
      throw new PronunciationBudgetError('BUDGET_EXCEEDED');
    }
    if (result === 'CONFLICT') {
      throw new PronunciationBudgetError('STATE_CONFLICT');
    }
    return reservation;
  }

  async settle(
    reservationId: string,
    actualCostMicros: number,
  ): Promise<'SETTLED' | 'REPLAYED'> {
    if (!Number.isSafeInteger(actualCostMicros) || actualCostMicros < 0) {
      throw new PronunciationBudgetError('STATE_CONFLICT');
    }
    const result = await this.store.settle(reservationId, actualCostMicros);
    if (result === 'NOT_FOUND' || result === 'CONFLICT') {
      throw new PronunciationBudgetError('STATE_CONFLICT');
    }
    return result === 'REPLAY' ? 'REPLAYED' : 'SETTLED';
  }

  release(reservationId: string): Promise<void> {
    return this.store.release(reservationId);
  }
}
