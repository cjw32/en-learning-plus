import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';
import { McpToolRegistry } from '../../src/mcp/tools/mcp-tool.registry';

function context(
  protocolVersion: '2026-07-28' | '2025-11-25' = '2026-07-28',
  scopes: readonly ('learning:read' | 'quiz:create' | 'answer:submit')[] = [
    'quiz:create',
  ],
): McpRequestContext {
  return Object.freeze({
    principal: Object.freeze({
      issuer: 'https://issuer.mcp.test',
      subject: 'create-quiz-registry-subject',
      audience: 'https://resource.mcp.test/ai/v1/mcp',
      clientId: 'create-quiz-registry-client',
      scopes: Object.freeze([...scopes]),
      authorizationVersion: 1,
      issuedAtEpochSeconds: 1_789_117_140,
      notBeforeEpochSeconds: 1_789_117_140,
      expiresAtEpochSeconds: 1_789_120_800,
      verificationMethodVersion: 'fixture.v1',
    }),
    userId: 'learner_quiz_registry',
    authorizationId: 'authorization_quiz_registry',
    requestId: 'request_quiz_registry_0001',
    traceId: 'trace_quiz_registry_0001',
    protocolVersion,
  });
}

function fixture(options: { gate?: boolean; clientTools?: boolean } = {}) {
  const execute = jest.fn(async () => ({
    schemaVersion: 'en-learning.mcp.v1',
    ok: true,
    exerciseId: 'exercise_quiz_registry_0001',
    exerciseVersion: 'exercise.registry.v1',
    status: 'ready',
    instructions: 'Choose one answer.',
    personalizationReason: 'Uses a current learning target.',
    items: [],
    citations: [],
    replayed: false,
    traceId: 'trace_quiz_registry_0001',
  }));
  const createQuiz = {
    name: 'create_quiz',
    definition: {
      description: 'Create current-user owned exercise.',
      inputSchema: {},
      outputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        'en-learning/requiredScopes': ['quiz:create'],
        'en-learning/effect': 'create_exercise',
      },
    },
    execute,
  };
  let active = true;
  const authorization = {
    assertActive: jest.fn(async () => {
      if (!active)
        throw Object.assign(new Error('revoked'), { code: 'UNAUTHENTICATED' });
    }),
  };
  const registry = new McpToolRegistry({
    handlers: { create_quiz: createQuiz } as never,
    authorization,
    isCapabilityEnabled: (name) =>
      name === 'create_quiz' &&
      (options.gate ?? true) &&
      (options.clientTools ?? true),
  });
  return {
    registry,
    authorization,
    createQuiz,
    execute,
    revoke: () => {
      active = false;
    },
  };
}

describe('MCP create_quiz registry scope/gate/capability policy', () => {
  it.each(['2026-07-28', '2025-11-25'] as const)(
    'registers create_quiz for the %s era when all policy inputs allow it',
    async (protocolVersion) => {
      const test = fixture();
      const server = { registerTool: jest.fn() };

      expect(
        test.registry.register(server as never, context(protocolVersion)),
      ).toEqual(['create_quiz']);
      expect(server.registerTool).toHaveBeenCalledTimes(1);
      expect(server.registerTool.mock.calls[0]?.[0]).toBe('create_quiz');
      expect(server.registerTool.mock.calls[0]?.[1]).toBe(
        test.createQuiz.definition,
      );
      const callback = server.registerTool.mock.calls[0]?.[2];
      const response = await callback(
        { schemaVersion: 'en-learning.mcp.v1' },
        { signal: new AbortController().signal },
      );
      expect(response.structuredContent).toMatchObject({ status: 'ready' });
      expect(test.execute).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['missing scope', {}, context('2026-07-28', [])],
    ['quiz gate closed', { gate: false }, context()],
    ['client tools undeclared', { clientTools: false }, context()],
  ] as const)(
    'hides and denies create_quiz when %s',
    async (_name, options, ctx) => {
      const test = fixture(options);
      const server = { registerTool: jest.fn() };

      expect(test.registry.register(server as never, ctx)).not.toContain(
        'create_quiz',
      );
      await expect(
        test.registry.call('create_quiz', {}, ctx),
      ).rejects.toMatchObject({
        code:
          _name === 'missing scope'
            ? 'INSUFFICIENT_SCOPE'
            : 'CAPABILITY_UNAVAILABLE',
      });
      expect(test.execute).not.toHaveBeenCalled();
    },
  );

  it('revalidates revocation on every direct call before dispatch', async () => {
    const test = fixture();
    await test.registry.call('create_quiz', {}, context());
    test.revoke();

    await expect(
      test.registry.call('create_quiz', {}, context()),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(test.authorization.assertActive).toHaveBeenCalledTimes(2);
    expect(test.execute).toHaveBeenCalledTimes(1);
  });
});
