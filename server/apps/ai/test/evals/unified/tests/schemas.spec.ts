import {
  subject,
  evaluationCase,
  request,
  hash,
  result,
  unavailable,
} from './test-support';

const cases = subject('contracts/case.schema');
const runs = subject('contracts/run.schema');
const evidence = subject('contracts/evidence.schema');
const reports = subject('contracts/report.schema');

describe('T005 strict versioned contracts', () => {
  test('accepts authorized synthetic case without inventing a legacy observation', () => {
    expect(cases.evaluationCaseSchema?.safeParse(evaluationCase).success).toBe(
      true,
    );
  });
  test.each([
    { ...evaluationCase, approved: true },
    { ...evaluationCase, tags: ['x', 'x'] },
    { ...evaluationCase, requirements: [] },
    { ...evaluationCase, module: 'unknown' },
    { ...evaluationCase, inputRef: { path: '../secret', hash } },
    {
      ...evaluationCase,
      provenance: {
        ...evaluationCase.provenance,
        kind: 'authorized',
        authorizationRef: null,
      },
    },
  ])('rejects malformed case %#', (value) =>
    expect(cases.evaluationCaseSchema?.safeParse(value).success).toBe(false),
  );
  test('accepts bounded quick request', () =>
    expect(runs.runRequestSchema?.safeParse(request).success).toBe(true));
  test.each([
    { ...request, modes: ['live'] },
    { ...request, limits: { ...request.limits, concurrency: Infinity } },
    { ...request, limits: { ...request.limits, budgetMicros: -1 } },
    { ...request, limits: { ...request.limits, repeatCount: 0 } },
    { ...request, apiKey: 'forbidden' },
  ])('rejects unbounded or contradictory request %#', (value) =>
    expect(runs.runRequestSchema?.safeParse(value).success).toBe(false),
  );
  test('unknown usage is distinct from zero and requires reason', () => {
    expect(evidence.measuredValueSchema?.safeParse(unavailable).success).toBe(
      true,
    );
    expect(
      evidence.measuredValueSchema?.safeParse({
        value: 0,
        unavailableReason: null,
      }).success,
    ).toBe(true);
    expect(
      evidence.measuredValueSchema?.safeParse({
        value: null,
        unavailableReason: null,
      }).success,
    ).toBe(false);
    expect(
      evidence.measuredValueSchema?.safeParse({
        value: Infinity,
        unavailableReason: null,
      }).success,
    ).toBe(false);
  });
  test('gate status cannot disagree with exit code', () => {
    const value = {
      status: 'FAIL',
      exitCode: 1,
      scopeClaim: 'quick/check',
      reasons: ['CONTRACT_BREAK'],
      blockingItems: ['item-1'],
      missingRequirements: [],
      reviewItems: [],
      policyHash: hash,
      comparisonRef: null,
      executionCompleteness: 'complete',
    };
    expect(reports.gateDecisionSchema?.safeParse(value).success).toBe(true);
    expect(
      reports.gateDecisionSchema?.safeParse({ ...value, exitCode: 0 }).success,
    ).toBe(false);
  });
  test('result has one explicit terminal state and required failure reasons', () => {
    expect(runs.itemResultSchema?.safeParse(result).success).toBe(true);
    expect(
      runs.itemResultSchema?.safeParse({ ...result, terminalState: 'running' })
        .success,
    ).toBe(false);
    expect(
      runs.itemResultSchema?.safeParse({ ...result, terminalState: 'error' })
        .success,
    ).toBe(false);
  });
});
