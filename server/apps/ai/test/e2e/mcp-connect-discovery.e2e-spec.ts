import { createHash } from 'node:crypto';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { McpLegacySessionManager } from '../../src/mcp/transport/mcp-legacy-session.manager';
import { McpModernTransportFactory } from '../../src/mcp/transport/mcp-modern-transport.factory';
import { McpProtocolNegotiator } from '../../src/mcp/transport/mcp-protocol-negotiator';
import { McpRequestPipeline } from '../../src/mcp/transport/mcp-request-pipeline';

const resource = 'https://resource.mcp.test/ai/v1/mcp';
const issuer = 'https://issuer.mcp.test';
const now = new Date('2026-09-11T08:00:00.000Z');
const nowEpoch = Math.floor(now.getTime() / 1_000);

type StoredSession = Readonly<{
  sessionId: string;
  issuer: string;
  subjectHmac: string;
  clientHmac: string;
  authorizationId: string;
  authorizationVersion: number;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}>;

class MemorySessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  async save(session: StoredSession) {
    this.sessions.set(session.sessionId, session);
  }

  async load(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  async delete(sessionId: string) {
    this.sessions.delete(sessionId);
  }
}

function hmac(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createDiscoveryServer(counters: {
  dataRequests: number;
  modelRequests: number;
}) {
  const server = new McpServer({
    name: 'english-learning-mcp',
    version: '0.1.0',
  });
  for (const uri of [
    'en-learning://words/{wordId}',
    'en-learning://courses/{courseId}/materials/{materialId}',
  ]) {
    server.registerResource(
      uri,
      new ResourceTemplate(uri, { list: undefined }),
      {
        description: 'Authorized learning resource',
        mimeType: 'application/json',
      },
      async (requested) => ({
        contents: [
          {
            uri: requested.href,
            mimeType: 'application/json',
            text: '{}',
          },
        ],
      }),
    );
  }
  for (const uri of [
    'en-learning://me/reviews/today',
    'en-learning://me/reports/summary',
    'en-learning://me/weaknesses',
  ]) {
    server.registerResource(
      uri,
      uri,
      {
        description: 'Authorized private learning resource',
        mimeType: 'application/json',
      },
      async (requested) => ({
        contents: [
          {
            uri: requested.href,
            mimeType: 'application/json',
            text: '{}',
          },
        ],
      }),
    );
  }
  for (const name of [
    'search_words',
    'get_due_words',
    'search_learning_materials',
    'create_quiz',
    'submit_answer',
    'get_learning_report',
  ]) {
    server.registerTool(
      name,
      { description: `Authorized tool ${name}` },
      async () => {
        if (name === 'create_quiz' || name === 'submit_answer') {
          counters.modelRequests += 1;
        } else {
          counters.dataRequests += 1;
        }
        return { content: [{ type: 'text' as const, text: '[]' }] };
      },
    );
  }
  for (const name of [
    'english_interview',
    'business_english',
    'vocabulary_review',
  ]) {
    server.registerPrompt(
      name,
      { description: `Authorized prompt ${name}` },
      async () => ({
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: `Use ${name}.` },
          },
        ],
      }),
    );
  }
  return server;
}

function fixture() {
  const counters = { dataRequests: 0, modelRequests: 0 };
  let sessionSequence = 0;
  const tokenState = new Map<
    string,
    { scopes: readonly string[]; active: boolean }
  >([
    ['modern-token', { scopes: ['learning:read'], active: true }],
    ['legacy-token', { scopes: ['learning:read'], active: true }],
    ['wrong-scope-token', { scopes: ['quiz:create'], active: true }],
  ]);
  const createServer = () => createDiscoveryServer(counters);
  const modern = new McpModernTransportFactory({ createServer });
  const legacy = new McpLegacySessionManager({
    createServer,
    store: new MemorySessionStore(),
    now: () => now,
    sessionId: () =>
      `legacy_e2e_${String(++sessionSequence).padStart(24, '0')}`,
    idleTtlMs: 15 * 60 * 1_000,
    absoluteTtlMs: 60 * 60 * 1_000,
  });
  const verifier = {
    verify: jest.fn(async (accessToken: string) => {
      const state = tokenState.get(accessToken);
      if (!state?.active)
        throw Object.assign(new Error('revoked'), { code: 'UNAUTHENTICATED' });
      return Object.freeze({
        issuer,
        subject: `subject-${accessToken}`,
        audience: resource,
        clientId: `client-${accessToken}`,
        scopes: Object.freeze([...state.scopes]) as readonly (
          | 'learning:read'
          | 'quiz:create'
          | 'answer:submit'
        )[],
        authorizationVersion: 1,
        issuedAtEpochSeconds: nowEpoch - 60,
        notBeforeEpochSeconds: nowEpoch - 60,
        expiresAtEpochSeconds: nowEpoch + 3_600,
        verificationMethodVersion: 'e2e.v1',
        tokenType: 'mcp_access' as const,
        active: true,
      });
    }),
  };
  const authorization = {
    authorize: jest.fn(async (principal, requiredScopes: readonly string[]) => {
      if (requiredScopes.some((scope) => !principal.scopes.includes(scope))) {
        throw Object.assign(new Error('scope'), { code: 'INSUFFICIENT_SCOPE' });
      }
      return Object.freeze({
        identity: Object.freeze({
          issuer: principal.issuer,
          subjectHmac: hmac(`${principal.issuer}\0${principal.subject}`),
          userId: `user-${principal.subject}`,
          authorizationId: `authorization-${principal.clientId}`,
          clientId: principal.clientId,
          audience: principal.audience,
          authorizationVersion: principal.authorizationVersion,
        }),
        scopes: Object.freeze([...principal.scopes]),
      });
    }),
  };
  const admission = {
    admit: jest.fn(async () => ({ release: async () => undefined })),
  };
  const pipeline = new McpRequestPipeline({
    expectedResource: resource,
    resourceMetadataUrl:
      'https://resource.mcp.test/.well-known/oauth-protected-resource/ai/v1/mcp',
    maxRequestBytes: 256 * 1024,
    now: () => now,
    verifier,
    authorization: authorization as never,
    admission: admission as never,
    negotiator: new McpProtocolNegotiator(),
    dispatch: {
      handle: async (incoming, context, dispatch) => {
        if (dispatch.negotiation.era === 'modern') {
          return modern.handle(incoming);
        }
        return legacy.handle(incoming, {
          issuer: context.principal.issuer,
          subjectHmac: dispatch.authorization.identity.subjectHmac,
          clientHmac: hmac(context.principal.clientId),
          authorizationId: context.authorizationId,
          authorizationVersion: context.principal.authorizationVersion,
          tokenExpiresAt: new Date(
            context.principal.expiresAtEpochSeconds * 1_000,
          ),
        });
      },
    },
    requiredScopes: () => ['learning:read'],
    identityHmacKey: 'mcp-e2e-pipeline-hmac-key-0000000001',
    requestId: () => `request_e2e_${Math.random()}`,
    traceId: () => `trace_e2e_${Math.random()}`,
  });
  const fetcher = async (
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ) => {
    const incoming = new globalThis.Request(input, init);
    return pipeline.handle(incoming, incoming.signal);
  };
  return {
    counters,
    tokenState,
    modern,
    legacy,
    fetcher,
  };
}

