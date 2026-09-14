import { subject, hash, item, result } from './test-support';
const reports = subject('core/report');
const markdown = subject('core/report-markdown');
describe('T022 unified report observations', () => {
  test('same item list drives JSON counts, markdown and gate', () => {
    const report = reports.summarize?.(
      [
        result,
        {
          ...result,
          itemId: 'two',
          terminalState: 'error',
          reasonCodes: ['WORKER_CRASH'],
        },
      ],
      { scopeClaim: 'quick/check:coach', policyHash: hash, runId: 'run-1' },
    );
    expect(report).toMatchObject({
      counts: { planned: 2, passed: 1, error: 1 },
      gate: { status: 'INCOMPLETE', exitCode: 2 },
    });
    const text = markdown.renderSummary?.(report);
    expect(text).toContain('INCOMPLETE');
    expect(text).toContain('quick/check:coach');
    expect(text).toContain('WORKER_CRASH');
  });
  test('unknown usage remains null; no fabricated timing or cost', () => {
    const report = reports.summarize?.([result], {
      scopeClaim: 'check:coach',
      policyHash: hash,
      runId: 'run-2',
    });
    expect(report?.usage).toMatchObject({
      actualCostMicros: null,
      inputTokens: null,
      outputTokens: null,
      unavailableReason: 'NO_USAGE_EVIDENCE',
    });
  });
  test('no report or missing result cannot produce PASS', () => {
    expect(
      reports.summarize?.([], {
        scopeClaim: 'check',
        policyHash: hash,
        runId: 'empty',
      })?.gate.status,
    ).toBe('INCOMPLETE');
  });
});

test.each(['CONTRACT_BREAK', 'DEPENDENCY_UNAVAILABLE', 'SCORER_DISAGREEMENT'])(
  'a contradictory passed result with %s cannot pass',
  (reason) => {
    expect(
      reports.summarize([{ ...result, reasonCodes: [reason] }], {
        scopeClaim: 'quick/check',
        policyHash: hash,
        runId: 'contradiction',
      }).gate.status,
    ).not.toBe('PASS');
  },
);

test('cryptographic hashes containing digit runs are not mistaken for phone numbers', () => {
  const redaction = subject('core/redaction');
  const digest = 'a'.repeat(20) + '13800138000' + 'b'.repeat(33);
  expect(() => redaction.assertSafePayload({ hash: digest })).not.toThrow();
  expect(redaction.safeDiagnostic(`Hash: ${digest}.`)).not.toBe(
    '[REDACTED_DIAGNOSTIC]',
  );
  expect(() =>
    redaction.assertSafePayload({ text: 'phone 13800138000' }),
  ).toThrow('SENSITIVE_PAYLOAD');
});
