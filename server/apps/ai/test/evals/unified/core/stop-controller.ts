// All items share the parent deadline/signal. A stop prevents further dispatch;
// workers already admitted are awaited and own cancellation of their children.
export async function runBounded<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  execute: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32)
    throw Error('INVALID_CONCURRENCY');
  let cursor = 0;
  let failed = false;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (!signal.aborted && !failed) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          await execute(items[index]);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    },
  );
  const settled = await Promise.allSettled(workers);
  const failure = settled.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  if (failure) throw failure.reason;
}
