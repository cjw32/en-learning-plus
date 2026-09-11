import { McpRequestPipeline } from '../../src/mcp/transport/mcp-request-pipeline';

const now = new Date('2026-09-11T08:00:00.000Z');
const resource = 'https://resource.mcp.test/ai/v1/mcp';
const metaVersion = 'io.modelcontextprotocol/protocolVersion';

function request(
  overrides: { authorization?: string; url?: string; body?: unknown } = {},
): Request {
  const body = overrides.body ?? {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: { _meta: { [metaVersion]: '2026-07-28' } },
  };
  const authorization = Object.prototype.hasOwnProperty.call(
    overrides,
    'authorization',
  )
    ? overrides.authorization
    : 'Bearer opaque-token-a';
  return new Request(overrides.url ?? resource, {
    method: 'POST',
    headers: {
      ...(authorization ? { authorization } : {}),
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    },
    body: JSON.stringify(body),
  });
}

function error(code: string): Error & { code: string } {
  return Object.assign(new Error(`private detail for ${code}`), { code });
}

function fixture(failure?: string) {
  const stages: string[] = [];
  const release = jest.fn(async () => undefined);
  const verified = Object.freeze({
    issuer: 'https://issuer.mcp.test',
    subject: 'immutable-subject-a',
    audience: resource,
    clientId: 'client-a',
    scopes: Object.freeze(['learning:read'] as const),
    authorizationVersion: 3,
    issuedAtEpochSeconds: 1_789_113_540,
    notBeforeEpochSeconds: 1_789_113_540,
    expiresAtEpochSeconds: 1_789_117_200,
    verificationMethodVersion: 'fake-local.v1',
    tokenType: 'mcp_access' as const,
    active: true,
  });
  const authorized = Object.freeze({
    identity: Object.freeze({
      issuer: verified.issuer,
      subjectHmac: 'subject_hash_a',
      userId: 'user-a',
      authorizationId: 'authorization-a',
      clientId: verified.clientId,
      audience: resource,
      authorizationVersion: 3,
    }),
    scopes: Object.freeze(['learning:read'] as const),
  });
  const verifier = {
    verify: jest.fn(async () => {
      if (failure === 'authentication') throw error('UNAUTHENTICATED');
      return verified;
    }),
  };
  const authorization = {
    authorize: jest.fn(async () => {
      if (failure === 'authorization') throw error('INSUFFICIENT_SCOPE');
      return authorized;
    }),
  };
  const admission = {
    admit: jest.fn(async () => {
      if (failure === 'admission') throw error('RATE_LIMITED');
      return { release };
    }),
  };
  const negotiator = {
    negotiate: jest.fn(() => {
      if (failure === 'negotiation') throw error('VALIDATION_FAILED');
      return { protocolVersion: '2026-07-28' as const, era: 'modern' as const };
    }),
  };
  const dispatch = {
    handle: jest.fn(async (_request, context) => {
      if (failure === 'dispatch') throw error('DEPENDENCY_UNAVAILABLE');
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.principal)).toBe(true);
      return Response.json({ ok: true });
    }),
  };
  const pipeline = new McpRequestPipeline({
    expectedResource: resource,
    resourceMetadataUrl:
      'https://resource.mcp.test/.well-known/oauth-protected-resource/ai/v1/mcp',
    maxRequestBytes: 256 * 1024,
    now: () => now,
    verifier,
    authorization,
    admission,
    negotiator,
    dispatch,
    requiredScopes: () => ['learning:read'],
    identityHmacKey: 'pipeline-test-hmac-key-000000000001',
    requestId: () => 'request_pipeline_0001',
    traceId: () => 'trace_pipeline_0001',
    onStage: (stage) => stages.push(stage),
  });
  return {
    pipeline,
    stages,
    release,
    verifier,
    authorization,
    admission,
    negotiator,
    dispatch,
  };
}

describe('MCP authenticated request pipeline', () => {
  it('runs the security stages in order and always releases admission', async () => {
    const test = fixture();
    const response = await test.pipeline.handle(
      request(),
      new AbortController().signal,
    );

    expect(response.status).toBe(200);
    expect(test.stages).toEqual([
      'boundary',
      'authentication',
      'authorization',
      'admission',
      'dispatch',
    ]);
    expect(test.negotiator.negotiate).toHaveBeenCalledTimes(1);
    expect(test.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['authentication', ['boundary', 'authentication'], 401],
    ['authorization', ['boundary', 'authentication', 'authorization'], 403],
    ['negotiation', ['boundary', 'authentication', 'authorization'], 400],
    [
      'admission',
      ['boundary', 'authentication', 'authorization', 'admission'],
      429,
    ],
    [
      'dispatch',
      ['boundary', 'authentication', 'authorization', 'admission', 'dispatch'],
      503,
    ],
  ] as const)(
    'stops after a %s failure and emits only a safe error',
    async (failure, expectedStages, status) => {
      const test = fixture(failure);
      const response = await test.pipeline.handle(
        request(),
        new AbortController().signal,
      );
      const payload = await response.json();

      expect(response.status).toBe(status);
      expect(test.stages).toEqual(expectedStages);
      expect(JSON.stringify(payload)).not.toMatch(
        /private detail|stack|token/i,
      );
      expect(test.dispatch.handle).toHaveBeenCalledTimes(
        failure === 'dispatch' ? 1 : 0,
      );
      expect(test.release).toHaveBeenCalledTimes(
        failure === 'dispatch' ? 1 : 0,
      );
    },
  );

  it.each([
    ['missing', undefined],
    ['wrong scheme', 'Basic opaque-token-a'],
    ['whitespace in token', 'Bearer opaque token'],
    ['combined duplicate', 'Bearer token-a, Bearer token-b'],
  ])(
    'rejects %s Authorization before token verification',
    async (_label, authorization) => {
      const test = fixture();
      const response = await test.pipeline.handle(
        request({ authorization: authorization as string }),
        new AbortController().signal,
      );
      expect(response.status).toBe(401);
      expect(test.verifier.verify).not.toHaveBeenCalled();
    },
  );

  it('rejects query/cookie token channels and oversized bodies at the boundary', async () => {
    const query = fixture();
    const queryResponse = await query.pipeline.handle(
      request({ url: `${resource}?access_token=query-secret` }),
      new AbortController().signal,
    );
    expect(queryResponse.status).toBe(400);
    expect(query.verifier.verify).not.toHaveBeenCalled();

    const cookie = fixture();
    const cookieRequest = request();
    cookieRequest.headers.set('cookie', 'access_token=cookie-secret');
    const cookieResponse = await cookie.pipeline.handle(
      cookieRequest,
      new AbortController().signal,
    );
    expect(cookieResponse.status).toBe(400);
    expect(cookie.verifier.verify).not.toHaveBeenCalled();

    const oversized = fixture();
    const oversizedResponse = await oversized.pipeline.handle(
      request({ body: { value: 'x'.repeat(300 * 1024) } }),
      new AbortController().signal,
    );
    expect(oversizedResponse.status).toBe(413);
    expect(oversized.verifier.verify).not.toHaveBeenCalled();
  });
});
