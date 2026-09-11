import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';
import { MCP_LEGACY_PROTOCOL_VERSION } from '@en/common/mcp';

export type McpLegacyIdentity = Readonly<{
  issuer: string;
  subjectHmac: string;
  clientHmac: string;
  authorizationId: string;
  authorizationVersion: number;
  tokenExpiresAt: Date;
}>;

export type McpStoredSession = Readonly<{
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

export interface McpLegacySessionStore {
  save(session: McpStoredSession): Promise<void>;
  load(sessionId: string): Promise<McpStoredSession | null>;
  delete(sessionId: string): Promise<void>;
}

export interface McpRedisSessionClient {
  set(
    key: string,
    value: string,
    mode: 'PX',
    milliseconds: number,
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

type RedisMcpLegacySessionStoreOptions = Readonly<{
  now?: () => Date;
  keyPrefix?: string;
}>;

export class RedisMcpLegacySessionStore implements McpLegacySessionStore {
  private readonly now: () => Date;
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: McpRedisSessionClient,
    options: RedisMcpLegacySessionStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.keyPrefix = options.keyPrefix ?? 'mcp:legacy:session:';
  }

  async save(session: McpStoredSession): Promise<void> {
    const ttlMs = session.expiresAt.getTime() - this.now().getTime();
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      await this.delete(session.sessionId);
      return;
    }
    await this.redis.set(
      this.key(session.sessionId),
      JSON.stringify({
        ...session,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      }),
      'PX',
      ttlMs,
    );
  }

  async load(sessionId: string): Promise<McpStoredSession | null> {
    const encoded = await this.redis.get(this.key(sessionId));
    if (encoded === null) return null;
    try {
      const parsed = JSON.parse(encoded) as Record<string, unknown>;
      const session = Object.freeze({
        sessionId: requiredString(parsed.sessionId),
        issuer: requiredString(parsed.issuer),
        subjectHmac: requiredString(parsed.subjectHmac),
        clientHmac: requiredString(parsed.clientHmac),
        authorizationId: requiredString(parsed.authorizationId),
        authorizationVersion: requiredPositiveInteger(
          parsed.authorizationVersion,
        ),
        createdAt: requiredDate(parsed.createdAt),
        lastSeenAt: requiredDate(parsed.lastSeenAt),
        expiresAt: requiredDate(parsed.expiresAt),
      });
      if (session.sessionId !== sessionId) throw new Error('Session mismatch');
      return session;
    } catch {
      throw new Error('Invalid MCP session binding');
    }
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  private key(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }
}

export type McpLegacySessionManagerOptions = Readonly<{
  createServer: () => McpServer | Promise<McpServer>;
  store: McpLegacySessionStore;
  now: () => Date;
  sessionId: () => string;
  idleTtlMs: number;
  absoluteTtlMs: number;
}>;

type LiveSession = Readonly<{
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}>;

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid string');
  }
  return value;
}

function requiredPositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error('Invalid integer');
  }
  return Number(value);
}

function requiredDate(value: unknown): Date {
  const date = new Date(requiredString(value));
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date');
  return date;
}

const jsonRpcError = (
  status: number,
  code: number,
  message: string,
  id: string | number | null = null,
) =>
  Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status });

function identityMatches(
  session: McpStoredSession,
  identity: McpLegacyIdentity,
): boolean {
  return (
    session.issuer === identity.issuer &&
    session.subjectHmac === identity.subjectHmac &&
    session.clientHmac === identity.clientHmac &&
    session.authorizationId === identity.authorizationId &&
    session.authorizationVersion === identity.authorizationVersion
  );
}

