import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Redis from 'ioredis';
import { RedisPronunciationBudgetStore } from '../../src/pronunciation/governance/redis-pronunciation-budget.store';
import { PronunciationBudgetService } from '../../src/pronunciation/governance/pronunciation-budget.service';
import { PronunciationSubmitAdmissionService } from '../../src/pronunciation/governance/pronunciation-submit-admission';
import { PronunciationUsageService } from '../../src/pronunciation/governance/pronunciation-usage.service';

// Explicit opt-in starts an isolated, non-persistent Redis over a private Unix socket.
const suite = process.env.PRONUNCIATION_TEST_REDIS_BINARY
  ? describe
  : describe.skip;
suite('production Redis scripts against an isolated Redis process', () => {
  let directory: string;
  let processHandle: ChildProcess;
  let client: Redis;
  it('limits zero-cost audio, retains spent duration, and refunds only unsent reservations', async () => {
    const usage = new PronunciationUsageService(client, 'free-test', { subjectDaySeconds: 4, daySeconds: 10, monthSeconds: 10 });
    await usage.reserve('first', 'owner', 1100);
    await usage.reserve('first', 'owner', 1100);
    await expect(usage.reserve('parallel', 'other', 1000)).rejects.toMatchObject({ code: 'CONCURRENCY_LIMITED' });
    await usage.release('first');
    await usage.release('first');
    await usage.reserve('second', 'owner', 3000);
    await usage.spend('second');
    await usage.release('second');
    await usage.complete('second');
    await expect(usage.reserve('third', 'owner', 2000)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    await usage.reserve('fourth', 'other', 1000);
    await usage.complete('old-owner');
    await expect(usage.reserve('fifth', 'third-owner', 1000)).rejects.toMatchObject({ code: 'CONCURRENCY_LIMITED' });
    await usage.spend('fourth');
    await expect(usage.reserve('fifth', 'third-owner', 1000)).rejects.toMatchObject({ code: 'CONCURRENCY_LIMITED' });
    await usage.complete('fourth');
  });
  it('enforces month budget across days and serializes concurrent claims', async () => {
    const usage = new PronunciationUsageService(client, 'month-test', { subjectDaySeconds: 100, daySeconds: 100, monthSeconds: 3 });
    const results = await Promise.allSettled(Array.from({length: 8}, (_, i) => usage.reserve(`parallel-${i}`, `owner-${i}`, 2000, new Date('2026-09-01T00:00:00Z'))));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.findIndex(r => r.status === 'fulfilled');
    await usage.spend(`parallel-${winner}`); await usage.complete(`parallel-${winner}`);
    await expect(usage.reserve('next-day', 'new-owner', 2000, new Date('2026-09-02T00:00:00Z'))).rejects.toMatchObject({code:'BUDGET_EXCEEDED'});
    await usage.reserve('next-month', 'new-owner', 2000, new Date('2026-10-01T00:00:00Z'));
  });
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pron-redis-'));
    processHandle = spawn(
      process.env.PRONUNCIATION_TEST_REDIS_BINARY!,
      [
        '--port',
        '0',
        '--unixsocket',
        join(directory, 'redis.sock'),
        '--unixsocketperm',
        '700',
        '--save',
        '',
        '--appendonly',
        'no',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Local test Redis startup timed out')),
        5000,
      );
      processHandle.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      processHandle.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Local test Redis stopped'));
      });
      processHandle.stdout!.on('data', (chunk) => {
        if (
          String(chunk).includes('ready to accept connections') ||
          String(chunk).includes('Ready to accept connections')
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    client = new Redis({
      path: join(directory, 'redis.sock'),
      maxRetriesPerRequest: 0,
    });
    await client.ping();
  });
  beforeEach(async () => {
    await client.flushdb();
  }); // Only the process created above, never a configured service.
  afterAll(async () => {
    client?.disconnect();
    processHandle?.kill('SIGTERM');
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('atomically admits one concurrent reservation, replays, settles and releases', async () => {
    const store = new RedisPronunciationBudgetStore(client);
    const budget = new PronunciationBudgetService(store, {
      currency: 'USD',
      budgetVersion: 'v1',
      maxCallCostMicros: 100,
      subjectDailyBudgetMicros: 100,
      systemDailyBudgetMicros: 100,
      systemMonthlyBudgetMicros: 100,
    });
    const input = {
      subjectId: 'owner',
      estimatedCostMicros: 70,
      currency: 'USD',
      budgetVersion: 'v1',
      at: new Date('2026-09-14T00:00:00Z'),
    };
    const results = await Promise.allSettled([
      budget.reserve({ ...input, reservationId: 'a' }),
      budget.reserve({ ...input, reservationId: 'b' }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const accepted = results.find(
      (result) => result.status === 'fulfilled',
    ) as PromiseFulfilledResult<Awaited<ReturnType<typeof budget.reserve>>>;
    const id = accepted.value.reservationId;
    await expect(
      budget.reserve({ ...input, reservationId: id }),
    ).resolves.toMatchObject({ reservationId: id });
    await expect(budget.settle(id, 20)).resolves.toBe('SETTLED');
    await expect(budget.settle(id, 20)).resolves.toBe('REPLAYED');
    await expect(budget.settle(id, 30)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    await budget.reserve({ ...input, reservationId: 'c' });
    await budget.release('c');
    await budget.release('c');
    await expect(
      budget.reserve({ ...input, reservationId: 'd' }),
    ).resolves.toBeDefined();
  });
  it('counts a submission once, preserves another assessment lease, and enforces rate limits', async () => {
    const admission = new PronunciationSubmitAdmissionService({
      assertReady: () => client.ping(),
      getAtomicClient: () => client,
    } as never);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        admission.assertCanSubmit('owner', 'one'),
      ),
    );
    await admission.release('owner', 'wrong');
    await expect(
      admission.assertCanSubmit('owner', 'two'),
    ).rejects.toMatchObject({ code: 'CONCURRENCY_LIMITED' });
    await admission.release('owner', 'one');
    for (let i = 0; i < 5; i++) {
      await admission.assertCanSubmit('owner', String(i));
      await admission.release('owner', String(i));
    }
    await expect(
      admission.assertCanSubmit('owner', 'seventh'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      admission.assertCanSubmit('other-owner', 'fresh'),
    ).resolves.toBeUndefined();
  });
});
