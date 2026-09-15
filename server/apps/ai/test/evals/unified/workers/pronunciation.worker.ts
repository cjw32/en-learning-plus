import { runRegisteredJest } from '../adapters/jest.adapter';
export { executeBusiness } from '../adapters/pronunciation.adapter';

export async function runQuickPronunciation(
  serverRoot: string,
  runRoot: string,
  timeoutMs: number,
) {
  const results: Awaited<ReturnType<typeof runRegisteredJest>>[] = [];
  for (const suiteId of [
    'pronunciation-alignment',
    'pronunciation-application',
  ])
    results.push(
      await runRegisteredJest(suiteId, serverRoot, runRoot, timeoutMs),
    );
  return results;
}
