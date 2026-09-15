import { ItemResult } from '../contracts/run.schema';
import { metricSchema } from '../contracts/report.schema';
import type { EvaluationCase } from '../contracts/case.schema';

// These are observed check pass rates, never model-quality scores. Missing
// observations are enumerated and excluded, not silently counted as successes.
export function groupMetrics(
  items: readonly ItemResult[],
  catalog: readonly EvaluationCase[] = [],
) {
  const groups = new Map<
    string,
    {
      items: ItemResult[];
      group: Record<
        string,
        { value: string | null; unavailableReason: string | null }
      >;
      kind: string;
    }
  >();
  for (const item of items) {
    const kind =
      item.caseId.startsWith('suite:') || item.caseId.startsWith('ue-')
        ? 'business_pass_rate'
        : 'fixture_validity_rate';
    const source = catalog.find((c) => c.caseId === item.caseId);
    const dimensions: Record<
      string,
      { value: string | null; unavailableReason: string | null }
    >[] = [{}];
    if (source) {
      dimensions.push({
        risk: { value: source.risk, unavailableReason: null },
      });
      for (const [key, value] of Object.entries(source.groups))
        dimensions.push({ [key]: value });
    }
    for (const group of dimensions) {
      const key = JSON.stringify([
        item.module,
        item.declaredMode,
        item.side,
        kind,
        group,
      ]);
      if (!groups.has(key)) groups.set(key, { items: [], group, kind });
      groups.get(key)!.items.push(item);
    }
  }
  return [...groups.values()].map(({ items: rows, group, kind }) => {
    const measured = rows.filter((r) =>
      ['passed', 'failed'].includes(r.terminalState),
    );
    const passed = measured.filter((r) => r.terminalState === 'passed').length;
    const excluded: Record<string, number> = {};
    for (const row of rows.filter((r) => !measured.includes(r)))
      excluded[row.terminalState] = (excluded[row.terminalState] ?? 0) + 1;
    const clusters = new Set(
      measured.map(
        (r) =>
          catalog.find((c) => c.caseId === r.caseId)?.exposure.groupId ??
          r.caseId,
      ),
    );
    return metricSchema.parse({
      metricId: kind,
      version: 'controlled-check-metric.v1',
      module: rows[0].module,
      group,
      side: rows[0].side,
      mode: rows[0].declaredMode,
      unit: 'ratio',
      direction: 'higher',
      value: measured.length ? passed / measured.length : null,
      unavailableReason: measured.length ? null : 'NO_COMPLETED_OBSERVATIONS',
      numerator: passed,
      denominator: measured.length,
      effectiveN: measured.length,
      independentN: clusters.size,
      excludedCountsByReason: excluded,
      calculationBasis:
        'one_frozen_case_one_observation; retries_do_not_increase_N',
      repetitionSummary: null,
      uncertainty: null,
      thresholdRef: null,
      comparisonDelta: null,
    });
  });
}
