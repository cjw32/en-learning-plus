import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';

type ResourceHandler = Readonly<{
  read(input: unknown, context: McpRequestContext): Promise<unknown>;
}>;

type ResourceRegistry = Readonly<{
  read(input: unknown, context: McpRequestContext): Promise<unknown>;
}>;

type ResourceRegistryConstructor = new (
  options: Readonly<{
    authorization: Readonly<{
      assertActive(context: McpRequestContext): Promise<void>;
    }>;
    handlers: Readonly<{
      word: ResourceHandler;
      courseMaterial: ResourceHandler;
      reviewsToday: ResourceHandler;
      reportSummary: ResourceHandler;
      weaknesses: ResourceHandler;
    }>;
  }>,
) => ResourceRegistry;

const registryPath = resolve(
  __dirname,
  '../../src/mcp/resources/mcp-resource.registry.ts',
);
const courseReadServicePath = resolve(
  __dirname,
  '../../../../libs/learning/src/resources/learning-resource-read.service.ts',
);

function loadRegistry(): ResourceRegistryConstructor {
  if (!existsSync(registryPath)) {
    throw new Error('Missing MCP Resource registry (T059)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Registry = require(registryPath).McpResourceRegistry as
    | ResourceRegistryConstructor
    | undefined;
  if (!Registry) throw new Error('Missing McpResourceRegistry export (T059)');
  return Registry;
}

function context(
  userId: 'learner_a' | 'learner_b',
  overrides: Partial<McpRequestContext['principal']> = {},
): McpRequestContext {
  const suffix = userId === 'learner_a' ? 'a' : 'b';
  return Object.freeze({
    principal: Object.freeze({
      issuer: 'https://issuer.mcp.test',
      subject: `subject_${suffix}`,
      audience: 'https://resource.mcp.test/ai/v1/mcp',
      clientId: `client_${suffix}`,
      scopes: Object.freeze(['learning:read'] as const),
      authorizationVersion: 1,
      issuedAtEpochSeconds: 1_789_117_140,
      notBeforeEpochSeconds: 1_789_117_140,
      expiresAtEpochSeconds: 1_789_120_800,
      verificationMethodVersion: 'fixture.v1',
      ...overrides,
    }),
    userId,
    authorizationId: `authorization_${suffix}`,
    requestId: `request_resource_isolation_${suffix}`,
    traceId: `trace_resource_isolation_${suffix}`,
    protocolVersion: '2026-07-28',
  });
}

function safeError(code: string) {
  return Object.assign(new Error('The resource is unavailable.'), { code });
}

function fixture() {
  const active = new Map([
    ['authorization_a', true],
    ['authorization_b', true],
  ]);
  const deletedUsers = new Set<string>();
  const authorization = {
    assertActive: jest.fn(async (requestContext: McpRequestContext) => {
      if (
        requestContext.principal.expiresAtEpochSeconds <= 1_789_117_200 ||
        !active.get(requestContext.authorizationId) ||
        deletedUsers.has(requestContext.userId)
      ) {
        throw safeError('UNAUTHENTICATED');
      }
      if (!requestContext.principal.scopes.includes('learning:read')) {
        throw safeError('INSUFFICIENT_SCOPE');
      }
    }),
  };

  const word = {
    read: jest.fn(async (input: any) => {
      if (input.uri === 'en-learning://words/restricted_word') {
        throw safeError('SOURCE_RIGHTS_DENIED');
      }
      return {
        kind: 'word',
        uri: input.uri,
        word: { wordId: 'word_public', word: 'public' },
        source: { accessScope: 'PUBLIC', status: 'active' },
      };
    }),
  };
  const courseMaterial = {
    read: jest.fn(async (input: any, requestContext: McpRequestContext) => {
      if (
        input.uri !==
          'en-learning://courses/course_a/materials/material_entitled' ||
        requestContext.userId !== 'learner_a'
      ) {
        throw safeError('RESOURCE_NOT_FOUND');
      }
      return {
        kind: 'course_material',
        uri: input.uri,
        title: 'Entitled material',
        source: { accessScope: 'OWNED_COURSE', status: 'active' },
      };
    }),
  };
  const privateHandler = (kind: string) => ({
    read: jest.fn(async (input: any, requestContext: McpRequestContext) => ({
      kind,
      uri: input.uri,
      ownerFixture: requestContext.userId,
      items:
        requestContext.userId === 'learner_a'
          ? [{ key: 'only_a' }]
          : [{ key: 'only_b' }],
    })),
  });
  const handlers = {
    word,
    courseMaterial,
    reviewsToday: privateHandler('today_reviews'),
    reportSummary: privateHandler('learning_report'),
    weaknesses: privateHandler('weaknesses'),
  };
  const Registry = loadRegistry();
  const registry = new Registry({ authorization, handlers });

  return {
    registry,
    authorization,
    handlers,
    active,
    deletedUsers,
    businessCalls: () =>
      Object.values(handlers).reduce(
        (total, handler) => total + handler.read.mock.calls.length,
        0,
      ),
  };
}

describe('MCP Resource current-user and source-rights isolation', () => {
  it('constrains a course-material domain read to the authenticated user', async () => {
    if (!existsSync(courseReadServicePath)) {
      throw new Error('Missing LearningResourceReadService (T053)');
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Service = require(courseReadServicePath).LearningResourceReadService;
    const repository = {
      findAuthorizedCourseMaterial: jest.fn(async () => null),
    };
    const service = new Service(
      repository,
      () => new Date('2026-09-11T08:00:00.000Z'),
    );

    await expect(
      service.readCourseMaterial({
        userId: context('learner_a').userId,
        courseId: 'course_business',
        materialId: 'material_meeting_1',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(repository.findAuthorizedCourseMaterial).toHaveBeenCalledWith({
      userId: 'learner_a',
      courseId: 'course_business',
      materialId: 'material_meeting_1',
      at: new Date('2026-09-11T08:00:00.000Z'),
    });
  });

  it.each([
    'en-learning://me/reviews/today',
    'en-learning://me/reports/summary',
    'en-learning://me/weaknesses',
  ])('binds %s to the authenticated user only', async (uri) => {
    const test = fixture();
    const resultA = await test.registry.read({ uri }, context('learner_a'));
    const resultB = await test.registry.read({ uri }, context('learner_b'));

    expect(resultA).toMatchObject({ ownerFixture: 'learner_a' });
    expect(resultB).toMatchObject({ ownerFixture: 'learner_b' });
    expect(JSON.stringify(resultA)).not.toContain('only_b');
    expect(JSON.stringify(resultB)).not.toContain('only_a');
  });

  it.each([
    {
      name: 'URI',
      request: { uri: 'en-learning://users/learner_b/reviews/today' },
    },
    {
      name: 'unknown input',
      request: {
        uri: 'en-learning://me/reviews/today',
        userId: 'learner_b',
      },
    },
  ])('rejects cross-user selection through $name', async ({ request }) => {
    const test = fixture();
    await expect(
      test.registry.read(request, context('learner_a')),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(test.businessCalls()).toBe(0);
  });

  it('uses one outward not-found result for unentitled and nonexistent course material', async () => {
    const test = fixture();
    const denied = test.registry.read(
      {
        uri: 'en-learning://courses/course_a/materials/material_entitled',
      },
      context('learner_b'),
    );
    const missing = test.registry.read(
      { uri: 'en-learning://courses/course_a/materials/material_missing' },
      context('learner_b'),
    );

    await expect(denied).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: 'The resource is unavailable.',
    });
    await expect(missing).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: 'The resource is unavailable.',
    });
  });

  it('does not return content from a source without approved field rights', async () => {
    const test = fixture();
    await expect(
      test.registry.read(
        { uri: 'en-learning://words/restricted_word' },
        context('learner_a'),
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_RIGHTS_DENIED' });
  });

  it.each([
    {
      name: 'revoked authorization',
      prepare: (test: ReturnType<typeof fixture>) =>
        test.active.set('authorization_a', false),
      requestContext: () => context('learner_a'),
    },
    {
      name: 'deleted account',
      prepare: (test: ReturnType<typeof fixture>) =>
        test.deletedUsers.add('learner_a'),
      requestContext: () => context('learner_a'),
    },
    {
      name: 'expired token',
      prepare: () => undefined,
      requestContext: () =>
        context('learner_a', { expiresAtEpochSeconds: 1_789_117_199 }),
    },
    {
      name: 'removed scope',
      prepare: () => undefined,
      requestContext: () => context('learner_a', { scopes: [] }),
    },
  ])('blocks $name before protected content reads', async (scenario) => {
    const test = fixture();
    scenario.prepare(test);

    await expect(
      test.registry.read(
        { uri: 'en-learning://me/reports/summary' },
        scenario.requestContext(),
      ),
    ).rejects.toMatchObject({
      code:
        scenario.name === 'removed scope'
          ? 'INSUFFICIENT_SCOPE'
          : 'UNAUTHENTICATED',
    });
    expect(test.authorization.assertActive).toHaveBeenCalledTimes(1);
    expect(test.businessCalls()).toBe(0);
  });

  it('revalidates authorization when a resource is called after discovery', async () => {
    const test = fixture();
    const requestContext = context('learner_a');
    await test.registry.read(
      { uri: 'en-learning://me/reports/summary' },
      requestContext,
    );
    test.active.set(requestContext.authorizationId, false);

    await expect(
      test.registry.read(
        { uri: 'en-learning://me/reports/summary' },
        requestContext,
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(test.handlers.reportSummary.read).toHaveBeenCalledTimes(1);
  });
});
