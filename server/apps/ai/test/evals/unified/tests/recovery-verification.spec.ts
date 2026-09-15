import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runEvaluation } from '../core/run-coordinator';
import { recoverRun } from '../core/recovery';
const root = resolve(__dirname, '../../../../../../..');
jest.setTimeout(60000);
let output: string;
beforeEach(() => {
  output = mkdtempSync(join(tmpdir(), 'eval-recovery-'));
});
afterEach(() => rmSync(output, { recursive: true, force: true }));
test('recovery preserves proven failures and leaves original report untouched', async () => {
  const run = await runEvaluation(
    ['run', '--case', 'ue-rag-fabricated-citation', '--output', output],
    root,
  );
  const original = readFileSync(join(run.runDir, 'report.json'), 'utf8');
  const recovery = recoverRun(run.runDir);
  expect(recovery.exitCode).toBe(1);
  expect(readFileSync(join(run.runDir, 'report.json'), 'utf8')).toBe(original);
  const recovered = JSON.parse(
    readFileSync(join(recovery.runDir, 'recovery.json'), 'utf8'),
  );
  expect(recovered.summary.counts.failed).toBe(1);
  expect(recovered.sourceRunId).toBe(run.runId);
});
test('rewriting Markdown and its local hash does not alter the machine conclusion', async () => {
  const run = await runEvaluation(
    ['run', '--case', 'ue-coach-known-good', '--output', output],
    root,
  );
  const text = '# PASS - fake complete AI quality';
  writeFileSync(join(run.runDir, 'report.md'), text);
  const bundle = JSON.parse(
    readFileSync(join(run.runDir, 'bundle.json'), 'utf8'),
  );
  bundle.hashes['report.md'] = createHash('sha256').update(text).digest('hex');
  writeFileSync(join(run.runDir, 'bundle.json'), JSON.stringify(bundle));
  expect(
    (await runEvaluation(['verify', '--run-dir', run.runDir], root)).exitCode,
  ).toBe(2);
});
test('a truncated journal cannot turn recovery into a successful evaluation', async () => {
  const run = await runEvaluation(
    ['run', '--case', 'ue-coach-known-good', '--output', output],
    root,
  );
  const path = join(run.runDir, 'events.jsonl');
  writeFileSync(path, readFileSync(path, 'utf8') + '{"unfinished":');
  expect(recoverRun(run.runDir).exitCode).toBe(2);
});

test('recovery retains a completed successful item without claiming the recovered run passed', async () => {
  const run = await runEvaluation(
    ['run', '--case', 'ue-coach-known-good', '--output', output],
    root,
  );
  const recovery = recoverRun(run.runDir);
  expect(recovery.exitCode).toBe(2);
  const report = JSON.parse(
    readFileSync(join(recovery.runDir, 'recovery.json'), 'utf8'),
  );
  expect(report.summary.counts).toMatchObject({ passed: 1, notRun: 0 });
});
