import { Injectable } from '@nestjs/common';
import {
  MCP_ACCESS_TOKEN_SCOPES,
  McpAccessTokenVerificationError,
  McpAccessTokenVerifier,
  type VerifiedMcpAccessToken,
} from './mcp-access-token-verifier';

export type FakeMcpAccessTokenVerifierOptions = Readonly<{
  approvedIssuer: string;
  tokens: Readonly<Record<string, VerifiedMcpAccessToken>>;
}>;

@Injectable()
export class FakeMcpAccessTokenVerifier extends McpAccessTokenVerifier {
  readonly networkRequestCount = 0;
  private readonly tokens: ReadonlyMap<string, VerifiedMcpAccessToken>;

  constructor(private readonly options: FakeMcpAccessTokenVerifierOptions) {
    super();
    this.tokens = new Map(Object.entries(options.tokens));
  }

  verify(
    accessToken: string,
    expectedResource: string,
    now: Date,
  ): Promise<VerifiedMcpAccessToken> {
    if (!accessToken || /\s/.test(accessToken)) return this.fail();
    const token = this.tokens.get(accessToken);
    if (!token) return this.fail();

    const nowEpochSeconds = Math.floor(now.getTime() / 1_000);
    const knownScopes = new Set<string>(MCP_ACCESS_TOKEN_SCOPES);
    if (
      token.tokenType !== 'mcp_access' ||
      token.issuer !== this.options.approvedIssuer ||
      token.audience !== expectedResource ||
      token.subject.length === 0 ||
      token.clientId.length === 0 ||
      token.scopes.length === 0 ||
      token.scopes.some((scope) => !knownScopes.has(scope)) ||
      !token.active ||
      token.issuedAtEpochSeconds > nowEpochSeconds ||
      token.notBeforeEpochSeconds > nowEpochSeconds ||
      token.expiresAtEpochSeconds <= nowEpochSeconds ||
      !Number.isSafeInteger(token.authorizationVersion) ||
      token.authorizationVersion < 1
    ) {
      return this.fail();
    }

    return Promise.resolve(
      Object.freeze({
        ...token,
        scopes: Object.freeze([...token.scopes]),
      }),
    );
  }

  private fail(): Promise<never> {
    return Promise.reject(new McpAccessTokenVerificationError());
  }
}
