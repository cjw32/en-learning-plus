import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';
import {
  McpToolRegistry,
  type McpReadToolName,
} from '../../src/mcp/tools/mcp-tool.registry';

function context(
  scopes: readonly 'learning:read'[] = ['learning:read'],
): McpRequestContext {
  return Object.freeze({
    principal: Object.freeze({
      issuer: 'https://issuer.mcp.test',
      subject: 'registry-tool-subject',
      audience: 'https://resource.mcp.test/ai/v1/mcp',
      clientId: 'registry-tool-client',
      scopes: Object.freeze([...scopes]),
      authorizationVersion: 1,
      issuedAtEpochSeconds: 1_789_117_140,
      notBeforeEpochSeconds: 1_789_117_140,
      expiresAtEpochSeconds: 1_789_120_800,
      verificationMethodVersion: 'fixture.v1',
    }),
    userId: 'learner_a',
    authorizationId: 'authorization_a',
    requestId: 'request_tool_registry_0001',
    traceId: 'trace_tool_registry_0001',
    protocolVersion: '2026-07-28',
  });
}

const names = [
  'search_words',
  'get_due_words',
  'search_learning_materials',
  'get_learning_report',
] as const;

function fixture(disabled?: McpReadToolName) {
  const handlers = Object.fromEntries(
    names.map((name) => [
      name,
      {
        name,
        definition: {
          description: `Read-only ${name}`,
          inputSchema: { safeParse: jest.fn() },
          outputSchema: { safeParse: jest.fn() },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
          _meta: { 'en-learning/effect': 'read' },
        },
        execute: jest.fn(async () => ({
          schemaVersion: 'en-learning.mcp.v1',
          ok: true,
          traceId: 'trace_tool_registry_0001',
          name,
        })),
      },
    ]),
  ) as never;
  const authorization = { assertActive: jest.fn(async () => undefined) };
  return {
    handlers,
    authorization,
    registry: new McpToolRegistry({
      handlers,
      authorization,
      isCapabilityEnabled: (name) => name !== disabled,
    }),
  };
}

describe('MCP read Tool registry discovery/direct-call parity', () => {
  it('registers exactly four read Tools with their runtime schemas and annotations', async () => {
    const test = fixture();
    const server = { registerTool: jest.fn() };

    expect(test.registry.register(server as never, context())).toEqual(names);
    expect(server.registerTool).toHaveBeenCalledTimes(4);
    expect(server.registerTool.mock.calls.map(([name]) => name)).toEqual(names);
    for (const [name, definition, callback] of server.registerTool.mock.calls) {
      expect(definition).toBe(test.handlers[name].definition);
      expect(definition).toMatchObject({
        inputSchema: expect.any(Object),
        outputSchema: expect.any(Object),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      });
      const response = await callback(
        {},
        { signal: new AbortController().signal },
      );
      expect(response.structuredContent).toMatchObject({ name });
      expect(JSON.parse(response.content[0].text)).toEqual(
        response.structuredContent,
      );
    }
  });

  it('uses the same gate for discovery and direct invocation', async () => {
    const test = fixture('search_learning_materials');
    const server = { registerTool: jest.fn() };
    expect(test.registry.register(server as never, context())).not.toContain(
      'search_learning_materials',
    );
    await expect(
      test.registry.call('search_learning_materials', {}, context()),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    expect(
      test.handlers.search_learning_materials.execute,
    ).not.toHaveBeenCalled();
  });

  it('denies missing scope before the handler and revalidates authorization per call', async () => {
    const test = fixture();
    await expect(
      test.registry.call('search_words', {}, context([])),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
    expect(test.handlers.search_words.execute).not.toHaveBeenCalled();

    await test.registry.call('search_words', {}, context());
    await test.registry.call('search_words', {}, context());
    expect(test.authorization.assertActive).toHaveBeenCalledTimes(3);
    expect(test.handlers.search_words.execute).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown direct-call names before any handler', async () => {
    const test = fixture();
    await expect(
      test.registry.call('save_attempt', {}, context()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(test.authorization.assertActive).not.toHaveBeenCalled();
    for (const handler of Object.values(test.handlers)) {
      expect(handler.execute).not.toHaveBeenCalled();
    }
  });
});
