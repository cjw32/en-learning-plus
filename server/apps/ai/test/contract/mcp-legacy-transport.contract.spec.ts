import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type LegacyIdentity = Readonly<{
  issuer: string;
  subjectHmac: string;
  clientHmac: string;
  authorizationId: string;
  authorizationVersion: number;
  tokenExpiresAt: Date;
}>;

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

type SessionStore = {
  save(session: StoredSession): Promise<void>;
  load(sessionId: string): Promise<StoredSession | null>;
  delete(sessionId: string): Promise<void>;
};

type LegacyManager = {
  handle(request: Request, identity: LegacyIdentity): Promise<Response>;
  close(): Promise<void>;
};

type RedisStore = new (
  redis: {
    set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<void>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<void>;
  },
  options: { now: () => Date },
) => SessionStore;

type McpServer = {
  registerTool(
    name: string,
    config: { description: string },
    callback: () => Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }>,
  ): unknown;
};

type Sdk = {
  McpServer: new (info: { name: string; version: string }) => McpServer;
  preloadSchemas(): Promise<void>;
  specTypeSchemas: Record<
    string,
    { safeParse(value: unknown): { success: boolean } }
  >;
};

const implementationPath = resolve(
  __dirname,
  '../../src/mcp/transport/mcp-legacy-session.manager.ts',
);

function loadManager(): new (options: {
  createServer: () => McpServer;
  store: SessionStore;
  now: () => Date;
  sessionId: () => string;
  idleTtlMs: number;
  absoluteTtlMs: number;
}) => LegacyManager {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing legacy MCP session manager (T038)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(implementationPath).McpLegacySessionManager;
}

function loadRedisStore(): RedisStore {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing legacy MCP Redis session store (T038)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(implementationPath).RedisMcpLegacySessionStore;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdk = require('@modelcontextprotocol/server') as Sdk;

const baseTime = new Date('2026-09-11T08:00:00.000Z');
let currentTime = baseTime;
let nextSession = 0;

const identity: LegacyIdentity = Object.freeze({
  issuer: 'https://issuer.mcp.test',
  subjectHmac: 'subject_hash_a',
  clientHmac: 'client_hash_a',
  authorizationId: 'authorization-a',
  authorizationVersion: 3,
  tokenExpiresAt: new Date(baseTime.getTime() + 2 * 60 * 60 * 1_000),
});

class MemorySessionStore implements SessionStore {
  readonly sessions = new Map<string, StoredSession>();

  async save(session: StoredSession) {
    this.sessions.set(session.sessionId, Object.freeze({ ...session }));
  }

  async load(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  async delete(sessionId: string) {
    this.sessions.delete(sessionId);
  }
}

class ToggleFailureSessionStore extends MemorySessionStore {
  failReads = false;

  override async load(sessionId: string) {
    if (this.failReads) throw new Error('redis unavailable');
    return super.load(sessionId);
  }
}

function post(body: unknown, sessionId?: string, version = '2025-11-25') {
  return new Request('https://resource.mcp.test/ai/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      ...(sessionId ? { 'mcp-protocol-version': version } : {}),
    },
    body: JSON.stringify(body),
  });
}

function initialize(version = '2025-11-25') {
  return post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: version,
      capabilities: {},
      clientInfo: { name: 'legacy-contract-client', version: '1.0.0' },
    },
  });
}

function listTools(sessionId?: string) {
  return post(
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    sessionId,
  );
}

function sessionRequest(method: 'GET' | 'DELETE', sessionId: string) {
  return new Request('https://resource.mcp.test/ai/v1/mcp', {
    method,
    headers: {
      accept: 'text/event-stream',
      'mcp-session-id': sessionId,
      'mcp-protocol-version': '2025-11-25',
    },
  });
}

