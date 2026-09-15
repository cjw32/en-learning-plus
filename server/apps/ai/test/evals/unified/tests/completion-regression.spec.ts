import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { subject, result } from './test-support';
const metrics = subject('core/group-metrics');
const scheduler = subject('core/stop-controller');
const comparison = subject('core/comparability');
const coordinator = subject('core/run-coordinator');
const root = resolve(__dirname, '../../../../../../..');
jest.setTimeout(60000);
describe('complete controlled evaluation execution', () => {
  it('counts repeated executions without inflating independent sample size', () => {
    const rows = metrics.groupMetrics?.([
      {
        ...result,
        caseId: 'suite:a',
        allAttempts: ['a1', 'a2'],
        expectedRepeatCount: 2,
      },
      {
        ...result,
        itemId: 'b',
        caseId: 'suite:b',
        terminalState: 'failed',
        reasonCodes: ['CONTRACT_BREAK'],
      },
    ]);
    expect(
      rows?.find(
        (r: any) => r.module === 'coach' && r.metricId === 'business_pass_rate',
      ),
    ).toMatchObject({
      value: 0.5,
      denominator: 2,
      effectiveN: 2,
      independentN: 2,
    });
  });
  it('separates fixture validation from actual business assertions', () => {
    const rows = metrics.groupMetrics?.([
      { ...result, caseId: 'coach:fixture' },
      { ...result, itemId: 'b', caseId: 'suite:b' },
    ]);
    expect(
      rows
        ?.filter((r: any) => r.module === 'coach')
        .map((r: any) => r.metricId)
        .sort(),
    ).toEqual(['business_pass_rate', 'fixture_validity_rate']);
  });
  it('honors bounded concurrency and never starts more work after stop', async () => {
    let active = 0,
      peak = 0;
    const seen: number[] = [];
    const controller = new AbortController();
    await scheduler.runBounded?.(
      [0, 1, 2, 3, 4],
      2,
      controller.signal,
      async (n: number) => {
        active++;
        peak = Math.max(peak, active);
        seen.push(n);
        await new Promise((r) => setTimeout(r, 5));
        if (n === 0) controller.abort();
        active--;
      },
    );
    expect(peak).toBe(2);
    expect(seen).toEqual([0, 1]);
  });
  it('marks missing case pairs as incomparable instead of silently dropping them', () => {
    const checked = comparison.compareCases?.(
      [{ ...result, caseId: 'a' }],
      [{ ...result, caseId: 'b' }],
    );
    expect(checked?.missingPairs).toEqual(['a', 'b']);
    expect(checked?.comparability).toBe('incomparable');
  });
  it('full profile still executes available business checks while preserving live gaps', async () => {
    const output = mkdtempSync(join(tmpdir(), 'eval-full-'));
    try {
      const run = await coordinator.runEvaluation(
        [
          'run',
          '--profile',
          'full',
          '--modules',
          'pronunciation',
          '--case',
          'suite:pronunciation-alignment',
          '--output',
          output,
        ],
        root,
      );
      expect(run.exitCode).toBe(2);
      const report = JSON.parse(
        readFileSync(join(run.runDir, 'report.json'), 'utf8'),
      );
      expect(report.cases[0].terminalState).toBe('passed');
      expect(report.metrics.length).toBeGreaterThan(0);
      expect(report.gate.missingRequirements).toContain(
        'REQUIRED_LIVE_NOT_EXECUTED',
      );
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});

describe('safe, trusted business test evidence', () => {
  it('redacts unsafe parameterized titles without merging distinct cases', () => {
    const { publicTestName } = require('../adapters/jest.adapter');
    const a = publicTestName('reject Bearer simulated-one'),
      b = publicTestName('reject Bearer simulated-two');
    expect(a).toMatch(/^redacted-test-[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    expect(publicTestName('normal assertion')).toBe('normal assertion');
  });
  it('rejects changed test assertions before launching candidate code', async () => {
    const { runRegisteredJest } = require('../adapters/jest.adapter');
    const output = mkdtempSync(join(tmpdir(), 'eval-trusted-'));
    try {
      await expect(
        runRegisteredJest(
          'mcp-protocol',
          join(root, 'server'),
          output,
          1000,
          undefined,
          { sourceHash: '0'.repeat(64), configHash: '0'.repeat(64) },
        ),
      ).rejects.toThrow('TRUSTED_TEST_MISMATCH');
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});

test('synthetic mode cannot inherit paid execution settings', () => {
  const { parseOptions } = require('../core/cli-options');
  expect(
    parseOptions(['run', '--profile', 'synthetic', '--output', '/tmp/test']),
  ).toMatchObject({
    modes: ['deterministic', 'mock', 'replay'],
    limits: { budgetMicros: 0 },
  });
  expect(() =>
    parseOptions([
      'run',
      '--profile',
      'synthetic',
      '--mode',
      'live',
      '--output',
      '/tmp/test',
    ]),
  ).toThrow('QUICK_COST_CONFLICT');
  expect(() =>
    parseOptions([
      'run',
      '--profile',
      'synthetic',
      '--budget-micros',
      '1',
      '--output',
      '/tmp/test',
    ]),
  ).toThrow('QUICK_COST_CONFLICT');
});
