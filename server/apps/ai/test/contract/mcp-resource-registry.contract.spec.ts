import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';
import { McpResourceRegistry } from '../../src/mcp/resources/mcp-resource.registry';

const context: McpRequestContext = Object.freeze({
  principal: Object.freeze({
    issuer: 'https://issuer.mcp.test',
    subject: 'registry-subject-a',
    audience: 'https://resource.mcp.test/ai/v1/mcp',
    clientId: 'registry-client-a',
    scopes: Object.freeze(['learning:read'] as const),
    authorizationVersion: 1,
    issuedAtEpochSeconds: 1_789_117_140,
    notBeforeEpochSeconds: 1_789_117_140,
    expiresAtEpochSeconds: 1_789_120_800,
    verificationMethodVersion: 'fixture.v1',
  }),
  userId: 'learner_a',
  authorizationId: 'authorization_a',
  requestId: 'request_registry_0001',
  traceId: 'trace_registry_0001',
  protocolVersion: '2026-07-28',
});

function fixture(disabled?: string) {
  const handler = (kind: string) => ({
    read: jest.fn(async () => ({ kind })),
  });
  const handlers = {
    word: handler('word'),
    courseMaterial: handler('course_material'),
    reviewsToday: handler('today_reviews'),
    reportSummary: handler('learning_report'),
    weaknesses: handler('weaknesses'),
  };
  const authorization = { assertActive: jest.fn(async () => undefined) };
  return {
    handlers,
    authorization,
    registry: new McpResourceRegistry({
      handlers,
      authorization,
      isCapabilityEnabled: (name) => name !== disabled,
    }),
  };
}

describe('MCP Resource registry discovery/direct-call parity', () => {
  it('registers exactly two templates and three fixed Resources', () => {
    const test = fixture();
    const server = { registerResource: jest.fn() };
    const registered = test.registry.register(server as never, context);
    expect(registered).toEqual([
      'word',
      'courseMaterial',
      'reviewsToday',
      'reportSummary',
      'weaknesses',
    ]);
    expect(server.registerResource).toHaveBeenCalledTimes(5);
    expect(server.registerResource.mock.calls.map(([name]) => name)).toEqual([
      'word',
      'course-material',
      'reviews-today',
      'report-summary',
      'weaknesses',
    ]);
  });

  it('uses the same gate for registration and direct reads', async () => {
    const test = fixture('weaknesses');
    const server = { registerResource: jest.fn() };
    expect(test.registry.register(server as never, context)).not.toContain(
      'weaknesses',
    );
    await expect(
      test.registry.read({ uri: 'en-learning://me/weaknesses' }, context),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    expect(test.handlers.weaknesses.read).not.toHaveBeenCalled();
  });

  it('revalidates authorization on every direct read', async () => {
    const test = fixture();
    await test.registry.read(
      { uri: 'en-learning://me/reports/summary' },
      context,
    );
    await test.registry.read(
      { uri: 'en-learning://me/reports/summary' },
      context,
    );
    expect(test.authorization.assertActive).toHaveBeenCalledTimes(2);
  });
});
