import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { McpServer } from '@modelcontextprotocol/server';
import { LearningDataDeletionService, LearningModule } from '@libs/learning';
import { AuthGuard, PrismaModule } from '@libs/shared';
import {
  CoachRedisConnection,
  CoachRedisModule,
} from '../coach/streaming/coach-redis.module';
import {
  MCP_ACCESS_TOKEN_VERIFIER,
  McpAccessTokenVerificationError,
  McpAccessTokenVerifier,
} from './auth/mcp-access-token-verifier';
import {
  McpAuthorizationService,
  type McpAuthorizationServiceOptions,
} from './auth/mcp-authorization.service';
import {
  MCP_PROTECTED_RESOURCE_OPTIONS,
  McpProtectedResourceController,
  type McpProtectedResourceOptions,
} from './auth/mcp-protected-resource.controller';
import { McpCapabilityRegistry } from './capabilities/mcp-capability-registry';
import {
  MCP_RUNTIME_CONFIG,
  resolveMcpRuntimeConfig,
  type McpRuntimeConfig,
} from './config/mcp.config';
import {
  McpAdmissionService,
  type McpAdmissionPolicy,
  type McpAdmissionStore,
} from './governance/mcp-admission.service';
import {
  McpIdempotencyService,
  type McpIdempotencyOptions,
} from './idempotency/mcp-idempotency.service';
import {
  McpTraceService,
  type McpTraceSink,
} from './observability/mcp-trace.service';
import {
  McpTraceQueryService,
  PrismaMcpTraceQueryRepository,
} from './observability/mcp-trace-query.service';
import { McpAuthorizationRepository } from './persistence/mcp-authorization.repository';
import { McpIdempotencyRepository } from './persistence/mcp-idempotency.repository';
import { McpInvocationRepository } from './persistence/mcp-invocation.repository';
import { McpSubjectRepository } from './persistence/mcp-subject.repository';
import { McpTraceRepository } from './persistence/mcp-trace.repository';
import {
  McpLearningDataCleanupService,
  PrismaMcpLearningDataCleanupRepository,
} from './retention/mcp-learning-data-cleanup.service';
import { McpAccountDataCleanupService } from './retention/mcp-account-data-cleanup.service';
import {
  McpRetentionService,
  PrismaMcpRetentionRepository,
} from './retention/mcp-retention.service';
import { McpRetentionProcessor } from './retention/mcp-retention.processor';
import { MCP_HTTP_REQUEST_HANDLER } from './transport/mcp-http-boundary';
import {
  McpLegacySessionManager,
  RedisMcpLegacySessionStore,
  type McpLegacyIdentity,
  type McpRedisSessionClient,
} from './transport/mcp-legacy-session.manager';
import { McpModernTransportFactory } from './transport/mcp-modern-transport.factory';
import { McpProtocolNegotiator } from './transport/mcp-protocol-negotiator';
import {
  McpRequestPipeline,
  type McpBoundaryRequest,
  type McpPipelineDispatchContext,
} from './transport/mcp-request-pipeline';
import type { McpRequestContext } from './auth/mcp-principal';
import {
  MCP_CONFIRMATION_CONTROLLER_OPTIONS,
  WriteConfirmationController,
  type McpConfirmationControllerOptions,
} from './confirmation/write-confirmation.controller';
import { WriteConfirmationRepository } from './confirmation/write-confirmation.repository';
import {
  WriteConfirmationService,
  type WriteConfirmationOptions,
} from './confirmation/write-confirmation.service';
import {
  McpSubmitReconciliationService,
  PrismaMcpSubmitReconciliationRepository,
} from './confirmation/mcp-submit-reconciliation.service';

/**
 * The MCP surface remains inert until the transport and validated feature-gate
 * wiring are added. Keeping the shell empty prevents accidental route exposure.
 */
export const MCP_MODULE_DEFAULT_ENABLED = false as const;

