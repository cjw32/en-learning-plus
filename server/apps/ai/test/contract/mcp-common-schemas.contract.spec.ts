type Schema = {
  safeParse: (value: unknown) => { success: boolean };
};

type McpContractModule = Record<string, unknown>;

const contract = require('@en/common/mcp') as McpContractModule;

function schema(name: string): Schema {
  const candidate = contract[name] as Schema | undefined;
  if (!candidate || typeof candidate.safeParse !== 'function') {
    throw new Error(`Missing strict MCP contract export: ${name} (T015)`);
  }
  return candidate;
}

const version = 'en-learning.mcp.v1';
const traceId = 'trace_contract_0001';
const meta = {
  schemaVersion: version,
  contentVersion: 'content.v1',
  updatedAt: '2026-09-11T08:00:00.000Z',
  truncated: false,
  nextCursor: null,
  traceId,
};

const validSamples = {
  mcpInitializeInputSchema: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'mcp-test-client', version: '1.0.0' },
  },
  mcpCapabilityManifestSchema: {
    schemaVersion: version,
    protocolVersion: '2026-07-28',
    manifestVersion: 'manifest.v1',
    capabilities: [],
    traceId,
  },
  mcpResourceContentSchema: {
    kind: 'today_reviews',
    uri: 'en-learning://me/reviews/today',
    meta,
    learningDate: '2026-09-11',
    timezone: 'Asia/Shanghai',
    totalDue: 0,
    items: [],
  },
  mcpToolInvocationSchema: {
    name: 'search_words',
    input: { schemaVersion: version, query: 'practice' },
  },
  mcpToolResultSchema: {
    schemaVersion: version,
    ok: true,
    query: 'practice',
    items: [],
    nextCursor: null,
    traceId,
  },
  mcpPromptRequestSchema: {
    name: 'vocabulary_review',
    arguments: {},
  },
  mcpPromptResultSchema: {
    schemaVersion: version,
    name: 'vocabulary_review',
    promptVersion: 'prompt.v1',
    messages: [{ role: 'user', content: 'Review today’s due words.' }],
    recommendedReadTools: ['get_due_words'],
    writesRequireSeparateConfirmation: true,
    traceId,
  },
  mcpSafeErrorSchema: {
    schemaVersion: version,
    ok: false,
    code: 'VALIDATION_FAILED',
    message: 'The request is invalid.',
    retryable: false,
    traceId,
  },
  mcpPaginationSchema: {
    limit: 10,
    cursor: 'eyJvZmZzZXQiOjEwfQ.signature_123456',
  },
  mcpContentMetaSchema: meta,
  mcpConfirmationRequiredSchema: {
    schemaVersion: version,
    ok: false,
    status: 'confirmation_required',
    expiresAt: '2026-09-11T08:05:00.000Z',
    operationSummary: 'Submit answers and update learning progress.',
    traceId,
  },
} as const;

describe('English Learning MCP public contracts', () => {
  it.each(Object.entries(validSamples))('accepts valid %s', (name, sample) => {
    expect(schema(name).safeParse(sample).success).toBe(true);
  });

  it.each(Object.entries(validSamples))(
    'rejects unknown identity/control fields in %s',
    (name, sample) => {
      expect(
        schema(name).safeParse({ ...sample, userId: 'attacker-user' }).success,
      ).toBe(false);
    },
  );

  it('rejects oversized strings and unexpected nested depth before routing', () => {
    expect(
      schema('mcpToolInvocationSchema').safeParse({
        name: 'search_words',
        input: { schemaVersion: version, query: 'x'.repeat(201) },
      }).success,
    ).toBe(false);
    expect(
      schema('mcpToolInvocationSchema').safeParse({
        ...validSamples.mcpToolInvocationSchema,
        injected: { a: { b: { c: { d: { e: 'too-deep' } } } } },
      }).success,
    ).toBe(false);
  });

  it('rejects invalid resource IDs and opaque cursors', () => {
    expect(
      schema('mcpResourceContentSchema').safeParse({
        ...validSamples.mcpResourceContentSchema,
        uri: 'en-learning://users/real-user-id/reviews/today',
      }).success,
    ).toBe(false);
    expect(
      schema('mcpPaginationSchema').safeParse({
        limit: 10,
        cursor: '../../etc/passwd',
      }).success,
    ).toBe(false);
  });

  it('requires result provenance and confirmation expiry metadata', () => {
    const resultWithoutTrace = {
      ...validSamples.mcpToolResultSchema,
      traceId: undefined,
    };
    const confirmationWithoutExpiry = {
      ...validSamples.mcpConfirmationRequiredSchema,
      expiresAt: undefined,
    };
    expect(
      schema('mcpToolResultSchema').safeParse(resultWithoutTrace).success,
    ).toBe(false);
    expect(
      schema('mcpConfirmationRequiredSchema').safeParse(
        confirmationWithoutExpiry,
      ).success,
    ).toBe(false);
  });
});