function fixture(store = new MemorySessionStore()) {
  const createdServers: McpServer[] = [];
  const Manager = loadManager();
  const manager = new Manager({
    store,
    now: () => currentTime,
    sessionId: () => `legacy_${String(++nextSession).padStart(24, '0')}`,
    idleTtlMs: 15 * 60 * 1_000,
    absoluteTtlMs: 60 * 60 * 1_000,
    createServer: () => {
      const server = new sdk.McpServer({
        name: 'english-learning-mcp',
        version: '1.0.0',
      });
      server.registerTool(
        'search_words',
        { description: 'Search words' },
        async () => ({ content: [{ type: 'text', text: '[]' }] }),
      );
      createdServers.push(server);
      return server;
    },
  });
  return { manager, store, createdServers };
}

async function initializeSession(manager: LegacyManager) {
  const response = await manager.handle(initialize(), identity);
  const sessionId = response.headers.get('mcp-session-id');
  expect(response.status).toBe(200);
  expect(sessionId).toMatch(/^legacy_[A-Za-z0-9_-]{20,}$/);
  const payload = await response.json();
  expect(sdk.specTypeSchemas.JSONRPCMessage.safeParse(payload).success).toBe(
    true,
  );
  expect(
    sdk.specTypeSchemas.InitializeResult.safeParse((payload as any).result)
      .success,
  ).toBe(true);
  return sessionId!;
}

