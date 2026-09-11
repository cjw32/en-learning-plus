import { McpTraceQueryService } from '../../src/mcp/observability/mcp-trace-query.service';

describe('MCP trace query', () => {
  const row = {
    traceId: 'trace_01',
    requestId: 'request_01',
    authorizationId: 'auth_01',
    capabilityName: 'create_quiz',
    protocolVersion: '2026-07-28',
    terminalStatus: 'COMPLETED',
    inputTokens: 12,
    outputTokens: 34,
    estimatedCostMicros: 56,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: new Date('2026-01-01T00:00:01Z'),
    steps: [
      {
        sequence: 1,
        stepType: 'AUTH',
        component: 'authorization',
        operation: 'verify',
        status: 'SUCCEEDED',
        durationMs: 2,
      },
    ],
    rawPrompt: 'never return me',
    answer: 'never return me either',
    subjectHmac: 'private',
  };

  it('reconstructs only approved correlation, outcomes, timing and cost', async () => {
    const service = new McpTraceQueryService({
      findByTraceId: async () => row,
    });
    const result = await service.get(
      { roles: ['mcp:diagnostics:read'] },
      'trace_01',
    );
    expect(result).toMatchObject({
      traceId: 'trace_01',
      requestId: 'request_01',
      totalDurationMs: 1000,
      usage: { inputTokens: 12, outputTokens: 34, estimatedCostMicros: 56 },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /never return|subjectHmac|rawPrompt|answer/,
    );
  });

  it('denies unapproved roles and does not reveal existence', async () => {
    const repository = { findByTraceId: jest.fn(async () => row) };
    const service = new McpTraceQueryService(repository);
    await expect(
      service.get({ roles: ['learner'] }, 'trace_01'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.findByTraceId).not.toHaveBeenCalled();
  });
});
