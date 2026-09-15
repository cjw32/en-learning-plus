import { executeAttempts } from '../core/attempt-lineage';
import { countResults } from '../core/counts';
import { result } from './test-support';
test('retries keep their parent and do not inflate independent repetitions or hide the first fault', async () => {
  const recorded: any[] = [];
  let calls = 0;
  const actual = await executeAttempts({
    itemId: 'item-1',
    repeatCount: 2,
    retryLimit: 1,
    signal: new AbortController().signal,
    execute: async () => {
      if (calls++ === 0) throw Error('offline');
      return { ...result, expectedRepeatCount: 2 } as any;
    },
    failure: () =>
      ({
        ...result,
        expectedRepeatCount: 2,
        terminalState: 'error',
        reasonCodes: ['DEPENDENCY_UNAVAILABLE'],
      }) as any,
    record: (r, lineage) => recorded.push(lineage),
  });
  expect(actual.terminalState).toBe('error');
  expect(recorded).toHaveLength(3);
  expect(recorded[1].parentAttemptId).toBe(recorded[0].attemptId);
  expect(countResults([actual as any])).toMatchObject({
    attempts: 3,
    repetitions: 2,
    uniqueCases: 1,
  });
});
test('a proven business failure is not retried', async () => {
  let calls = 0;
  const actual = await executeAttempts({
    itemId: 'item-1',
    repeatCount: 1,
    retryLimit: 3,
    signal: new AbortController().signal,
    execute: async () => {
      calls++;
      return {
        ...result,
        terminalState: 'failed',
        reasonCodes: ['CONTRACT_BREAK'],
      } as any;
    },
    failure: () => result as any,
    record: () => {},
  });
  expect(calls).toBe(1);
  expect(actual.terminalState).toBe('failed');
});
