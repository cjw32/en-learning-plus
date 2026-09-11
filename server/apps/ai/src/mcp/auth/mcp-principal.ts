import type { McpSupportedProtocolVersion } from '@en/common/mcp';
import type {
  McpAccessTokenScope,
  VerifiedMcpAccessToken,
} from './mcp-access-token-verifier';

export type McpPrincipal = Readonly<{
  issuer: string;
  subject: string;
  audience: string;
  clientId: string;
  scopes: readonly McpAccessTokenScope[];
  authorizationVersion: number;
  issuedAtEpochSeconds: number;
  notBeforeEpochSeconds: number;
  expiresAtEpochSeconds: number;
  verificationMethodVersion: string;
}>;

export function createMcpPrincipal(
  token: VerifiedMcpAccessToken,
): McpPrincipal {
  return Object.freeze({
    issuer: token.issuer,
    subject: token.subject,
    audience: token.audience,
    clientId: token.clientId,
    scopes: Object.freeze([...token.scopes]),
    authorizationVersion: token.authorizationVersion,
    issuedAtEpochSeconds: token.issuedAtEpochSeconds,
    notBeforeEpochSeconds: token.notBeforeEpochSeconds,
    expiresAtEpochSeconds: token.expiresAtEpochSeconds,
    verificationMethodVersion: token.verificationMethodVersion,
  });
}

export type McpRequestContext = Readonly<{
  principal: McpPrincipal;
  userId: string;
  authorizationId: string;
  requestId: string;
  traceId: string;
  protocolVersion: McpSupportedProtocolVersion;
}>;

export function createMcpRequestContext(
  input: McpRequestContext,
): McpRequestContext {
  return Object.freeze({
    principal: input.principal,
    userId: input.userId,
    authorizationId: input.authorizationId,
    requestId: input.requestId,
    traceId: input.traceId,
    protocolVersion: input.protocolVersion,
  });
}
