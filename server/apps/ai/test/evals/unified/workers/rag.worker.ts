import { runRegisteredJest } from '../adapters/jest.adapter';
export { executeBusiness } from '../adapters/rag.adapter';

export async function runQuickRag(
  serverRoot: string,
  runRoot: string,
  timeoutMs: number,
) {
  const results: Awaited<ReturnType<typeof runRegisteredJest>>[] = [];
  for (const suiteId of ['rag-search'])
    results.push(
      await runRegisteredJest(suiteId, serverRoot, runRoot, timeoutMs),
    );
  return results;
}
