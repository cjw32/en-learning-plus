import { Client } from '@modelcontextprotocol/client';
import {
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
  type McpSupportedProtocolVersion,
} from '@en/common/mcp';

export const MCP_TEST_SCOPES = Object.freeze([
  'learning:read',
  'quiz:create',
  'answer:submit',
] as const);

export type McpTestScope = (typeof MCP_TEST_SCOPES)[number];

export type FakeMcpTokenClaims = Readonly<{
  issuer: string;
  subject: string;
  audience: string;
  clientId: string;
  scopes: readonly McpTestScope[];
  issuedAtEpochSeconds: number;
  notBeforeEpochSeconds: number;
  expiresAtEpochSeconds: number;
  active: true;
  authorizationVersion: number;
}>;

export class FakeMcpClock {
  private currentTime: Date;

  constructor(initialTime = new Date('2026-09-11T08:00:00.000Z')) {
    this.currentTime = new Date(initialTime);
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  advanceBy(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new Error('Fake MCP clock advances must be non-negative integers');
    }
    this.currentTime = new Date(this.currentTime.getTime() + milliseconds);
  }
}

export class FakeMcpIssuer {
  private readonly issuedTokens = new Map<string, FakeMcpTokenClaims>();
  private tokenSequence = 0;

  readonly networkRequestCount = 0;

  constructor(
    readonly issuer = 'https://issuer.mcp.test',
    readonly audience = 'https://resource.mcp.test/ai/v1/mcp',
  ) {}

  issueToken(
    input: Readonly<{
      subject: string;
      clientId: string;
      scopes: readonly McpTestScope[];
      now: Date;
      lifetimeSeconds?: number;
      authorizationVersion?: number;
    }>,
  ): Readonly<{ accessToken: string; claims: FakeMcpTokenClaims }> {
    this.tokenSequence += 1;
    const issuedAtEpochSeconds = Math.floor(input.now.getTime() / 1000);
    const claims = Object.freeze({
      issuer: this.issuer,
      subject: input.subject,
      audience: this.audience,
      clientId: input.clientId,
      scopes: Object.freeze([...input.scopes]),
      issuedAtEpochSeconds,
      notBeforeEpochSeconds: issuedAtEpochSeconds,
      expiresAtEpochSeconds:
        issuedAtEpochSeconds + (input.lifetimeSeconds ?? 3_600),
      active: true as const,
      authorizationVersion: input.authorizationVersion ?? 1,
    });
    const accessToken = `fake-mcp-access-token-${this.tokenSequence}`;
    this.issuedTokens.set(accessToken, claims);
    return Object.freeze({ accessToken, claims });
  }

  verifyLocally(accessToken: string): FakeMcpTokenClaims {
    const claims = this.issuedTokens.get(accessToken);
    if (!claims) throw new Error('Unknown fake MCP access token');
    return claims;
  }
}

export type FakeMcpClient = Readonly<{
  clientId: string;
  protocolVersion: McpSupportedProtocolVersion;
  sdkClient: Client;
  networkRequestCount: 0;
}>;

function createFakeMcpClient(
  clientId: string,
  protocolVersion: McpSupportedProtocolVersion,
): FakeMcpClient {
  const modern = protocolVersion === MCP_MODERN_PROTOCOL_VERSION;
  const sdkClient = new Client(
    { name: clientId, version: 'mcp-test.v1' },
    {
      versionNegotiation: {
        mode: modern ? { pin: MCP_MODERN_PROTOCOL_VERSION } : 'legacy',
      },
    },
  );

  return Object.freeze({
    clientId,
    protocolVersion,
    sdkClient,
    networkRequestCount: 0 as const,
  });
}

export type SeededMcpUser = Readonly<{
  userId: string;
  subject: string;
  clientId: string;
  scopes: readonly McpTestScope[];
  accessToken: string;
  claims: FakeMcpTokenClaims;
}>;

export type McpTestEnvironment = Readonly<{
  clock: FakeMcpClock;
  issuer: FakeMcpIssuer;
  users: Readonly<{
    userA: SeededMcpUser;
    userB: SeededMcpUser;
  }>;
  clients: Readonly<{
    modern: FakeMcpClient;
    legacy: FakeMcpClient;
  }>;
}>;

function seedUser(
  issuer: FakeMcpIssuer,
  clock: FakeMcpClock,
  input: Omit<SeededMcpUser, 'accessToken' | 'claims'>,
): SeededMcpUser {
  const issued = issuer.issueToken({
    subject: input.subject,
    clientId: input.clientId,
    scopes: input.scopes,
    now: clock.now(),
  });
  return Object.freeze({ ...input, ...issued });
}

export function createMcpTestEnvironment(): McpTestEnvironment {
  const clock = new FakeMcpClock();
  const issuer = new FakeMcpIssuer();
  const userA = seedUser(issuer, clock, {
    userId: 'mcp-test-user-a',
    subject: 'mcp-test-subject-a',
    clientId: 'mcp-test-modern-client-a',
    scopes: Object.freeze(['learning:read', 'quiz:create'] as const),
  });
  const userB = seedUser(issuer, clock, {
    userId: 'mcp-test-user-b',
    subject: 'mcp-test-subject-b',
    clientId: 'mcp-test-legacy-client-b',
    scopes: Object.freeze(['learning:read', 'answer:submit'] as const),
  });

  return Object.freeze({
    clock,
    issuer,
    users: Object.freeze({ userA, userB }),
    clients: Object.freeze({
      modern: createFakeMcpClient(userA.clientId, MCP_MODERN_PROTOCOL_VERSION),
      legacy: createFakeMcpClient(userB.clientId, MCP_LEGACY_PROTOCOL_VERSION),
    }),
  });
}
