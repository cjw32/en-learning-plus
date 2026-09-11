import { decideMcpRelease } from './mcp-release-gate';

describe('MCP fail-closed release gate', () => {
  const base = {
    approvals: {
      sourceRights: true,
      retention: true,
      realProviderBudget: true,
    },
    baselinesApproved: true,
    requiredClients: [
      'Codex',
      'Claude Desktop',
      'Visual Studio Code',
      'MCP Inspector',
    ],
    clientsPassed: [
      'Codex',
      'Claude Desktop',
      'Visual Studio Code',
      'MCP Inspector',
    ],
    regressionsPassed: true,
    evidenceComplete: true,
    zeroToleranceViolations: [] as string[],
  };

  it('passes only when every conjunctive gate is present', () => {
    expect(decideMcpRelease(base)).toMatchObject({
      status: 'READY',
      passed: true,
    });
  });

  it.each([
    'cross_user',
    'identity_spoof',
    'unconfirmed_write',
    'duplicate_write',
    'token_leak',
    'unauthorized_capability',
    'fabricated_source',
    'fabricated_result',
    'fabricated_save',
    'prompt_leak',
  ])('fails each zero-tolerance defect: %s', (violation) => {
    expect(
      decideMcpRelease({ ...base, zeroToleranceViolations: [violation] }),
    ).toMatchObject({ status: 'NOT_READY', passed: false });
  });

  it.each([
    { ...base, evidenceComplete: false },
    { ...base, regressionsPassed: false },
    { ...base, baselinesApproved: false },
    { ...base, clientsPassed: base.clientsPassed.slice(0, 3) },
    { ...base, approvals: { ...base.approvals, retention: false } },
  ])(
    'fails closed for missing evidence, approvals, regressions, baseline or client',
    (input) => {
      expect(decideMcpRelease(input)).toMatchObject({
        status: 'NOT_READY',
        passed: false,
      });
    },
  );
});
