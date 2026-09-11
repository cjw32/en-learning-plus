import { createHmac } from 'node:crypto';
import type { McpAccessTokenVerifier } from '../auth/mcp-access-token-verifier';
import type {
  McpAuthorizationService,
  McpAuthorizedIdentity,
} from '../auth/mcp-authorization.service';
import {
  createMcpPrincipal,
  createMcpRequestContext,
  type McpRequestContext,
} from '../auth/mcp-principal';
import { buildMcpBearerChallenge } from '../auth/mcp-protected-resource.controller';
import { mapMcpError } from '../errors/mcp-error-mapper';
import type { McpAdmissionService } from '../governance/mcp-admission.service';
import type {
  McpProtocolEvidence,
  McpProtocolNegotiation,
  McpProtocolNegotiator,
} from './mcp-protocol-negotiator';

export type McpPipelineStage =
  | 'boundary'
  | 'authentication'
  | 'authorization'
  | 'admission'
  | 'dispatch';

export type McpBoundaryRequest = McpProtocolEvidence &
  Readonly<{
    body?: Readonly<Record<string, unknown>>;
    capabilityName?: string;
  }>;

export type McpPipelineDispatchContext = Readonly<{
  signal: AbortSignal;
  authorization: McpAuthorizedIdentity;
  negotiation: McpProtocolNegotiation;
  boundary: McpBoundaryRequest;
}>;

type DispatchPort = Readonly<{
  handle(
    request: Request,
    context: McpRequestContext,
    dispatch: McpPipelineDispatchContext,
  ): Promise<Response>;
}>;

export type McpRequestPipelineOptions = Readonly<{
  expectedResource: string;
  resourceMetadataUrl: string;
  maxRequestBytes: number;
  now: () => Date;
  verifier: Pick<McpAccessTokenVerifier, 'verify'>;
  authorization: Pick<McpAuthorizationService, 'authorize'>;
  admission: Pick<McpAdmissionService, 'admit'>;
  negotiator: Pick<McpProtocolNegotiator, 'negotiate'>;
  dispatch: DispatchPort;
  requiredScopes: (request: McpBoundaryRequest) => readonly string[];
  identityHmacKey: string;
  requestId: () => string;
  traceId: () => string;
  onStage?: (stage: McpPipelineStage) => void;
}>;

class McpPipelineError extends Error {
  constructor(
    readonly code: 'UNAUTHENTICATED' | 'VALIDATION_FAILED' | 'CANCELLED',
    readonly httpStatus?: number,
  ) {
    super(code);
    this.name = 'McpPipelineError';
  }
}

