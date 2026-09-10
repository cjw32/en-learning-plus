import {
  PronunciationBudgetService,
  type PronunciationBudgetReservation,
} from './pronunciation-budget.service';
import {
  PronunciationPriceCatalog,
  type PronunciationRegionalPrice,
} from './pronunciation-price.catalog';

export type PronunciationCostReservation = Readonly<{
  budget: PronunciationBudgetReservation;
  price: PronunciationRegionalPrice;
  estimatedCostMicros: number;
}>;

export type PronunciationCostSettlement = Readonly<{
  status: 'SETTLED' | 'REPLAYED' | 'POTENTIALLY_BILLABLE';
  actualCostMicros: number;
  potentialCostMicros: number;
}>;

/**
 * Pins the exact approved regional price at reservation time and delegates the
 * four-cap accounting to the atomic budget store. The pinned price prevents a
 * price-catalog change from altering settlement for an in-flight call.
 */
export class PronunciationCostMeter {
  constructor(
    private readonly prices: PronunciationPriceCatalog,
    private readonly budgets: PronunciationBudgetService,
  ) {}

  async reserve(
    input: Readonly<{
      reservationId: string;
      subjectId: string;
      provider: string;
      modelVersion: string;
      region: string;
      capability: 'BASE' | 'PROSODY';
      currency: string;
      priceVersion: string;
      budgetVersion: string;
      estimatedDurationMs: number;
      at: Date;
    }>,
  ): Promise<PronunciationCostReservation> {
    const price = this.prices.resolve(input);
    const estimatedCostMicros = this.prices.estimateMicros(
      price,
      input.estimatedDurationMs,
    );
    const budget = await this.budgets.reserve({
      reservationId: input.reservationId,
      subjectId: input.subjectId,
      estimatedCostMicros,
      currency: input.currency,
      budgetVersion: input.budgetVersion,
      at: input.at,
    });
    return Object.freeze({ budget, price, estimatedCostMicros });
  }

  async settle(
    reservation: PronunciationCostReservation,
    actualDurationMs: number,
    providerAccepted: boolean | null,
  ): Promise<PronunciationCostSettlement> {
    if (providerAccepted === null) {
      return this.markUnknownAcceptance(reservation);
    }
    if (providerAccepted === false) {
      await this.budgets.release(reservation.budget.reservationId);
      return Object.freeze({
        status: 'SETTLED' as const,
        actualCostMicros: 0,
        potentialCostMicros: 0,
      });
    }
    const actualCostMicros = this.prices.estimateMicros(
      reservation.price,
      actualDurationMs,
    );
    const status = await this.budgets.settle(
      reservation.budget.reservationId,
      actualCostMicros,
    );
    return Object.freeze({
      status,
      actualCostMicros,
      potentialCostMicros: 0,
    });
  }

  markUnknownAcceptance(
    reservation: PronunciationCostReservation,
  ): PronunciationCostSettlement {
    return Object.freeze({
      status: 'POTENTIALLY_BILLABLE' as const,
      actualCostMicros: 0,
      potentialCostMicros: reservation.estimatedCostMicros,
    });
  }
}
