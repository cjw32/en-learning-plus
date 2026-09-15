import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { reportSchema } from '../contracts/report.schema';
import { safePath } from './control-loader';
import { verifyBundle } from './verify';
import { compareCases, compareSnapshots } from './comparability';

// A verified local report is a historical observation, not an approved baseline.
export function loadHistoricalRun(directory: string) {
  const root = realpathSync(directory);
  const verified = verifyBundle(root);
  if ('diagnostic' in verified) throw Error('BASELINE_EVIDENCE_INVALID');
  const text = readFileSync(safePath(root, 'report.json'), 'utf8');
  const bundle = JSON.parse(
    readFileSync(safePath(root, 'bundle.json'), 'utf8'),
  );
  const hash = createHash('sha256').update(text).digest('hex');
  if (bundle.hashes['report.json'] !== hash) throw Error('BASELINE_CHANGED');
  return { report: reportSchema.parse(JSON.parse(text)), hash };
}
export function historicalComparison(
  candidateId: string,
  snapshot: any,
  cases: any[],
  baseline: ReturnType<typeof loadHistoricalRun>['report'],
  intentional: string[],
) {
  const pairs = compareCases(cases, baseline.cases);
  const mismatches = [
    ...pairs.mismatches,
    ...compareSnapshots(snapshot, baseline.versions.candidate, intentional),
  ];
  return {
    candidateId,
    baselineId: baseline.run.id,
    intentionalDifferences: intentional,
    matchedConditions: mismatches.length
      ? []
      : ['dataset', 'gold', 'evaluators', 'runtime', 'modes'],
    mismatches,
    comparability:
      pairs.comparability === 'comparable' && !mismatches.length
        ? ('comparable' as const)
        : ('incomparable' as const),
    pairedCaseIds: pairs.pairedCaseIds,
    missingPairs: pairs.missingPairs,
  };
}
