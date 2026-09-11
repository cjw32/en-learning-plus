export const MCP_ACCESS_TOKEN_VERIFIER = Symbol('MCP_ACCESS_TOKEN_VERIFIER');

export const MCP_ACCESS_TOKEN_SCOPES = Object.freeze([
  'learning:read',
  'quiz:create',
  'answer:submit',
] as const);

export type McpAccessTokenScope = (typeof MCP_ACCESS_TOKEN_SCOPES)[number];

export type VerifiedMcpAccessToken = Readonly<{
  issuer: string;
  subject: string;
  audience: string;
  clientId: string;
  scopes: readonly McpAccessTokenScope[];
  issuedAtEpochSeconds: number;
  notBeforeEpochSeconds: number;
  expiresAtEpochSeconds: number;
  active: boolean;
  authorizationVersion: number;
  verificationMethodVersion: string;
  tokenType: 'mcp_access';
}>;

export class McpAccessTokenVerificationError extends Error {
  readonly code = 'UNAUTHENTICATED' as const;

  constructor(message = 'MCP access token verification failed') {
    super(message);
    this.name = 'McpAccessTokenVerificationError';
  }
}

export abstract class McpAccessTokenVerifier {
  abstract verify(
    accessToken: string,
    expectedResource: string,
    now: Date,
  ): Promise<VerifiedMcpAccessToken>;
}
