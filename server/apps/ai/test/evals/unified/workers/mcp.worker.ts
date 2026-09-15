import { runRegisteredJest } from '../adapters/jest.adapter';
export { executeBusiness } from '../adapters/mcp.adapter';

export async function runQuickMcp(
  serverRoot: string,
  runRoot: string,
  timeoutMs: number,
) {
  const results: Awaited<ReturnType<typeof runRegisteredJest>>[] = [];
  for (const suiteId of ['mcp-protocol', 'mcp-pipeline'])
    results.push(
      await runRegisteredJest(suiteId, serverRoot, runRoot, timeoutMs),
    );
  return results;
}
