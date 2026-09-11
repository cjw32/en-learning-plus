import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type VerifiedToken = Readonly<{
  issuer: string;
  subject: string;
  audience: string;
  clientId: string;
  scopes: readonly string[];
  issuedAtEpochSeconds: number;
  notBeforeEpochSeconds: number;
  expiresAtEpochSeconds: number;
  active: boolean;
  authorizationVersion: number;
  verificationMethodVersion: string;
  tokenType: 'mcp_access';
}>;

type AuthModule = {
  FakeMcpAccessTokenVerifier: new (input: {
    approvedIssuer: string;
    tokens: Readonly<Record<string, VerifiedToken>>;
  }) => {
    verify: (
      token: string,
      expectedResource: string,
      now: Date,
    ) => Promise<VerifiedToken>;
    networkRequestCount: number;
  };
  createMcpPrincipal: (token: VerifiedToken) => Readonly<{
    issuer: string;
    subject: string;
    audience: string;
    clientId: string;
    scopes: readonly string[];
    authorizationVersion: number;
  }>;
  createMcpRequestContext: (input: {
    principal: ReturnType<AuthModule['createMcpPrincipal']>;
    userId: string;
    authorizationId: string;
    requestId: string;
    traceId: string;
    protocolVersion: '2026-07-28' | '2025-11-25';
  }) => Readonly<{
    principal: ReturnType<AuthModule['createMcpPrincipal']>;
    userId: string;
    authorizationId: string;
    requestId: string;
    traceId: string;
    protocolVersion: string;
  }>;
};

const authRoot = resolve(__dirname, '../../src/mcp/auth');

function loadAuth(): AuthModule {
  for (const file of [
    'mcp-access-token-verifier.ts',
    'mcp-principal.ts',
    'fake-mcp-access-token-verifier.ts',
  ]) {
    if (!existsSync(resolve(authRoot, file))) {
      throw new Error(`Missing MCP authentication boundary: ${file} (T022)`);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return {
    ...require(resolve(authRoot, 'mcp-principal.ts')),
    ...require(resolve(authRoot, 'fake-mcp-access-token-verifier.ts')),
  } as AuthModule;
}

const now = new Date('2026-09-11T08:00:00.000Z');
const nowEpoch = Math.floor(now.getTime() / 1000);
const resource = 'https://resource.mcp.test/ai/v1/mcp';
const issuer = 'https://issuer.mcp.test';

function token(overrides: Partial<VerifiedToken> = {}): VerifiedToken {
  return Object.freeze({
    issuer,
    subject: 'immutable-subject-a',
    audience: resource,
    clientId: 'oauth-client-a',
    scopes: Object.freeze(['learning:read']),
    issuedAtEpochSeconds: nowEpoch - 60,
    notBeforeEpochSeconds: nowEpoch - 60,
    expiresAtEpochSeconds: nowEpoch + 3_600,
    active: true,
    authorizationVersion: 1,
    verificationMethodVersion: 'fake-local.v1',
    tokenType: 'mcp_access',
    ...overrides,
  });
}

describe('MCP token verification and immutable context', () => {
  it('freezes verified identity, scopes, and request ownership fields', async () => {
    const auth = loadAuth();
    const verifier = new auth.FakeMcpAccessTokenVerifier({
      approvedIssuer: issuer,
      tokens: { 'valid-mcp-token': token() },
    });
    const verified = await verifier.verify('valid-mcp-token', resource, now);
    const principal = auth.createMcpPrincipal(verified);
    const context = auth.createMcpRequestContext({
      principal,
      userId: 'local-user-a',
      authorizationId: 'authorization-a',
      requestId: 'request-auth-0001',
      traceId: 'trace_auth_0001',
      protocolVersion: '2026-07-28',
    });

    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.scopes)).toBe(true);
    expect(Object.isFrozen(context)).toBe(true);
    expect(context).toMatchObject({
      userId: 'local-user-a',
      authorizationId: 'authorization-a',
      principal: {
        issuer,
        subject: 'immutable-subject-a',
        clientId: 'oauth-client-a',
      },
    });
    expect(() => {
      (context as { userId: string }).userId = 'attacker-user';
    }).toThrow();
    expect(verifier.networkRequestCount).toBe(0);
  });

  it.each([
    ['malformed', 'malformed token', token()],
    ['expired', 'expired-token', token({ expiresAtEpochSeconds: nowEpoch })],
    [
      'not yet valid',
      'future-token',
      token({ notBeforeEpochSeconds: nowEpoch + 1 }),
    ],
    [
      'wrong audience',
      'wrong-audience-token',
      token({ audience: 'https://other-resource.mcp.test' }),
    ],
    [
      'wrong issuer',
      'wrong-issuer-token',
      token({ issuer: 'https://unapproved-issuer.mcp.test' }),
    ],
    ['revoked', 'revoked-token', token({ active: false })],
    ['ordinary web JWT', 'web-jwt-token', token({ tokenType: 'web' as never })],
  ])(
    'rejects %s before downstream work',
    async (_case, accessToken, claims) => {
      const auth = loadAuth();
      const downstream = jest.fn();
      const verifier = new auth.FakeMcpAccessTokenVerifier({
        approvedIssuer: issuer,
        tokens: { [accessToken]: claims },
      });

      await expect(
        verifier.verify(accessToken, resource, now).then(downstream),
      ).rejects.toThrow();
      expect(downstream).not.toHaveBeenCalled();
    },
  );
});