export const MCP_ADMISSION_STORE = Symbol('MCP_ADMISSION_STORE');
export const MCP_ADMISSION_POLICY = Symbol('MCP_ADMISSION_POLICY');
export const MCP_TRACE_SINK = Symbol('MCP_TRACE_SINK');
export const MCP_TRACE_HMAC_KEY = Symbol('MCP_TRACE_HMAC_KEY');
export const MCP_IDEMPOTENCY_OPTIONS = Symbol('MCP_IDEMPOTENCY_OPTIONS');
export const MCP_ENDPOINT_OPTIONS = Symbol('MCP_ENDPOINT_OPTIONS');
export const MCP_IDENTITY_HMAC_KEY = Symbol('MCP_IDENTITY_HMAC_KEY');
export const MCP_AUTHORIZATION_OPTIONS = Symbol('MCP_AUTHORIZATION_OPTIONS');
export const MCP_LEGACY_SESSION_STORE = Symbol('MCP_LEGACY_SESSION_STORE');
export const MCP_SERVER_FACTORY = Symbol('MCP_SERVER_FACTORY');
export const MCP_WRITE_CONFIRMATION_OPTIONS = Symbol(
  'MCP_WRITE_CONFIRMATION_OPTIONS',
);

export type McpEndpointOptions = Readonly<{
  resource: string;
  resourceMetadataUrl: string;
  authorizationServers: readonly string[];
}>;

export type McpServerFactory = () => McpServer | Promise<McpServer>;

function safeHttpsUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an absolute HTTPS URL`);
  }
  return url.href.replace(/\/$/, '');
}

function resolveEndpointOptions(config: McpRuntimeConfig): McpEndpointOptions {
  if (!config.enabled) {
    return Object.freeze({
      resource: 'https://disabled.invalid/ai/v1/mcp',
      resourceMetadataUrl:
        'https://disabled.invalid/.well-known/oauth-protected-resource/ai/v1/mcp',
      authorizationServers: Object.freeze(['https://disabled.invalid/oauth']),
    });
  }
  const rawResource = process.env.MCP_RESOURCE_URL?.trim();
  const rawAuthorizationServers =
    process.env.MCP_AUTHORIZATION_SERVER_URLS?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  if (!rawResource || !rawAuthorizationServers?.length) {
    throw new Error(
      'MCP_RESOURCE_URL and MCP_AUTHORIZATION_SERVER_URLS are required when MCP is enabled',
    );
  }
  const resource = safeHttpsUrl('MCP_RESOURCE_URL', rawResource);
  const parsedResource = new URL(resource);
  if (parsedResource.pathname !== '/ai/v1/mcp') {
    throw new Error('MCP_RESOURCE_URL must end at /ai/v1/mcp');
  }
  return Object.freeze({
    resource,
    resourceMetadataUrl: `${parsedResource.origin}/.well-known/oauth-protected-resource/ai/v1/mcp`,
    authorizationServers: Object.freeze(
      rawAuthorizationServers.map((value) =>
        safeHttpsUrl('MCP_AUTHORIZATION_SERVER_URLS', value),
      ),
    ),
  });
}

function resolveIdentityHmacKey(config: McpRuntimeConfig): string {
  if (!config.enabled) return randomBytes(32).toString('hex');
  const value = process.env.MCP_IDENTITY_HMAC_KEY;
  if (!value || Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error(
      'MCP_IDENTITY_HMAC_KEY must contain at least 32 bytes when MCP is enabled',
    );
  }
  return value;
}

function requiredScopes(request: McpBoundaryRequest): readonly string[] {
  if (request.method === 'resources/read' || request.method === 'prompts/get') {
    return ['learning:read'];
  }
  if (request.method !== 'tools/call') return [];
  switch (request.capabilityName) {
    case 'search_words':
    case 'get_due_words':
    case 'search_learning_materials':
    case 'get_learning_report':
      return ['learning:read'];
    case 'create_quiz':
      return ['quiz:create'];
    case 'submit_answer':
      return ['answer:submit'];
    default:
      return [];
  }
}

class DisabledMcpAccessTokenVerifier extends McpAccessTokenVerifier {
  verify(): Promise<never> {
    return Promise.reject(
      new McpAccessTokenVerificationError(
        'MCP access-token verification is not configured',
      ),
    );
  }
}

class FailClosedMcpAdmissionStore implements McpAdmissionStore {
  consume() {
    return Promise.resolve({ allowed: false } as const);
  }

  acquireLease() {
    return Promise.resolve(null);
  }

  releaseLease(): Promise<void> {
    return Promise.resolve();
  }
}

class FailClosedMcpTraceSink implements McpTraceSink {
  save(): Promise<void> {
    return Promise.reject(
      new Error('MCP trace persistence requires a scoped request context'),
    );
  }
}

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('SECRET_KEY'),
        signOptions: { expiresIn: '5m' },
      }),
    }),
    PrismaModule,
    LearningModule,
    CoachRedisModule,
  ],
  controllers: [McpProtectedResourceController, WriteConfirmationController],
  providers: [
    {
      provide: MCP_RUNTIME_CONFIG,
      useFactory: () => resolveMcpRuntimeConfig(process.env),
    },
    McpSubjectRepository,
    McpAuthorizationRepository,
    McpInvocationRepository,
    McpTraceRepository,
    PrismaMcpTraceQueryRepository,
    PrismaMcpRetentionRepository,
    PrismaMcpLearningDataCleanupRepository,
    McpIdempotencyRepository,
    WriteConfirmationRepository,
    PrismaMcpSubmitReconciliationRepository,
    AuthGuard,
    DisabledMcpAccessTokenVerifier,
    {
      provide: MCP_ACCESS_TOKEN_VERIFIER,
      useExisting: DisabledMcpAccessTokenVerifier,
    },
    {
      provide: McpAccessTokenVerifier,
      useExisting: DisabledMcpAccessTokenVerifier,
    },
    {
      provide: MCP_ENDPOINT_OPTIONS,
      inject: [MCP_RUNTIME_CONFIG],
      useFactory: resolveEndpointOptions,
    },
    {
      provide: MCP_IDENTITY_HMAC_KEY,
      inject: [MCP_RUNTIME_CONFIG],
      useFactory: resolveIdentityHmacKey,
    },
    {
      provide: MCP_WRITE_CONFIRMATION_OPTIONS,
      inject: [MCP_IDENTITY_HMAC_KEY],
      useFactory: (hmacKey: string): WriteConfirmationOptions => ({
        hmacKey,
        ttlMs: 5 * 60 * 1_000,
        toolVersion: 'en-learning.mcp.v1',
        summaryVersion: 'mcp.write-summary.v1',
        maximumReauthenticationAgeMs: 5 * 60 * 1_000,
      }),
    },
    {
      provide: WriteConfirmationService,
      inject: [WriteConfirmationRepository, MCP_WRITE_CONFIRMATION_OPTIONS],
      useFactory: (
        repository: WriteConfirmationRepository,
        options: WriteConfirmationOptions,
      ) => new WriteConfirmationService(repository, options),
    },
    {
      provide: McpSubmitReconciliationService,
      inject: [PrismaMcpSubmitReconciliationRepository],
      useFactory: (repository: PrismaMcpSubmitReconciliationRepository) =>
        new McpSubmitReconciliationService(repository, {
          recoveryWindowMs: 24 * 60 * 60 * 1_000,
        }),
    },
    {
      provide: MCP_CONFIRMATION_CONTROLLER_OPTIONS,
      inject: [MCP_IDENTITY_HMAC_KEY],
      useFactory: (csrfHmacKey: string): McpConfirmationControllerOptions => ({
        csrfHmacKey,
        csrfTtlMs: 5 * 60 * 1_000,
      }),
    },
    {
      provide: MCP_AUTHORIZATION_OPTIONS,
      inject: [MCP_IDENTITY_HMAC_KEY],
      useFactory: (subjectHmacKey: string): McpAuthorizationServiceOptions => ({
        subjectHmacKey,
        hmacKeyVersion:
          process.env.MCP_SUBJECT_HMAC_KEY_VERSION?.trim() ||
          'mcp-subject-hmac.v1',
      }),
    },
    {
      provide: McpAuthorizationService,
      inject: [
        McpSubjectRepository,
        McpAuthorizationRepository,
        MCP_AUTHORIZATION_OPTIONS,
      ],
      useFactory: (
        subjects: McpSubjectRepository,
        authorizations: McpAuthorizationRepository,
        options: McpAuthorizationServiceOptions,
      ) => new McpAuthorizationService(subjects, authorizations, options),
    },
    McpProtocolNegotiator,
    McpCapabilityRegistry,
    {
      provide: MCP_PROTECTED_RESOURCE_OPTIONS,
      inject: [MCP_RUNTIME_CONFIG, MCP_ENDPOINT_OPTIONS],
      useFactory: (
        config: McpRuntimeConfig,
        endpoint: McpEndpointOptions,
      ): McpProtectedResourceOptions =>
        config.enabled
          ? {
              enabled: true,
              resource: endpoint.resource,
              authorizationServers: endpoint.authorizationServers,
              scopesSupported: [
                'learning:read',
                'quiz:create',
                'answer:submit',
              ],
            }
          : { enabled: false },
    },
    {
      provide: MCP_ADMISSION_STORE,
      useClass: FailClosedMcpAdmissionStore,
    },
    {
      provide: MCP_ADMISSION_POLICY,
      inject: [MCP_RUNTIME_CONFIG],
      useFactory: (config: McpRuntimeConfig): McpAdmissionPolicy => ({
        rateLimit: 1,
        windowSeconds: 60,
        concurrencyLimit: config.maxParallelCalls,
        leaseTtlMs: config.requestDeadlineMs,
      }),
    },
    {
      provide: McpAdmissionService,
      inject: [MCP_ADMISSION_STORE, MCP_ADMISSION_POLICY],
      useFactory: (store: McpAdmissionStore, policy: McpAdmissionPolicy) =>
        new McpAdmissionService(store, policy),
    },
    {
      provide: MCP_TRACE_SINK,
      useClass: FailClosedMcpTraceSink,
    },
    {
      provide: MCP_TRACE_HMAC_KEY,
      useFactory: () => randomBytes(32).toString('hex'),
    },
    {
      provide: McpTraceService,
      inject: [MCP_TRACE_SINK, MCP_TRACE_HMAC_KEY],
      useFactory: (sink: McpTraceSink, hmacKey: string) =>
        new McpTraceService(sink, hmacKey),
    },
    {
      provide: McpTraceQueryService,
      inject: [PrismaMcpTraceQueryRepository],
      useFactory: (repository: PrismaMcpTraceQueryRepository) =>
        new McpTraceQueryService(repository),
    },
    {
      provide: McpRetentionService,
      inject: [PrismaMcpRetentionRepository],
      useFactory: (repository: PrismaMcpRetentionRepository) =>
        new McpRetentionService(repository, {
          diagnosticsEnabled: false,
          requestedDiagnosticsDays: 0,
        }),
    },
    McpRetentionProcessor,
    {
      provide: MCP_IDEMPOTENCY_OPTIONS,
      inject: [MCP_RUNTIME_CONFIG],
      useFactory: (config: McpRuntimeConfig): McpIdempotencyOptions => ({
        leaseOwnerHmac: randomBytes(32).toString('hex'),
        leaseDurationMs: config.requestDeadlineMs,
      }),
    },
    {
      provide: McpIdempotencyService,
      inject: [McpIdempotencyRepository, MCP_IDEMPOTENCY_OPTIONS],
      useFactory: (
        repository: McpIdempotencyRepository,
        options: McpIdempotencyOptions,
      ) => new McpIdempotencyService(repository, options),
    },
    {
      provide: MCP_SERVER_FACTORY,
      useValue: (() =>
        new McpServer({
          name: 'english-learning-mcp',
          version: '0.1.0',
        })) satisfies McpServerFactory,
    },
    {
      provide: McpModernTransportFactory,
      inject: [MCP_SERVER_FACTORY],
      useFactory: (createServer: McpServerFactory) =>
        new McpModernTransportFactory({ createServer }),
    },
    {
      provide: MCP_LEGACY_SESSION_STORE,
      inject: [CoachRedisConnection],
      useFactory: (connection: CoachRedisConnection) =>
        new RedisMcpLegacySessionStore(
          connection.client as unknown as McpRedisSessionClient,
        ),
    },
    {
      provide: McpLegacySessionManager,
      inject: [
        MCP_SERVER_FACTORY,
        MCP_LEGACY_SESSION_STORE,
        MCP_RUNTIME_CONFIG,
      ],
      useFactory: (
        createServer: McpServerFactory,
        store: RedisMcpLegacySessionStore,
        config: McpRuntimeConfig,
      ) =>
        new McpLegacySessionManager({
          createServer,
          store,
          now: () => new Date(),
          sessionId: () => `legacy_${randomBytes(24).toString('base64url')}`,
          idleTtlMs: config.legacySessionIdleTtlSeconds * 1_000,
          absoluteTtlMs: config.legacySessionAbsoluteTtlSeconds * 1_000,
        }),
    },
    {
      provide: 'MCP_TRANSPORT_DISPATCH',
      inject: [
        McpModernTransportFactory,
        McpLegacySessionManager,
        MCP_IDENTITY_HMAC_KEY,
      ],
      useFactory: (
        modern: McpModernTransportFactory,
        legacy: McpLegacySessionManager,
        hmacKey: string,
      ) => ({
        handle: async (
          request: Request,
          context: McpRequestContext,
          dispatch: McpPipelineDispatchContext,
        ): Promise<Response> => {
          if (dispatch.negotiation.era === 'modern') {
            return modern.handle(request);
          }
          const identity: McpLegacyIdentity = Object.freeze({
            issuer: context.principal.issuer,
            subjectHmac: dispatch.authorization.identity.subjectHmac,
            clientHmac: createHmac('sha256', hmacKey)
              .update(
                `client\0${context.principal.issuer}\0${context.principal.clientId}`,
              )
              .digest('hex'),
            authorizationId: context.authorizationId,
            authorizationVersion: context.principal.authorizationVersion,
            tokenExpiresAt: new Date(
              context.principal.expiresAtEpochSeconds * 1_000,
            ),
          });
          return legacy.handle(request, identity);
        },
      }),
    },
    {
      provide: McpRequestPipeline,
      inject: [
        MCP_ENDPOINT_OPTIONS,
        MCP_RUNTIME_CONFIG,
        MCP_ACCESS_TOKEN_VERIFIER,
        McpAuthorizationService,
        McpAdmissionService,
        McpProtocolNegotiator,
        'MCP_TRANSPORT_DISPATCH',
        MCP_IDENTITY_HMAC_KEY,
      ],
      useFactory: (
        endpoint: McpEndpointOptions,
        config: McpRuntimeConfig,
        verifier: McpAccessTokenVerifier,
        authorization: McpAuthorizationService,
        admission: McpAdmissionService,
        negotiator: McpProtocolNegotiator,
        dispatch: {
          handle(
            request: Request,
            context: McpRequestContext,
            dispatch: McpPipelineDispatchContext,
          ): Promise<Response>;
        },
        identityHmacKey: string,
      ) =>
        new McpRequestPipeline({
          expectedResource: endpoint.resource,
          resourceMetadataUrl: endpoint.resourceMetadataUrl,
          maxRequestBytes: config.maxRequestBytes,
          now: () => new Date(),
          verifier,
          authorization,
          admission,
          negotiator,
          dispatch,
          requiredScopes,
          identityHmacKey,
          requestId: randomUUID,
          traceId: randomUUID,
        }),
    },
    {
      provide: MCP_HTTP_REQUEST_HANDLER,
      useExisting: McpRequestPipeline,
    },
    {
      provide: McpLearningDataCleanupService,
      inject: [
        PrismaMcpLearningDataCleanupRepository,
        LearningDataDeletionService,
      ],
      useFactory: (
        repository: PrismaMcpLearningDataCleanupRepository,
        deletion: LearningDataDeletionService,
      ) => new McpLearningDataCleanupService(repository, deletion),
    },
    {
      provide: McpAccountDataCleanupService,
      useExisting: McpLearningDataCleanupService,
    },
  ],
  exports: [
    MCP_RUNTIME_CONFIG,
    MCP_ACCESS_TOKEN_VERIFIER,
    McpAccessTokenVerifier,
    McpSubjectRepository,
    McpAuthorizationRepository,
    McpInvocationRepository,
    McpTraceRepository,
    McpIdempotencyRepository,
    McpAdmissionService,
    McpAuthorizationService,
    McpProtocolNegotiator,
    McpCapabilityRegistry,
    McpModernTransportFactory,
    McpLegacySessionManager,
    McpRequestPipeline,
    MCP_HTTP_REQUEST_HANDLER,
    MCP_ENDPOINT_OPTIONS,
    MCP_PROTECTED_RESOURCE_OPTIONS,
    McpTraceService,
    McpIdempotencyService,
    McpSubmitReconciliationService,
    McpTraceQueryService,
    McpRetentionService,
    McpRetentionProcessor,
    McpLearningDataCleanupService,
    McpAccountDataCleanupService,
  ],
})
export class McpModule {}
