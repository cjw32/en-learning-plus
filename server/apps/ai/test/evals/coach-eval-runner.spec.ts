import { resolve } from 'node:path';
import { loadEvalCases } from './deterministic-assertions';
import { runMockEvaluation } from './run';
import { evaluateReleaseGate } from './release-gate';
import { linkEvalTrace } from './trace-linker';

const cases = loadEvalCases(resolve(__dirname, 'fixtures/cases.jsonl'));

describe('Coach evaluation runner and release gate', () => {
  it('produces identical machine-readable mock reports for the same versions', async () => {
    const options = {
      datasetVersion: 'coach-eval-dataset.v1',
      promptVersion: 'coach-prompts.v1',
      modelVersion: 'mock-v1',
      schemaVersion: 'coach.result.v1',
      priceVersion: 'price-pending-v1',
      generatedAt: '2026-09-02T00:00:00.000Z',
    } as const;
    const first = await runMockEvaluation(cases, options);
    const second = await runMockEvaluation(cases, options);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      mode: 'mock',
      versions: options,
      totals: { cases: 60, deterministicFailures: 0, securityFailures: 0 },
      measurements: {
        ttftMs: expect.any(Object),
        totalDurationMs: expect.any(Object),
        inputTokens: expect.any(Object),
        outputTokens: expect.any(Object),
        estimatedCostMicros: expect.any(Object),
      },
    });
  });

  it('keeps release blocked while measured baseline and budget approval are pending', async () => {
    const report = await runMockEvaluation(cases, {
      datasetVersion: 'coach-eval-dataset.v1',
      promptVersion: 'coach-prompts.v1',
      modelVersion: 'mock-v1',
      schemaVersion: 'coach.result.v1',
      priceVersion: 'price-pending-v1',
      generatedAt: '2026-09-02T00:00:00.000Z',
    });
    const gate = evaluateReleaseGate({
      report,
      baseline: {
        status: 'pending_measurement',
        approved: false,
        datasetVersion: 'coach-eval-dataset.v1',
      },
      budget: { status: 'pending_measurement', approved: false },
    });
    expect(gate.allowed).toBe(false);
    expect(gate.failures).toEqual(
      expect.arrayContaining(['baseline_not_approved', 'budget_not_approved']),
    );
  });

  it.each([
    ['security', { securityFailures: 1 }],
    ['deterministic', { deterministicFailures: 1 }],
  ] as const)('blocks an injected %s regression', async (_name, totals) => {
    const report = await runMockEvaluation(cases, {
      datasetVersion: 'coach-eval-dataset.v1',
      promptVersion: 'coach-prompts.v1',
      modelVersion: 'candidate-v1',
      schemaVersion: 'coach.result.v1',
      priceVersion: 'price-v1',
      generatedAt: '2026-09-02T00:00:00.000Z',
    });
    const gate = evaluateReleaseGate({
      report: { ...report, totals: { ...report.totals, ...totals } },
      baseline: {
        status: 'approved',
        approved: true,
        datasetVersion: 'coach-eval-dataset.v1',
        modelVersion: 'candidate-v1',
        minimumQualityPassRate: 0.9,
      },
      budget: {
        status: 'approved',
        approved: true,
        maxP95TtftMs: 2_000,
        maxP95TotalDurationMs: 10_000,
        maxP95CostMicros: 10_000,
      },
    });
    expect(gate.allowed).toBe(false);
  });

  it('links only versions and pseudonymous ids, never production content', () => {
    const link = linkEvalTrace({
      caseId: 'eval_security_01',
      datasetVersion: 'coach-eval-dataset.v1',
      traceId: 'trace_eval_001',
      promptVersion: 'coach-prompts.v1',
      modelVersion: 'candidate-v1',
      schemaVersion: 'coach.result.v1',
      feedback: 'DOWN',
    });
    expect(link).toMatchObject({ caseId: 'eval_security_01', traceId: 'trace_eval_001' });
    expect(JSON.stringify(link)).not.toMatch(/userId|message|conversation|answer/i);
  });
});
