import { runRegisteredJest } from '../adapters/jest.adapter';
export { executeBusiness } from '../adapters/coach.adapter';

export async function runQuickCoach(
  serverRoot: string,
  runRoot: string,
  timeoutMs: number,
) {
  const results = [];
  for (const suiteId of ['coach-runtime', 'coach-executor'])
    results.push(
      await runRegisteredJest(suiteId, serverRoot, runRoot, timeoutMs),
    );
  return results;
}
