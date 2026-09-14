import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { subject, item, result } from './test-support';

const api = subject('workers/worker-host');
const protocol = subject('contracts/worker.schema');
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'unified-worker-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function runner(body: string, mode = 'mock') {
  const code = `process.on('message', message => { ${body} });`;
  writeFileSync(join(root, 'controlled.cjs'), code);
  const registry = {
    synthetic: {
      engine: 'node',
      controlRoot: root,
      entry: {
        path: 'controlled.cjs',
        hash: createHash('sha256').update(code).digest('hex'),
      },
    },
  };
  return (
    api.createWorkerHost?.({
      registry,
      runRoot: root,
      serverRoot: resolve(__dirname, '../../../../../..'),
      environment: {
        PATH: process.env.PATH,
        API_KEY: 'must-not-inherit',
        NODE_OPTIONS: '--bad-injection',
      },
      profile: 'quick',
      reserve: () => {
        throw Error('BUDGET_STOPPED');
      },
    }) ?? {
      execute: async () => {
        throw Error('UNIMPLEMENTED_WORKER');
      },
    }
  );
}

describe('T017 actual isolated worker boundary', () => {
  test('rejects arbitrary message types, keys and unregistered worker names', async () => {
    expect(
      protocol.workerMessageSchema?.safeParse({
        type: 'shell',
        command: 'unexpected',
      }).success,
    ).toBe(false);
    const host = runner('');
    await expect(
      host?.execute('arbitrary', item, { timeoutMs: 1000 }),
    ).rejects.toThrow('UNREGISTERED_WORKER');
  });
  test('actual child sees sanitized env and no dotenv, returns bound result', async () => {
    const output = JSON.stringify(result);
    const host =
      runner(`if (process.env.API_KEY || process.env.NODE_OPTIONS || require('fs').existsSync('.env')) process.exit(8);
      process.send({type:'result', itemId: message.item.itemId, result:${output}}); process.disconnect();`);
    expect(await host?.execute('synthetic', item, { timeoutMs: 3000 })).toEqual(
      result,
    );
  });
  test('does not accept a valid result belonging to a different item', async () => {
    const host = runner(
      `process.send({type:'result', itemId:'wrong', result:${JSON.stringify(result)}});`,
    );
    await expect(
      host?.execute('synthetic', item, { timeoutMs: 3000 }),
    ).rejects.toThrow('WORKER_MESSAGE_INVALID');
  });
  test('timeout stops an actual hanging child and forbids post-stop dispatch', async () => {
    const host = runner('setInterval(() => {}, 1000);');
    const start = Date.now();
    await expect(
      host?.execute('synthetic', item, { timeoutMs: 150 }),
    ).rejects.toThrow('TIMEOUT');
    expect(Date.now() - start).toBeLessThan(3000);
  });
  test('quick denies an actual child requesting an external call', async () => {
    const host =
      runner(`process.send({type:'reserve', itemId:message.item.itemId, call:{callId:'c1', itemId:message.item.itemId,
      attemptId:'a1', purpose:'candidate', provider:'synthetic', priceVersion:'1', currency:'USD', upperBoundMicros:1}});`);
    await expect(
      host?.execute('synthetic', item, { timeoutMs: 3000 }),
    ).rejects.toThrow('BUDGET_STOPPED');
  });
  test('verifies registered entry hash before creating the child', async () => {
    const host = runner('');
    writeFileSync(join(root, 'controlled.cjs'), 'process.exit(0)');
    await expect(
      host?.execute('synthetic', item, { timeoutMs: 1000 }),
    ).rejects.toThrow('WORKER_ENTRY_CHANGED');
  });
  test('rejects malformed time limit and resultless successful process exit', async () => {
    const host = runner('process.exit(0);');
    await expect(
      host?.execute('synthetic', item, { timeoutMs: Infinity }),
    ).rejects.toThrow('INVALID_TIMEOUT');
    await expect(
      host?.execute('synthetic', item, { timeoutMs: 3000 }),
    ).rejects.toThrow('WORKER_NO_RESULT');
  });
});

test('IPC payloads share the output byte limit, before expensive schema validation', async () => {
  const huge = {
    ...result,
    steps: Array.from({ length: 10000 }, () => ({ padding: 'x'.repeat(256) })),
  };
  const host = runner(
    `process.send({type:'result', itemId:message.item.itemId, result:${JSON.stringify(huge)}});`,
  );
  await expect(
    host.execute('synthetic', item, { timeoutMs: 3000 }),
  ).rejects.toThrow('WORKER_OUTPUT_LIMIT');
});
