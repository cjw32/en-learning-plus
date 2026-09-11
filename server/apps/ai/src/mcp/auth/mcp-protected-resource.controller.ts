import { Controller, Get, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { MCP_ACCESS_TOKEN_SCOPES } from './mcp-access-token-verifier';

export const MCP_PROTECTED_RESOURCE_OPTIONS = Symbol(
  'MCP_PROTECTED_RESOURCE_OPTIONS',
);

export type McpEnabledProtectedResourceOptions = Readonly<{
  enabled?: true;
  resource: string;
  authorizationServers: readonly string[];
  scopesSupported: readonly string[];
}>;

export type McpProtectedResourceOptions =
  | McpEnabledProtectedResourceOptions
  | Readonly<{ enabled: false }>;

type RawJsonResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): RawJsonResponse;
  json(value: unknown): void;
};

function safeHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MCP OAuth metadata URL must be absolute');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('MCP OAuth metadata URL must be a safe HTTPS URL');
  }
  return parsed.href.replace(/\/$/, '');
}

function safeScopes(scopes: readonly string[]): string[] {
  const approved = new Set<string>(MCP_ACCESS_TOKEN_SCOPES);
  if (
    scopes.length === 0 ||
    scopes.some((scope) => !approved.has(scope)) ||
    new Set(scopes).size !== scopes.length
  ) {
    throw new Error('MCP OAuth metadata scopes must be unique and approved');
  }
  return [...scopes];
}

export function buildMcpProtectedResourceMetadata(
  input: McpEnabledProtectedResourceOptions,
) {
  if (input.authorizationServers.length === 0) {
    throw new Error('MCP OAuth metadata requires an authorization server');
  }
  const resource = safeHttpsUrl(input.resource);
  const authorizationServers = input.authorizationServers.map(safeHttpsUrl);
  if (new Set(authorizationServers).size !== authorizationServers.length) {
    throw new Error('MCP OAuth authorization servers must be unique');
  }
  return Object.freeze({
    resource,
    authorization_servers: Object.freeze(authorizationServers),
    bearer_methods_supported: Object.freeze(['header'] as const),
    scopes_supported: Object.freeze(safeScopes(input.scopesSupported)),
  });
}

function quotedChallengeValue(value: string): string {
  if (!/^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/.test(value)) {
    throw new Error('Unsafe Bearer challenge value');
  }
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

export function buildMcpBearerChallenge(input: {
  resourceMetadataUrl: string;
  error?: 'invalid_token' | 'insufficient_scope';
  requiredScopes?: readonly string[];
}): string {
  const fields = [
    `resource_metadata=${quotedChallengeValue(
      safeHttpsUrl(input.resourceMetadataUrl),
    )}`,
  ];
  if (input.error) fields.push(`error=${quotedChallengeValue(input.error)}`);
  if (input.requiredScopes) {
    fields.push(
      `scope=${quotedChallengeValue(safeScopes(input.requiredScopes).join(' '))}`,
    );
  }
  return `Bearer ${fields.join(', ')}`;
}

@Controller({
  path: '.well-known/oauth-protected-resource/ai/v1/mcp',
  version: VERSION_NEUTRAL,
})
export class McpProtectedResourceController {
  private readonly metadata:
    | ReturnType<typeof buildMcpProtectedResourceMetadata>
    | undefined;

  constructor(
    @Inject(MCP_PROTECTED_RESOURCE_OPTIONS)
    options: McpProtectedResourceOptions,
  ) {
    this.metadata =
      options.enabled === false
        ? undefined
        : buildMcpProtectedResourceMetadata(options);
  }

  @Get()
  getMetadata(@Res() response: RawJsonResponse): void {
    if (!this.metadata) {
      response.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.setHeader('Content-Type', 'application/json');
    response.status(200).json(this.metadata);
  }
}