async function readJson(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.clone().json();
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export class McpLegacySessionManager {
  private readonly liveSessions = new Map<string, LiveSession>();

  constructor(private readonly options: McpLegacySessionManagerOptions) {}

  async handle(
    request: Request,
    identity: McpLegacyIdentity,
  ): Promise<Response> {
    if (!['POST', 'GET', 'DELETE'].includes(request.method)) {
      return new Response('Method not allowed.', {
        status: 405,
        headers: { allow: 'POST, GET, DELETE' },
      });
    }

    const sessionId = request.headers.get('mcp-session-id');
    if (!sessionId) {
      return this.handleInitialize(request, identity);
    }

    return this.handleSessionRequest(request, identity, sessionId);
  }

  async close(): Promise<void> {
    const sessions = [...this.liveSessions.entries()];
    this.liveSessions.clear();
    await Promise.allSettled(
      sessions.flatMap(([sessionId, session]) => [
        session.server.close(),
        this.options.store.delete(sessionId),
      ]),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private async handleInitialize(
    request: Request,
    identity: McpLegacyIdentity,
  ): Promise<Response> {
    if (request.method !== 'POST') {
      return jsonRpcError(400, -32600, 'Invalid Request');
    }

    const body = await readJson(request);
    const params =
      body?.params &&
      typeof body.params === 'object' &&
      !Array.isArray(body.params)
        ? (body.params as Record<string, unknown>)
        : null;
    const id =
      typeof body?.id === 'string' || typeof body?.id === 'number'
        ? body.id
        : null;
    if (
      body?.method !== 'initialize' ||
      params?.protocolVersion !== MCP_LEGACY_PROTOCOL_VERSION ||
      request.headers.has('mcp-protocol-version')
    ) {
      return jsonRpcError(400, -32600, 'Invalid Request', id);
    }

    const now = this.options.now();
    const tokenExpiryMs = identity.tokenExpiresAt.getTime();
    if (!Number.isFinite(tokenExpiryMs) || tokenExpiryMs <= now.getTime()) {
      return jsonRpcError(401, -32001, 'Authentication is required.', id);
    }

    const sessionId = this.options.sessionId();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      enableJsonResponse: true,
      keepAliveMs: 0,
      supportedProtocolVersions: [MCP_LEGACY_PROTOCOL_VERSION],
    });
    const server = await this.options.createServer();
    const live = Object.freeze({ server, transport });
    this.liveSessions.set(sessionId, live);

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      if (
        response.status !== 200 ||
        response.headers.get('mcp-session-id') !== sessionId
      ) {
        await this.disposeLiveSession(sessionId);
        return response;
      }

      const createdAt = new Date(now);
      const expiresAt = new Date(
        Math.min(tokenExpiryMs, now.getTime() + this.options.absoluteTtlMs),
      );
      await this.options.store.save(
        Object.freeze({
          sessionId,
          issuer: identity.issuer,
          subjectHmac: identity.subjectHmac,
          clientHmac: identity.clientHmac,
          authorizationId: identity.authorizationId,
          authorizationVersion: identity.authorizationVersion,
          createdAt,
          lastSeenAt: new Date(now),
          expiresAt,
        }),
      );
      return response;
    } catch {
      await this.disposeLiveSession(sessionId);
      return jsonRpcError(503, -32603, 'Service unavailable.', id);
    }
  }

  private async handleSessionRequest(
    request: Request,
    identity: McpLegacyIdentity,
    sessionId: string,
  ): Promise<Response> {
    if (
      request.headers.get('mcp-protocol-version') !==
      MCP_LEGACY_PROTOCOL_VERSION
    ) {
      return jsonRpcError(400, -32600, 'Invalid Request');
    }

    let stored: McpStoredSession | null;
    try {
      stored = await this.options.store.load(sessionId);
    } catch {
      return jsonRpcError(503, -32603, 'Service unavailable.');
    }

    const live = this.liveSessions.get(sessionId);
    if (!stored || !live) {
      if (!stored) await this.disposeLiveSession(sessionId);
      return jsonRpcError(404, -32001, 'Session not found.');
    }

    const now = this.options.now();
    const nowMs = now.getTime();
    const expired =
      nowMs >= stored.expiresAt.getTime() ||
      nowMs >= identity.tokenExpiresAt.getTime() ||
      nowMs - stored.lastSeenAt.getTime() >= this.options.idleTtlMs;
    if (expired || !identityMatches(stored, identity)) {
      await this.revokeSession(sessionId);
      return jsonRpcError(404, -32001, 'Session not found.');
    }

    const refreshed = Object.freeze({ ...stored, lastSeenAt: new Date(now) });
    try {
      await this.options.store.save(refreshed);
    } catch {
      return jsonRpcError(503, -32603, 'Service unavailable.');
    }

    try {
      const response = await live.transport.handleRequest(request);
      if (request.method === 'DELETE') {
        await this.revokeSession(sessionId);
      }
      return response;
    } catch {
      return jsonRpcError(503, -32603, 'Service unavailable.');
    }
  }

  private async revokeSession(sessionId: string): Promise<void> {
    await Promise.allSettled([
      this.options.store.delete(sessionId),
      this.disposeLiveSession(sessionId),
    ]);
  }

  private async disposeLiveSession(sessionId: string): Promise<void> {
    const live = this.liveSessions.get(sessionId);
    this.liveSessions.delete(sessionId);
    if (live) await live.server.close().catch(() => undefined);
  }
}