describe('MCP 2025-11-25 initialized-session transport contract', () => {
  beforeAll(async () => sdk.preloadSchemas());

  beforeEach(() => {
    currentTime = baseTime;
    nextSession = 0;
  });

  it('initializes one opaque identity-bound session and supports later POST', async () => {
    const test = fixture();
    try {
      const sessionId = await initializeSession(test.manager);
      expect(sessionId).not.toContain(identity.subjectHmac);
      expect(sessionId).not.toContain(identity.clientHmac);

      const initialized = await test.manager.handle(
        post(
          { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
          sessionId,
        ),
        identity,
      );
      expect(initialized.status).toBe(202);

      const response = await test.manager.handle(
        listTools(sessionId),
        identity,
      );
      const payload = (await response.json()) as any;
      expect(response.status).toBe(200);
      expect(
        sdk.specTypeSchemas.ListToolsResult.safeParse(payload.result).success,
      ).toBe(true);
      expect(payload.result.tools).toEqual([
        expect.objectContaining({ name: 'search_words' }),
      ]);
      expect(test.createdServers).toHaveLength(1);
    } finally {
      await test.manager.close();
    }
  });

  it('rejects calls before initialize and rejects earlier/unknown versions without allocation', async () => {
    const test = fixture();
    try {
      await expect(
        test.manager.handle(listTools(), identity),
      ).resolves.toMatchObject({
        status: 400,
      });
      for (const version of ['2025-06-18', '2026-07-28', '2099-12-31']) {
        const response = await test.manager.handle(
          initialize(version),
          identity,
        );
        expect(response.status).toBe(400);
        expect(response.headers.get('mcp-session-id')).toBeNull();
      }
      expect(test.store.sessions.size).toBe(0);
      expect(test.createdServers).toHaveLength(0);
    } finally {
      await test.manager.close();
    }
  });

  it('supports GET and DELETE for the initialized session', async () => {
    const test = fixture();
    try {
      const sessionId = await initializeSession(test.manager);
      const getResponse = await test.manager.handle(
        sessionRequest('GET', sessionId),
        identity,
      );
      expect(getResponse.status).toBe(200);
      expect(getResponse.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      await getResponse.body?.cancel();

      const deleteResponse = await test.manager.handle(
        sessionRequest('DELETE', sessionId),
        identity,
      );
      expect(deleteResponse.status).toBe(200);
      expect(test.store.sessions.has(sessionId)).toBe(false);
      await expect(
        test.manager.handle(listTools(sessionId), identity),
      ).resolves.toMatchObject({ status: 404 });
    } finally {
      await test.manager.close();
    }
  });

  it('rejects subject, client, grant-version, and authorization swaps', async () => {
    const test = fixture();
    try {
      const sessionId = await initializeSession(test.manager);
      for (const changed of [
        { subjectHmac: 'subject_hash_b' },
        { clientHmac: 'client_hash_b' },
        { authorizationId: 'authorization-b' },
        { authorizationVersion: identity.authorizationVersion + 1 },
      ]) {
        const response = await test.manager.handle(listTools(sessionId), {
          ...identity,
          ...changed,
        });
        expect(response.status).toBe(404);
      }
    } finally {
      await test.manager.close();
    }
  });

  it('fails closed when the durable binding is revoked or its store is unavailable', async () => {
    const revoked = fixture();
    try {
      const sessionId = await initializeSession(revoked.manager);
      await revoked.store.delete(sessionId);
      await expect(
        revoked.manager.handle(listTools(sessionId), identity),
      ).resolves.toMatchObject({ status: 404 });
    } finally {
      await revoked.manager.close();
    }

    const unavailableStore = new ToggleFailureSessionStore();
    const unavailable = fixture(unavailableStore);
    try {
      const sessionId = await initializeSession(unavailable.manager);
      unavailableStore.failReads = true;
      await expect(
        unavailable.manager.handle(listTools(sessionId), identity),
      ).resolves.toMatchObject({ status: 503 });
    } finally {
      unavailableStore.failReads = false;
      await unavailable.manager.close();
    }
  });

  it('persists only bounded HMAC identity binding fields through the Redis adapter', async () => {
    const values = new Map<string, string>();
    const redis = {
      set: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      get: jest.fn(async (key: string) => values.get(key) ?? null),
      del: jest.fn(async (key: string) => {
        values.delete(key);
      }),
    };
    const Store = loadRedisStore();
    const store = new Store(redis, { now: () => baseTime });
    const stored: StoredSession = Object.freeze({
      sessionId: 'legacy_000000000000000000000001',
      issuer: identity.issuer,
      subjectHmac: identity.subjectHmac,
      clientHmac: identity.clientHmac,
      authorizationId: identity.authorizationId,
      authorizationVersion: identity.authorizationVersion,
      createdAt: baseTime,
      lastSeenAt: baseTime,
      expiresAt: new Date(baseTime.getTime() + 60_000),
    });

    await store.save(stored);
    const encoded = [...values.values()][0];
    expect(encoded).toContain(identity.subjectHmac);
    expect(encoded).toContain(identity.clientHmac);
    expect(encoded).not.toMatch(/bearer|access[_-]?token|rawSubject/i);
    expect(redis.set).toHaveBeenCalledWith(
      `mcp:legacy:session:${stored.sessionId}`,
      expect.any(String),
      'PX',
      60_000,
    );
    await expect(store.load(stored.sessionId)).resolves.toEqual(stored);
  });

  it('expires at 15 minutes idle and min(token expiry, one hour) absolute', async () => {
    const idle = fixture();
    try {
      const idleSessionId = await initializeSession(idle.manager);
      currentTime = new Date(baseTime.getTime() + 15 * 60 * 1_000 + 1);
      await expect(
        idle.manager.handle(listTools(idleSessionId), identity),
      ).resolves.toMatchObject({ status: 404 });
    } finally {
      await idle.manager.close();
    }

    currentTime = baseTime;
    const absolute = fixture();
    try {
      const absoluteSessionId = await initializeSession(absolute.manager);
      currentTime = new Date(baseTime.getTime() + 60 * 60 * 1_000 + 1);
      await expect(
        absolute.manager.handle(listTools(absoluteSessionId), identity),
      ).resolves.toMatchObject({ status: 404 });
    } finally {
      await absolute.manager.close();
    }

    currentTime = baseTime;
    const tokenBound = fixture();
    try {
      const shortTokenIdentity = {
        ...identity,
        tokenExpiresAt: new Date(baseTime.getTime() + 5 * 60 * 1_000),
      };
      const response = await tokenBound.manager.handle(
        initializeSessionRequest(),
        shortTokenIdentity,
      );
      const sessionId = response.headers.get('mcp-session-id')!;
      currentTime = new Date(baseTime.getTime() + 5 * 60 * 1_000 + 1);
      await expect(
        tokenBound.manager.handle(listTools(sessionId), shortTokenIdentity),
      ).resolves.toMatchObject({ status: 404 });
    } finally {
      await tokenBound.manager.close();
    }
  });
});

function initializeSessionRequest() {
  return initialize();
}