async function connect(
  fetcher: typeof fetch,
  token: string,
  era: 'modern' | 'legacy',
) {
  const client = new Client(
    { name: `${era}-e2e-client`, version: '1.0.0' },
    {
      versionNegotiation:
        era === 'modern' ? { mode: { pin: '2026-07-28' } } : { mode: 'legacy' },
    },
  );
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    authProvider: { token: async () => token },
    fetch: fetcher,
    onInsufficientScope: 'throw',
  });
  await client.connect(transport);
  return { client, transport };
}

describe('official MCP clients connect and discover in process', () => {
  it.each(['modern', 'legacy'] as const)(
    '%s client independently connects and discovers resources, tools, and prompts',
    async (era) => {
      const test = fixture();
      const token = era === 'modern' ? 'modern-token' : 'legacy-token';
      const { client, transport } = await connect(
        test.fetcher as typeof fetch,
        token,
        era,
      );
      try {
        expect(transport.protocolVersion).toBe(
          era === 'modern' ? '2026-07-28' : '2025-11-25',
        );
        const [templates, resources, tools, prompts] = await Promise.all([
          client.listResourceTemplates(),
          client.listResources(),
          client.listTools(),
          client.listPrompts(),
        ]);
        expect(
          templates.resourceTemplates.map(({ uriTemplate }) => uriTemplate),
        ).toEqual([
          'en-learning://words/{wordId}',
          'en-learning://courses/{courseId}/materials/{materialId}',
        ]);
        expect(resources.resources.map(({ uri }) => uri)).toEqual([
          'en-learning://me/reviews/today',
          'en-learning://me/reports/summary',
          'en-learning://me/weaknesses',
        ]);
        expect(tools.tools.map(({ name }) => name)).toEqual([
          'search_words',
          'get_due_words',
          'search_learning_materials',
          'create_quiz',
          'submit_answer',
          'get_learning_report',
        ]);
        expect(prompts.prompts.map(({ name }) => name)).toEqual([
          'english_interview',
          'business_english',
          'vocabulary_review',
        ]);
        expect(test.counters).toEqual({ dataRequests: 0, modelRequests: 0 });
      } finally {
        await client.close();
        await test.modern.close();
        await test.legacy.close();
      }
    },
  );

  it.each(['modern', 'legacy'] as const)(
    'revocation blocks a %s direct call before data or model access',
    async (era) => {
      const test = fixture();
      const token = era === 'modern' ? 'modern-token' : 'legacy-token';
      const { client } = await connect(
        test.fetcher as typeof fetch,
        token,
        era,
      );
      try {
        test.tokenState.set(token, {
          scopes: ['learning:read'],
          active: false,
        });
        await expect(
          client.callTool({ name: 'search_words', arguments: {} }),
        ).rejects.toThrow();
        expect(test.counters).toEqual({ dataRequests: 0, modelRequests: 0 });
      } finally {
        await client.close();
        await test.modern.close();
        await test.legacy.close();
      }
    },
  );

  it.each(['modern', 'legacy'] as const)(
    'wrong-scope %s client fails before connection or capability work',
    async (era) => {
      const test = fixture();
      await expect(
        connect(test.fetcher as typeof fetch, 'wrong-scope-token', era),
      ).rejects.toThrow();
      expect(test.counters).toEqual({ dataRequests: 0, modelRequests: 0 });
      await test.modern.close();
      await test.legacy.close();
    },
  );
});
