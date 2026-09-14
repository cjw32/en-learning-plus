import { ItemResult, itemResultSchema } from '../contracts/run.schema';
import { countsSchema } from '../contracts/report.schema';

export function countResults(input: readonly ItemResult[]) {
  const results = input.map((value) => itemResultSchema.parse(value));
  if (new Set(results.map((r) => r.itemId)).size !== results.length)
    throw Error('DUPLICATE_ITEM');
  const count = (state: string) =>
    results.filter((r) => r.terminalState === state).length;
  return countsSchema.parse({
    planned: results.length,
    completed: count('passed') + count('failed') + count('review'),
    passed: count('passed'),
    failed: count('failed'),
    review: count('review'),
    skipped: count('skipped'),
    error: count('error'),
    notRun: count('not_run'),
    uniqueCases: new Set(results.map((r) => r.caseId)).size,
    attempts: results.reduce((n, r) => n + r.allAttempts.length, 0),
    repetitions: results.reduce(
      (n, r) => n + Math.min(r.expectedRepeatCount, r.allAttempts.length),
      0,
    ),
  });
}
