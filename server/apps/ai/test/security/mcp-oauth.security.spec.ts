import {
  createSign,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type Verifier = {
  verify(
    token: string,
    expectedResource: string,
    now: Date,
  ): Promise<{
    issuer: string;
    subject: string;
    audience: string;
    clientId: string;
    scopes: readonly string[];
    authorizationVersion: number;
    tokenType: 'mcp_access';
  }>;
};

type VerifierModule = {
  OidcMcpAccessTokenVerifier: new (options: {
    issuer: string;
    audience: string;
    jwksUri: string;
    authorizedClientIds: readonly string[];
    fetchJson: (url: string, signal: AbortSignal) => Promise<unknown>;
    isRevoked: (input: {
      issuer: string;
      subject: string;
      clientId: string;
      tokenId: string;
    }) => Promise<boolean>;
    requestTimeoutMs: number;
  }) => Verifier;
};

type ProtectedResourceModule = {
  buildMcpProtectedResourceMetadata: (input: {
    resource: string;
    authorizationServers: readonly string[];
    scopesSupported: readonly string[];
  }) => unknown;
  buildMcpBearerChallenge: (input: {
    resourceMetadataUrl: string;
    error?: 'invalid_token' | 'insufficient_scope';
    requiredScopes?: readonly string[];
  }) => string;
};

const oauthRoot = resolve(__dirname, '../../src/mcp/auth');

function loadVerifier(): VerifierModule {
  const file = 'oidc-mcp-access-token-verifier.ts';
  if (!existsSync(resolve(oauthRoot, file))) {
    throw new Error(`Missing MCP OAuth boundary: ${file} (T034)`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(resolve(oauthRoot, file)) as VerifierModule;
}

function loadProtectedResource(): ProtectedResourceModule {
  const file = 'mcp-protected-resource.controller.ts';
  if (!existsSync(resolve(oauthRoot, file))) {
    throw new Error(`Missing MCP OAuth boundary: ${file} (T033)`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(resolve(oauthRoot, file)) as ProtectedResourceModule;
}

const issuer = 'https://issuer.mcp.test';
const resource = 'https://resource.mcp.test/ai/v1/mcp';
const jwksUri = `${issuer}/.well-known/jwks.json`;
const now = new Date('2026-09-11T08:00:00.000Z');
const nowEpoch = Math.floor(now.getTime() / 1_000);
const keyId = 'mcp-test-key-1';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signedToken(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  signingKey: KeyObject = privateKey,
): string {
  const protectedHeader = base64url({
    alg: 'RS256',
    typ: 'JWT',
    kid: keyId,
    ...header,
  });
  const payload = base64url({
    iss: issuer,
    sub: 'immutable-subject-a',
    aud: resource,
    client_id: 'approved-client-a',
    scope: 'learning:read quiz:create',
    iat: nowEpoch - 60,
    nbf: nowEpoch - 60,
    exp: nowEpoch + 3_600,
    jti: 'token-id-a',
    token_use: 'mcp_access',
    authorization_version: 3,
    ...claims,
  });
  const signingInput = `${protectedHeader}.${payload}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(signingKey)
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

function publicJwk(): JsonWebKey & { kid: string; alg: string; use: string } {
  return {
    ...(publicKey.export({ format: 'jwk' }) as JsonWebKey),
    kid: keyId,
    alg: 'RS256',
    use: 'sig',
  };
}

function fixture(
  overrides: {
    revoked?: boolean;
    fetchFailure?: Error;
    keys?: unknown[];
  } = {},
) {
  const fetchJson = jest.fn(async (url: string, signal: AbortSignal) => {
    expect(url).toBe(jwksUri);
    expect(signal).toBeInstanceOf(AbortSignal);
    if (overrides.fetchFailure) throw overrides.fetchFailure;
    return { keys: overrides.keys ?? [publicJwk()] };
  });
  const isRevoked = jest.fn(async () => overrides.revoked ?? false);
  const { OidcMcpAccessTokenVerifier } = loadVerifier();
  const verifier = new OidcMcpAccessTokenVerifier({
    issuer,
    audience: resource,
    jwksUri,
    authorizedClientIds: ['approved-client-a'],
    fetchJson,
    isRevoked,
    requestTimeoutMs: 1_000,
  });
  return { verifier, fetchJson, isRevoked };
}

describe('MCP OAuth 2.1/OIDC resource-server boundary', () => {
  it('accepts a signed, intended, active MCP access token', async () => {
    const test = fixture();
    await expect(
      test.verifier.verify(signedToken(), resource, now),
    ).resolves.toMatchObject({
      issuer,
      subject: 'immutable-subject-a',
      audience: resource,
      clientId: 'approved-client-a',
      scopes: ['learning:read', 'quiz:create'],
      authorizationVersion: 3,
      tokenType: 'mcp_access',
    });
    expect(test.fetchJson).toHaveBeenCalledTimes(1);
    expect(test.isRevoked).toHaveBeenCalledWith({
      issuer,
      subject: 'immutable-subject-a',
      clientId: 'approved-client-a',
      tokenId: 'token-id-a',
    });
  });

  it.each([
    ['malformed', 'not-a-jwt'],
    ['wrong issuer', signedToken({ iss: 'https://wrong-issuer.test' })],
    ['wrong audience', signedToken({ aud: 'https://wrong-resource.test' })],
    ['expired', signedToken({ exp: nowEpoch })],
    ['not yet valid', signedToken({ nbf: nowEpoch + 1 })],
    ['wrong client', signedToken({ client_id: 'unapproved-client' })],
    ['missing subject', signedToken({ sub: '' })],
    ['missing scope', signedToken({ scope: '' })],
    ['ordinary web JWT', signedToken({ token_use: 'web' })],
    ['unknown key', signedToken({}, { kid: 'unknown-key' })],
  ])('denies %s before downstream work', async (_label, token) => {
    const test = fixture();
    const downstream = jest.fn();
    await expect(
      test.verifier.verify(token, resource, now).then(downstream),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(downstream).not.toHaveBeenCalled();
  });

  it('fails closed for revocation and JWKS dependency failures', async () => {
    const revoked = fixture({ revoked: true });
    await expect(
      revoked.verifier.verify(signedToken(), resource, now),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const unavailable = fixture({
      fetchFailure: new Error('JWKS_CANARY_SECRET'),
    });
    await expect(
      unavailable.verifier.verify(signedToken(), resource, now),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('publishes safe protected-resource metadata and bounded Bearer challenges', () => {
    const oauth = loadProtectedResource();
    const metadata = oauth.buildMcpProtectedResourceMetadata({
      resource,
      authorizationServers: [issuer],
      scopesSupported: ['learning:read', 'quiz:create', 'answer:submit'],
    });
    const challenge = oauth.buildMcpBearerChallenge({
      resourceMetadataUrl:
        'https://resource.mcp.test/.well-known/oauth-protected-resource/ai/v1/mcp',
      error: 'insufficient_scope',
      requiredScopes: ['answer:submit'],
    });

    expect(metadata).toEqual({
      resource,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['learning:read', 'quiz:create', 'answer:submit'],
    });
    expect(challenge).toContain('Bearer ');
    expect(challenge).toContain('resource_metadata=');
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="answer:submit"');
    expect(JSON.stringify({ metadata, challenge })).not.toMatch(
      /immutable-subject|token-id|privateKey|JWKS_CANARY_SECRET/i,
    );
  });
});
