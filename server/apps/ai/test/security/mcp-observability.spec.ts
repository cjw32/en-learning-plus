import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type ObservabilityModule = {
  hashMcpIdentifier: (value: string, hmacKey: string) => string;
  redactMcpDiagnostic: (value: unknown) => unknown;
  mapMcpError: (
    error: unknown,
    traceId: string,
  ) => Readonly<{
    schemaVersion: string;
    ok: false;
    code: string;
    message: string;
    retryable: boolean;
    traceId: string;
  }>;
  McpTraceService: new (
    repository: { save: (trace: unknown) => Promise<void> },
    hmacKey: string,
  ) => {
    record: (input: Record<string, unknown>) => Promise<void>;
  };
};

const mcpRoot = resolve(__dirname, '../../src/mcp');

function loadObservability(): ObservabilityModule {
  const files = [
    'observability/mcp-trace.service.ts',
    'observability/mcp-redaction.ts',
    'errors/mcp-error-mapper.ts',
  ];
  for (const file of files) {
    if (!existsSync(resolve(mcpRoot, file))) {
      throw new Error(`Missing MCP observability boundary: ${file} (T024)`);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return {
    ...require(resolve(mcpRoot, files[0])),
    ...require(resolve(mcpRoot, files[1])),
    ...require(resolve(mcpRoot, files[2])),
  } as ObservabilityModule;
}

const secrets = {
  accessToken: 'ACCESS_TOKEN_CANARY_7KQ9',
  refreshToken: 'REFRESH_TOKEN_CANARY_2HT4',
  clientSecret: 'CLIENT_SECRET_CANARY_8VWX',
  privatePrompt: 'PRIVATE_PROMPT_CANARY_3NPD',
  reasoning: 'CHAIN_OF_THOUGHT_CANARY_6ZMR',
  learnerContent: 'LEARNER_CONTENT_CANARY_4BJF',
};

function expectNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of Object.values(secrets)) {
    expect(serialized).not.toContain(secret);
  }
}

describe('MCP privacy-safe observability', () => {
  it('redacts tokens, secrets, prompts, reasoning, and raw learner content', () => {
    const { redactMcpDiagnostic } = loadObservability();
    const redacted = redactMcpDiagnostic({
      authorization: `Bearer ${secrets.accessToken}`,
      refreshToken: secrets.refreshToken,
      clientSecret: secrets.clientSecret,
      systemPrompt: secrets.privatePrompt,
      reasoning: secrets.reasoning,
      answers: secrets.learnerContent,
      safeErrorCode: 'VALIDATION_FAILED',
      retryCount: 0,
    });

    expectNoSecrets(redacted);
    expect(redacted).toEqual(
      expect.objectContaining({
        safeErrorCode: 'VALIDATION_FAILED',
        retryCount: 0,
      }),
    );
  });

  it('hashes identity deterministically without retaining raw identifiers', () => {
    const { hashMcpIdentifier } = loadObservability();
    const first = hashMcpIdentifier('raw-subject-a', 'unit-test-hmac-key');
    const second = hashMcpIdentifier('raw-subject-a', 'unit-test-hmac-key');
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('raw-subject-a');
  });

  it('persists correlated allowlisted trace facts only', async () => {
    const { McpTraceService } = loadObservability();
    const save = jest.fn(async () => undefined);
    const service = new McpTraceService({ save }, 'unit-test-trace-hmac-key');

    await service.record({
      traceId: 'trace_observe_0001',
      requestId: 'request_observe_0001',
      authorizationId: 'authorization-a',
      subject: 'raw-subject-a',
      clientId: 'oauth-client-a',
      protocolVersion: '2026-07-28',
      capabilityType: 'TOOL',
      capabilityName: 'search_learning_materials',
      schemaValidated: true,
      terminalStatus: 'COMPLETED',
      inputTokens: 12,
      outputTokens: 8,
      estimatedCostMicros: 3,
      diagnostic: secrets,
    });

    expect(save).toHaveBeenCalledTimes(1);
    const persisted = save.mock.calls[0]?.[0];
    expect(persisted).toEqual(
      expect.objectContaining({
        traceId: 'trace_observe_0001',
        requestId: 'request_observe_0001',
        authorizationId: 'authorization-a',
        protocolVersion: '2026-07-28',
        capabilityName: 'search_learning_materials',
        terminalStatus: 'COMPLETED',
      }),
    );
    expect(JSON.stringify(persisted)).not.toContain('raw-subject-a');
    expect(JSON.stringify(persisted)).not.toContain('oauth-client-a');
    expectNoSecrets(persisted);
  });

  it('maps internal exceptions to a bounded public error without stack leakage', () => {
    const { mapMcpError } = loadObservability();
    const internal = new Error(
      `database failed with ${secrets.accessToken} and ${secrets.learnerContent}`,
    );
    internal.stack = `STACK_CANARY ${secrets.privatePrompt}`;
    const mapped = mapMcpError(internal, 'trace_error_0001');

    expect(mapped).toMatchObject({
      schemaVersion: 'en-learning.mcp.v1',
      ok: false,
      code: 'INTERNAL_ERROR',
      retryable: false,
      traceId: 'trace_error_0001',
    });
    expectNoSecrets(mapped);
    expect(JSON.stringify(mapped)).not.toContain('STACK_CANARY');
  });
});
