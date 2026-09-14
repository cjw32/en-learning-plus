import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { subject } from './test-support';
jest.setTimeout(30000);
const coordinator = subject('core/run-coordinator');
const root = resolve(__dirname, '../../../../../../..');
let output: string;
beforeEach(() => {
  output = mkdtempSync(join(tmpdir(), 'unified-quick-'));
});
afterEach(() => rmSync(output, { recursive: true, force: true }));
describe('T040 actual unified quick execution', () => {
  test('known-good and injected bad schema get different evidence-derived gates', async () => {
    const good = await coordinator.runEvaluation?.(
      [
        'run',
        '--modules',
        'coach',
        '--case',
        'ue-coach-known-good',
        '--output',
        output,
      ],
      root,
    );
    expect(good?.exitCode).toBe(0);
    const bad = await coordinator.runEvaluation?.(
      [
        'run',
        '--modules',
        'coach',
        '--case',
        'ue-coach-schema-regression',
        '--output',
        output,
      ],
      root,
    );
    expect(bad?.exitCode).toBe(1);
    const report = JSON.parse(
      readFileSync(join(bad.runDir, 'report.json'), 'utf8'),
    );
    expect(report.gate.status).toBe('FAIL');
    expect(report.cases[0].reasonCodes).toContain('CONTRACT_BREAK');
    expect(report.cases[0].actualRef).not.toEqual(report.cases[0].expectedRef);
  });
  test('unknown filter and required live modes missing return incomplete with diagnostics', async () => {
    const invalid = await coordinator.runEvaluation?.(
      ['run', '--case', 'nonexistent', '--output', output],
      root,
    );
    expect(invalid?.exitCode).toBe(2);
    const qualification = await coordinator.runEvaluation?.(
      [
        'run',
        '--modules',
        'coach',
        '--case',
        'ue-coach-known-good',
        '--purpose',
        'qualification',
        '--output',
        output,
      ],
      root,
    );
    expect(qualification?.exitCode).toBe(2);
  });
  test('verify detects a changed result file and never repeats business calls', async () => {
    const good = await coordinator.runEvaluation?.(
      ['run', '--case', 'ue-coach-known-good', '--output', output],
      root,
    );
    expect(good?.exitCode).toBe(0);
    expect(
      (
        await coordinator.runEvaluation?.(
          ['verify', '--run-dir', good.runDir],
          root,
        )
      )?.exitCode,
    ).toBe(0);
    require('node:fs').appendFileSync(
      join(good.runDir, 'results.jsonl'),
      '{}\n',
    );
    expect(
      (
        await coordinator.runEvaluation?.(
          ['verify', '--run-dir', good.runDir],
          root,
        )
      )?.exitCode,
    ).toBe(2);
  });
  test.each(['ue-rag-fabricated-citation', 'ue-mcp-wrong-tool'])(
    'actual %s boundary rejects the injected regression',
    async (caseId) => {
      const run = await coordinator.runEvaluation?.(
        ['run', '--case', caseId, '--output', output],
        root,
      );
      expect(run?.exitCode).toBe(1);
      expect(readFileSync(join(run.runDir, 'report.md'), 'utf8')).toMatch(
        /^# FAIL/,
      );
      expect(
        readFileSync(join(run.runDir, 'results.jsonl'), 'utf8')
          .trim()
          .startsWith('{'),
      ).toBe(true);
    },
  );
  test('repeated observations retain separate sealed attempts', async () => {
    const run = await coordinator.runEvaluation?.(
      [
        'run',
        '--case',
        'ue-coach-known-good',
        '--repeat',
        '2',
        '--output',
        output,
      ],
      root,
    );
    expect(run?.exitCode).toBe(0);
    const report = JSON.parse(
      readFileSync(join(run.runDir, 'report.json'), 'utf8'),
    );
    expect(report.cases[0].allAttempts).toHaveLength(2);
    require('node:fs').writeFileSync(
      join(run.runDir, 'attempts', report.cases[0].allAttempts[0] + '.json'),
      '{}',
    );
    expect(
      (
        await coordinator.runEvaluation?.(
          ['verify', '--run-dir', run.runDir],
          root,
        )
      )?.exitCode,
    ).toBe(2);
  });
});

test('verify rejects rewritten frozen fields even with refreshed local file hashes', async () => {
  const run = await coordinator.runEvaluation(
    ['run', '--case', 'ue-coach-known-good', '--output', output],
    root,
  );
  expect(run.exitCode).toBe(0);
  const fs = require('node:fs');
  const hash = (file: string) =>
    require('node:crypto')
      .createHash('sha256')
      .update(fs.readFileSync(file))
      .digest('hex');
  const report = JSON.parse(
    fs.readFileSync(join(run.runDir, 'report.json'), 'utf8'),
  );
  report.cases[0].required = false;
  fs.writeFileSync(
    join(run.runDir, 'report.json'),
    JSON.stringify(report) + '\n',
  );
  fs.writeFileSync(
    join(run.runDir, 'results.jsonl'),
    report.cases.map((x) => JSON.stringify(x)).join('\n') + '\n',
  );
  const bundle = JSON.parse(
    fs.readFileSync(join(run.runDir, 'bundle.json'), 'utf8'),
  );
  for (const name of ['report.json', 'results.jsonl'])
    bundle.hashes[name] = hash(join(run.runDir, name));
  fs.writeFileSync(join(run.runDir, 'bundle.json'), JSON.stringify(bundle));
  expect(
    (await coordinator.runEvaluation(['verify', '--run-dir', run.runDir], root))
      .exitCode,
  ).toBe(2);
});

test('a caller cannot replace the running control implementation through control-root', async () => {
  const run = await coordinator.runEvaluation(
    ['inspect', '--control-root', output, '--output', output],
    root,
  );
  expect(run.exitCode).toBe(2);
  expect(run.diagnostic).toBe('CONTROL_ROOT_MISMATCH');
});