const PROTOCOL_META_KEY = 'io.modelcontextprotocol/protocolVersion';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function statusFor(error: unknown): number {
  if (error instanceof McpPipelineError && error.httpStatus) {
    return error.httpStatus;
  }
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'INTERNAL_ERROR';
  switch (code) {
    case 'UNAUTHENTICATED':
      return 401;
    case 'INSUFFICIENT_SCOPE':
      return 403;
    case 'VALIDATION_FAILED':
      return 400;
    case 'RATE_LIMITED':
    case 'CONCURRENCY_LIMITED':
      return 429;
    case 'CANCELLED':
      return 499;
    case 'TIMEOUT':
      return 504;
    case 'DEPENDENCY_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}

function codeFor(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'INTERNAL_ERROR';
}

export class McpRequestPipeline {
  constructor(private readonly options: McpRequestPipelineOptions) {
    if (
      !Number.isSafeInteger(options.maxRequestBytes) ||
      options.maxRequestBytes < 1 ||
      Buffer.byteLength(options.identityHmacKey, 'utf8') < 32
    ) {
      throw new McpPipelineError('VALIDATION_FAILED');
    }
  }

  async handle(request: Request, signal: AbortSignal): Promise<Response> {
    const traceId = this.options.traceId();
    let requiredScopes: readonly string[] = [];
    try {
      this.stage('boundary', signal);
      const { accessToken, boundary } = await this.inspectBoundary(request);

      this.stage('authentication', signal);
      const verified = await this.options.verifier.verify(
        accessToken,
        this.options.expectedResource,
        this.options.now(),
      );
      const principal = createMcpPrincipal(verified);

      this.stage('authorization', signal);
      requiredScopes = this.options.requiredScopes(boundary);
      const authorization = await this.options.authorization.authorize(
        principal,
        requiredScopes,
      );
      const negotiation = this.options.negotiator.negotiate(boundary);
      const context = createMcpRequestContext({
        principal,
        userId: authorization.identity.userId,
        authorizationId: authorization.identity.authorizationId,
        requestId: this.options.requestId(),
        traceId,
        protocolVersion: negotiation.protocolVersion,
      });

      this.stage('admission', signal);
      const lease = await this.options.admission.admit({
        networkHmac: this.hmac('network', 'unavailable'),
        subjectHmac: authorization.identity.subjectHmac,
        clientHmac: this.hmac(
          'client',
          `${principal.issuer}\0${principal.clientId}`,
        ),
        capability: this.hmac(
          'capability',
          `${boundary.method}\0${boundary.capabilityName ?? ''}`,
        ),
      });

      try {
        this.stage('dispatch', signal);
        return await this.options.dispatch.handle(request, context, {
          signal,
          authorization,
          negotiation,
          boundary,
        });
      } finally {
        await lease.release();
      }
    } catch (error) {
      return this.safeErrorResponse(error, traceId, requiredScopes);
    }
  }

  private stage(stage: McpPipelineStage, signal: AbortSignal): void {
    this.options.onStage?.(stage);
    if (signal.aborted) throw new McpPipelineError('CANCELLED');
  }

  private async inspectBoundary(request: Request): Promise<{
    accessToken: string;
    boundary: McpBoundaryRequest;
  }> {
    const url = new URL(request.url);
    if (
      url.searchParams.has('access_token') ||
      url.searchParams.has('authorization') ||
      /(?:^|;\s*)(?:access_token|authorization|bearer)=/i.test(
        request.headers.get('cookie') ?? '',
      )
    ) {
      throw new McpPipelineError('VALIDATION_FAILED');
    }

    const authorization = request.headers.get('authorization');
    const match = authorization?.match(/^Bearer ([A-Za-z0-9\-._~+/]+={0,2})$/);
    if (!match || match[1].length > 8_192) {
      throw new McpPipelineError('UNAUTHENTICATED');
    }

    const declaredLength = Number(request.headers.get('content-length'));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.options.maxRequestBytes
    ) {
      throw new McpPipelineError('VALIDATION_FAILED', 413);
    }

    let body: Record<string, unknown> | undefined;
    if (request.method === 'POST') {
      if (
        !/^application\/json(?:\s*;|$)/i.test(
          request.headers.get('content-type') ?? '',
        )
      ) {
        throw new McpPipelineError('VALIDATION_FAILED', 415);
      }
      const text = await request.clone().text();
      if (Buffer.byteLength(text, 'utf8') > this.options.maxRequestBytes) {
        throw new McpPipelineError('VALIDATION_FAILED', 413);
      }
      try {
        body = record(JSON.parse(text));
      } catch {
        throw new McpPipelineError('VALIDATION_FAILED');
      }
      if (!body) throw new McpPipelineError('VALIDATION_FAILED');
    }

    const params = record(body?.params);
    const metadata = record(params?._meta);
    const method =
      typeof body?.method === 'string' ? body.method : request.method;
    const methodHeader = request.headers.get('mcp-method');
    if (methodHeader && methodHeader !== method) {
      throw new McpPipelineError('VALIDATION_FAILED');
    }
    if (
      request.headers.get('mcp-protocol-version') === '2026-07-28' &&
      methodHeader === null
    ) {
      throw new McpPipelineError('VALIDATION_FAILED');
    }

    const capabilityName =
      typeof params?.name === 'string' ? params.name : undefined;
    const nameHeader = request.headers.get('mcp-name');
    if (nameHeader && nameHeader !== capabilityName) {
      throw new McpPipelineError('VALIDATION_FAILED');
    }

    return {
      accessToken: match[1],
      boundary: Object.freeze({
        method,
        headerVersion: request.headers.get('mcp-protocol-version') ?? undefined,
        metadataVersion: metadata?.[PROTOCOL_META_KEY],
        initializeVersion:
          method === 'initialize' ? params?.protocolVersion : undefined,
        hasSessionId: request.headers.has('mcp-session-id'),
        ...(body ? { body: Object.freeze(body) } : {}),
        ...(capabilityName ? { capabilityName } : {}),
      }),
    };
  }

  private hmac(namespace: string, value: string): string {
    return `${namespace}_${createHmac('sha256', this.options.identityHmacKey)
      .update(`${namespace}\0${value}`)
      .digest('hex')}`;
  }

  private safeErrorResponse(
    error: unknown,
    traceId: string,
    requiredScopes: readonly string[],
  ): Response {
    const code = codeFor(error);
    const headers = new Headers({ 'content-type': 'application/json' });
    if (code === 'UNAUTHENTICATED' || code === 'INSUFFICIENT_SCOPE') {
      headers.set(
        'www-authenticate',
        buildMcpBearerChallenge({
          resourceMetadataUrl: this.options.resourceMetadataUrl,
          error:
            code === 'INSUFFICIENT_SCOPE'
              ? 'insufficient_scope'
              : 'invalid_token',
          ...(code === 'INSUFFICIENT_SCOPE' && requiredScopes.length > 0
            ? { requiredScopes }
            : {}),
        }),
      );
    }
    return new Response(JSON.stringify(mapMcpError(error, traceId)), {
      status: statusFor(error),
      headers,
    });
  }
}
