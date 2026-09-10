export type PronunciationCostReportCall = Readonly<{
  callId: string;
  subjectHash: string;
  day: string;
  month: string;
  provider: string;
  region: string;
  capability: 'BASE' | 'PROSODY';
  modelVersion: string;
  priceVersion: string;
  budgetVersion: string;
  priceApproved: boolean;
  actualCostMicros: number;
  potentialCostMicros: number;
}>;

type Caps = Readonly<{
  maxCallCostMicros: number;
  subjectDailyBudgetMicros: number;
  systemDailyBudgetMicros: number;
  systemMonthlyBudgetMicros: number;
}>;

function add(target: Record<string, number>, key: string, value: number): void {
  target[key] = (target[key] ?? 0) + value;
}

export function buildPronunciationCostReport(
  input: Readonly<{
    calls: readonly PronunciationCostReportCall[];
    settlements: readonly Readonly<{
      callId: string;
      accountedMicros: number;
    }>[];
    caps: Caps;
  }>,
) {
  const settlementByCall = new Map(
    input.settlements.map((settlement) => [settlement.callId, settlement]),
  );
  const blockers: string[] = [];
  const unreconciledCallIds: string[] = [];
  const subjectDay: Record<string, number> = {};
  const systemDay: Record<string, number> = {};
  const systemMonth: Record<string, number> = {};
  const groups = new Map<
    string,
    {
      provider: string;
      region: string;
      capability: 'BASE' | 'PROSODY';
      modelVersion: string;
      priceVersion: string;
      callCount: number;
      actualCostMicros: number;
      potentialCostMicros: number;
    }
  >();

  for (const call of [...input.calls].sort((left, right) =>
    left.callId.localeCompare(right.callId),
  )) {
    const accounted = call.actualCostMicros + call.potentialCostMicros;
    if (
      !call.priceApproved ||
      !call.priceVersion ||
      call.priceVersion === 'unknown'
    ) {
      blockers.push(`UNAPPROVED_PRICE:${call.callId}`);
    }
    const settlement = settlementByCall.get(call.callId);
    if (!settlement || settlement.accountedMicros !== accounted) {
      unreconciledCallIds.push(call.callId);
      blockers.push(`UNRECONCILED_CALL:${call.callId}`);
    }
    if (accounted > input.caps.maxCallCostMicros) {
      blockers.push(`CALL_BUDGET_EXCEEDED:${call.callId}`);
    }
    add(subjectDay, `${call.subjectHash}:${call.day}`, accounted);
    add(systemDay, call.day, accounted);
    add(systemMonth, call.month, accounted);

    const key = [
      call.provider,
      call.region,
      call.capability,
      call.modelVersion,
      call.priceVersion,
    ].join('|');
    const group = groups.get(key) ?? {
      provider: call.provider,
      region: call.region,
      capability: call.capability,
      modelVersion: call.modelVersion,
      priceVersion: call.priceVersion,
      callCount: 0,
      actualCostMicros: 0,
      potentialCostMicros: 0,
    };
    group.callCount += 1;
    group.actualCostMicros += call.actualCostMicros;
    group.potentialCostMicros += call.potentialCostMicros;
    groups.set(key, group);
  }

  for (const [key, value] of Object.entries(subjectDay)) {
    if (value > input.caps.subjectDailyBudgetMicros) {
      blockers.push(`SUBJECT_DAY_BUDGET_EXCEEDED:${key}`);
    }
  }
  for (const [key, value] of Object.entries(systemDay)) {
    if (value > input.caps.systemDailyBudgetMicros) {
      blockers.push(`SYSTEM_DAY_BUDGET_EXCEEDED:${key}`);
    }
  }
  for (const [key, value] of Object.entries(systemMonth)) {
    if (value > input.caps.systemMonthlyBudgetMicros) {
      blockers.push(`SYSTEM_MONTH_BUDGET_EXCEEDED:${key}`);
    }
  }

  return Object.freeze({
    schemaVersion: 'pronunciation-cost-report.v1',
    callCount: input.calls.length,
    reconciledCallCount: input.calls.length - unreconciledCallIds.length,
    unreconciledCallIds: Object.freeze(unreconciledCallIds),
    totalActualCostMicros: input.calls.reduce(
      (sum, call) => sum + call.actualCostMicros,
      0,
    ),
    totalPotentialCostMicros: input.calls.reduce(
      (sum, call) => sum + call.potentialCostMicros,
      0,
    ),
    groups: Object.freeze(
      [...groups.values()]
        .sort((left, right) =>
          `${left.provider}|${left.region}|${left.capability}`.localeCompare(
            `${right.provider}|${right.region}|${right.capability}`,
          ),
        )
        .map((group) => Object.freeze(group)),
    ),
    budgetEvidence: Object.freeze({
      perCallCapMicros: input.caps.maxCallCostMicros,
      subjectDay: Object.freeze(subjectDay),
      systemDay: Object.freeze(systemDay),
      systemMonth: Object.freeze(systemMonth),
    }),
    blockers: Object.freeze(blockers),
    passed: blockers.length === 0,
  });
}
