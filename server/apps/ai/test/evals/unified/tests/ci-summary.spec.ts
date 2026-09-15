import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runEvaluation } from '../core/run-coordinator';
import { summarizeCi } from '../core/ci-summary';
const root = resolve(__dirname, '../../../../../../..');
jest.setTimeout(30000);
test('CI cannot hide a proven failure behind a missing job or a changed scope', async () => {
  const output = mkdtempSync(join(tmpdir(), 'eval-ci-'));
  try {
    const run = await runEvaluation(
      ['run', '--case', 'ue-coach-schema-regression', '--output', output],
      root,
    );
    const report = JSON.parse(
      readFileSync(join(run.runDir, 'report.json'), 'utf8'),
    );
    const check = {
      checkId: 'coach',
      runDir: run.runDir,
      candidateTreeHash: report.versions.candidate.code.candidateTreeHash,
      controlHash: report.control.controlHash,
      scopeClaim: report.scope.scopeClaim,
    };
    expect(
      summarizeCi([
        check,
        { ...check, checkId: 'missing', runDir: join(output, 'missing') },
      ]).gate,
    ).toBe('FAIL');
    expect(
      summarizeCi([{ ...check, scopeClaim: 'full/qualification:all' }]).gate,
    ).toBe('INCOMPLETE');
    expect(() => summarizeCi([])).toThrow();
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
