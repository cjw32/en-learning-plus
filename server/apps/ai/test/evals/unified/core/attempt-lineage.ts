import { ItemResult } from '../contracts/run.schema';
export type AttemptLineage = {
  attemptId: string;
  repeatIndex: number;
  retryIndex: number;
  parentAttemptId: string | null;
};
// Retries are limited to offline execution faults. A proven failed assertion is
// never retried, and an earlier fault stays visible even if the retry succeeds.
export async function executeAttempts(input: {
  repeatCount: number;
  retryLimit: number;
  signal: AbortSignal;
  itemId: string;
  execute: (repeat: number, retry: number) => Promise<ItemResult>;
  failure: (error: unknown) => ItemResult;
  record: (result: ItemResult, lineage: AttemptLineage) => void;
}) {
  const observations: ItemResult[] = [];
  const lineage: AttemptLineage[] = [];
  for (let repeat = 0; repeat < input.repeatCount; repeat++) {
    let parent: string | null = null;
    for (let retry = 0; retry <= input.retryLimit; retry++) {
      if (input.signal.aborted) break;
      let result: ItemResult;
      try {
        result = await input.execute(repeat, retry);
      } catch (error) {
        result = input.failure(error);
      }
      const entry = {
        attemptId: `attempt-${input.itemId}-r${repeat}-t${retry}`,
        repeatIndex: repeat,
        retryIndex: retry,
        parentAttemptId: parent,
      };
      result = { ...result, allAttempts: [entry.attemptId] };
      input.record(result, entry);
      observations.push(result);
      lineage.push(entry);
      parent = entry.attemptId;
      const retryable =
        result.terminalState === 'error' &&
        result.reasonCodes.every((c) =>
          ['WORKER_CRASH', 'DEPENDENCY_UNAVAILABLE', 'TIMEOUT'].includes(c),
        );
      if (!retryable || input.signal.aborted) break;
    }
    if (input.signal.aborted) break;
  }
  const chosen =
    observations.find((a) => a.terminalState === 'failed') ??
    observations.find((a) => a.terminalState !== 'passed') ??
    observations[0] ??
    input.failure(Error('CANCELLED'));
  return {
    ...chosen,
    allAttempts: observations.flatMap((a) => a.allAttempts),
    attemptLineage: lineage,
    steps: observations.flatMap((a) => a.steps),
    evidenceRefs: observations.flatMap((a) => a.evidenceRefs),
  };
}
