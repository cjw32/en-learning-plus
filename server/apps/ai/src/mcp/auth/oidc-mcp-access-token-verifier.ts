import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  MCP_ACCESS_TOKEN_SCOPES,
  McpAccessTokenVerificationError,
  McpAccessTokenVerifier,
  type McpAccessTokenScope,
  type VerifiedMcpAccessToken,
} from './mcp-access-token-verifier';

type RevocationInput = Readonly<{
  issuer: string;
  subject: string;
  clientId: string;
  tokenId: string;
}>;

export type OidcMcpAccessTokenVerifierOptions = Readonly<{
  issuer: string;
  audience: string;
  jwksUri: string;
  authorizedClientIds: readonly string[];
  fetchJson: (url: string, signal: AbortSignal) => Promise<unknown>;
  isRevoked: (input: RevocationInput) => Promise<boolean>;
  requestTimeoutMs: number;
}>;

type JwtHeader = Readonly<{
  alg: 'RS256';
  typ?: 'JWT';
  kid: string;
}>;

type JwtClaims = Readonly<{
  iss: string;
  sub: string;
  aud: string;
  client_id: string;
  scope: string;
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  token_use: 'mcp_access';
  authorization_version: number;
}>;

function fail(): never {
  throw new McpAccessTokenVerificationError();
}

function parseJsonSegment(segment: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]{2,8192}$/.test(segment)) fail();
  try {
    const value = JSON.parse(
      Buffer.from(segment, 'base64url').toString('utf8'),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    return value as Record<string, unknown>;
  } catch {
    return fail();
  }
}

function parseHeader(segment: string): JwtHeader {
  const value = parseJsonSegment(segment);
  if (
    value.alg !== 'RS256' ||
    (value.typ !== undefined && value.typ !== 'JWT') ||
    typeof value.kid !== 'string' ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(value.kid)
  ) {
    fail();
  }
  return value as JwtHeader;
}

function exactInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function parseClaims(segment: string): JwtClaims {
  const value = parseJsonSegment(segment);
  for (const key of [
    'iss',
    'sub',
    'aud',
    'client_id',
    'scope',
    'jti',
    'token_use',
  ] as const) {
    if (typeof value[key] !== 'string') fail();
  }
  for (const key of ['iat', 'nbf', 'exp', 'authorization_version'] as const) {
    if (!exactInteger(value[key])) fail();
  }
  return value as JwtClaims;
}

function parseJwks(value: unknown, keyId: string): JsonWebKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const keys = (value as { keys?: unknown }).keys;
  if (!Array.isArray(keys) || keys.length > 20) fail();
  const matching = keys.filter(
    (key) =>
      key &&
      typeof key === 'object' &&
      (key as Record<string, unknown>).kid === keyId,
  );
  if (matching.length !== 1) fail();
  const key = matching[0] as Record<string, unknown>;
  if (
    key.kty !== 'RSA' ||
    key.use !== 'sig' ||
    key.alg !== 'RS256' ||
    typeof key.n !== 'string' ||
    typeof key.e !== 'string'
  ) {
    fail();
  }
  return key as JsonWebKey;
}

function validateHttpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    fail();
  }
  return url.href.replace(/\/$/, '');
}

@Injectable()
export class OidcMcpAccessTokenVerifier extends McpAccessTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwksUri: string;
  private readonly authorizedClientIds: ReadonlySet<string>;

  constructor(private readonly options: OidcMcpAccessTokenVerifierOptions) {
    super();
    this.issuer = validateHttpsUrl(options.issuer);
    this.audience = validateHttpsUrl(options.audience);
    this.jwksUri = validateHttpsUrl(options.jwksUri);
    if (
      options.authorizedClientIds.length === 0 ||
      new Set(options.authorizedClientIds).size !==
        options.authorizedClientIds.length ||
      options.authorizedClientIds.some(
        (clientId) => !/^[A-Za-z0-9_.:-]{1,512}$/.test(clientId),
      ) ||
      !Number.isSafeInteger(options.requestTimeoutMs) ||
      options.requestTimeoutMs < 1 ||
      options.requestTimeoutMs > 10_000
    ) {
      fail();
    }
    this.authorizedClientIds = new Set(options.authorizedClientIds);
  }

  async verify(
    accessToken: string,
    expectedResource: string,
    now: Date,
  ): Promise<VerifiedMcpAccessToken> {
    try {
      if (
        typeof accessToken !== 'string' ||
        accessToken.length < 16 ||
        accessToken.length > 16_384 ||
        /\s/.test(accessToken) ||
        validateHttpsUrl(expectedResource) !== this.audience ||
        Number.isNaN(now.getTime())
      ) {
        fail();
      }
      const segments = accessToken.split('.');
      if (segments.length !== 3) fail();
      const [encodedHeader, encodedClaims, encodedSignature] = segments;
      if (!encodedHeader || !encodedClaims || !encodedSignature) fail();
      const header = parseHeader(encodedHeader);
      const claims = parseClaims(encodedClaims);

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.options.requestTimeoutMs,
      );
      let jwks: unknown;
      try {
        jwks = await this.options.fetchJson(this.jwksUri, controller.signal);
      } finally {
        clearTimeout(timeout);
      }
      const publicKey = createPublicKey({
        key: parseJwks(jwks, header.kid),
        format: 'jwk',
      });
      const signature = Buffer.from(encodedSignature, 'base64url');
      if (
        signature.length === 0 ||
        !createVerify('RSA-SHA256')
          .update(`${encodedHeader}.${encodedClaims}`)
          .verify(publicKey, signature)
      ) {
        fail();
      }

      const nowEpochSeconds = Math.floor(now.getTime() / 1_000);
      if (
        claims.iss !== this.issuer ||
        claims.aud !== this.audience ||
        claims.sub.length < 1 ||
        claims.sub.length > 512 ||
        !this.authorizedClientIds.has(claims.client_id) ||
        claims.iat > nowEpochSeconds ||
        claims.nbf > nowEpochSeconds ||
        claims.exp <= nowEpochSeconds ||
        claims.exp <= claims.iat ||
        claims.jti.length < 1 ||
        claims.jti.length > 512 ||
        claims.token_use !== 'mcp_access' ||
        claims.authorization_version < 1
      ) {
        fail();
      }

      const knownScopes = new Set<string>(MCP_ACCESS_TOKEN_SCOPES);
      const scopes = claims.scope.split(' ').filter(Boolean);
      if (
        scopes.length === 0 ||
        new Set(scopes).size !== scopes.length ||
        scopes.some((scope) => !knownScopes.has(scope))
      ) {
        fail();
      }
      if (
        await this.options.isRevoked({
          issuer: claims.iss,
          subject: claims.sub,
          clientId: claims.client_id,
          tokenId: claims.jti,
        })
      ) {
        fail();
      }

      return Object.freeze({
        issuer: claims.iss,
        subject: claims.sub,
        audience: claims.aud,
        clientId: claims.client_id,
        scopes: Object.freeze(scopes as McpAccessTokenScope[]),
        issuedAtEpochSeconds: claims.iat,
        notBeforeEpochSeconds: claims.nbf,
        expiresAtEpochSeconds: claims.exp,
        active: true,
        authorizationVersion: claims.authorization_version,
        verificationMethodVersion: 'oidc-jwks-rs256.v1',
        tokenType: 'mcp_access',
      });
    } catch {
      throw new McpAccessTokenVerificationError();
    }
  }
}
