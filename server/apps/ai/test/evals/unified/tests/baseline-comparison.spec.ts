import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runEvaluation } from '../core/run-coordinator';
import { compareSnapshots } from '../core/comparability';
const root = resolve(__dirname, '../../../../../../..');
jest.setTimeout(60000);
test('same-scope historical comparison is read-only and verifies independently', async () => {
  const output = mkdtempSync(join(tmpdir(), 'eval-compare-'));
  try {
    const argv = ['run', '--case', 'ue-coach-known-good', '--output', output];
    const first = await runEvaluation(argv, root);
    expect(first.exitCode).toBe(0);
    const original = readFileSync(join(first.runDir, 'report.json'), 'utf8');
    const second = await runEvaluation(
      [...argv, '--baseline', first.runDir],
      root,
    );
    expect(second.exitCode).toBe(0);
    const report = JSON.parse(
      readFileSync(join(second.runDir, 'report.json'), 'utf8'),
    );
    expect(report.comparison.comparability).toBe('comparable');
    expect(report.metrics[0].comparisonDelta).toBe(0);
    expect(readFileSync(join(first.runDir, 'report.json'), 'utf8')).toBe(
      original,
    );
    expect(
      (await runEvaluation(['verify', '--run-dir', second.runDir], root))
        .exitCode,
    ).toBe(0);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
test('dataset changes cannot be waived as an intentional model change', () => {
  const a: any = {
    evaluation: { datasetHash: 'a' },
    runtime: {},
    ai: { model: { value: 'old' } },
    rag: {},
    pronunciation: {},
    mcp: {},
  };
  const b = {
    ...a,
    evaluation: { datasetHash: 'b' },
    ai: { model: { value: 'new' } },
  };
  expect(compareSnapshots(a, b, ['model'])).toEqual(['evaluation.datasetHash']);
});

test.each(['concurrency', 'caseTimeoutMs', 'retryLimit', 'runTimeoutMs'])('different %s limits cannot claim a comparable baseline', (key) => {
  const a = { evaluation: {}, runtime: { limits: { [key]: 1 } }, ai: {}, rag: {}, pronunciation: {}, mcp: {} };
  const b = { ...a, runtime: { limits: { [key]: 2 } } };
  expect(compareSnapshots(a, b, [key])).toEqual([`runtime.limits.${key}`]);
});
