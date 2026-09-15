import { ItemResult } from '../contracts/run.schema';

export function compareCases(
  candidate: readonly ItemResult[],
  baseline: readonly ItemResult[],
) {
  const unique = (rows: readonly ItemResult[]) => {
    const map = new Map(rows.map((r) => [r.caseId, r]));
    if (map.size !== rows.length) throw Error('DUPLICATE_COMPARISON_CASE');
    return map;
  };
  const a = unique(candidate),
    b = unique(baseline);
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort();
  const missingPairs = ids.filter((id) => !a.has(id) || !b.has(id));
  const pairedCaseIds = ids.filter((id) => a.has(id) && b.has(id));
  const mismatches: string[] = [];
  for (const id of pairedCaseIds) {
    const left = a.get(id)!,
      right = b.get(id)!;
    if (left.declaredMode !== right.declaredMode) mismatches.push(`${id}:mode`);
    if (left.expectedRepeatCount !== right.expectedRepeatCount)
      mismatches.push(`${id}:repeat`);
    if (
      !['passed', 'failed'].includes(left.terminalState) ||
      !['passed', 'failed'].includes(right.terminalState)
    )
      mismatches.push(`${id}:observation_incomplete`);
    if (left.expectedRef?.hash !== right.expectedRef?.hash)
      mismatches.push(`${id}:gold`);
  }
  return {
    comparability:
      missingPairs.length || mismatches.length || !pairedCaseIds.length
        ? ('incomparable' as const)
        : ('comparable' as const),
    pairedCaseIds,
    missingPairs,
    mismatches,
  };
}

export function compareSnapshots(
  candidate: any,
  baseline: any,
  intentional: readonly string[],
) {
  const mismatches: string[] = [];
  for (const key of [
    'adapterVersion',
    'datasetHash',
    'goldHash',
    'splitHash',
    'exposureHash',
    'evaluatorHash',
    'rubricHash',
    'calibrationHash',
    'aggregationVersion',
  ])
    if (candidate.evaluation[key] !== baseline.evaluation[key])
      mismatches.push(`evaluation.${key}`);
  for (const key of [
    'node',
    'pnpm',
    'os',
    'arch',
    'workerVersion',
    'seed',
    'cache',
    'isolationFingerprint',
  ])
    if (candidate.runtime[key] !== baseline.runtime[key])
      mismatches.push(`runtime.${key}`);
  for (const key of new Set([
    ...Object.keys(candidate.runtime.limits ?? {}),
    ...Object.keys(baseline.runtime.limits ?? {}),
  ]))
    if (candidate.runtime.limits?.[key] !== baseline.runtime.limits?.[key])
      mismatches.push(`runtime.limits.${key}`);
  for (const group of ['ai', 'rag', 'pronunciation', 'mcp']) {
    for (const key of new Set([
      ...Object.keys(candidate[group]),
      ...Object.keys(baseline[group]),
    ])) {
      if (
        JSON.stringify(candidate[group][key]) !==
          JSON.stringify(baseline[group][key]) &&
        !intentional.includes(key)
      )
        mismatches.push(`${group}.${key}`);
    }
  }
  return mismatches;
}
