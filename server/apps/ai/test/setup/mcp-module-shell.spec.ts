import { RequestMethod, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  MCP_ENDPOINT_OPTIONS,
  MCP_IDENTITY_HMAC_KEY,
  MCP_MODULE_DEFAULT_ENABLED,
  McpModule,
} from '../../src/mcp';
import { AiModule } from '../../src/ai.module';
import {
  MCP_RUNTIME_CONFIG,
  resolveMcpRuntimeConfig,
} from '../../src/mcp/config/mcp.config';
import {
  MCP_ACCESS_TOKEN_VERIFIER,
  McpAccessTokenVerifier,
} from '../../src/mcp/auth/mcp-access-token-verifier';
import { FakeMcpAccessTokenVerifier as FakeVerifier } from '../../src/mcp/auth/fake-mcp-access-token-verifier';
import {
  MCP_PROTECTED_RESOURCE_OPTIONS,
  McpProtectedResourceController,
} from '../../src/mcp/auth/mcp-protected-resource.controller';
import { McpAuthorizationService } from '../../src/mcp/auth/mcp-authorization.service';
import { McpCapabilityRegistry } from '../../src/mcp/capabilities/mcp-capability-registry';
import { McpAdmissionService } from '../../src/mcp/governance/mcp-admission.service';
import { McpIdempotencyService } from '../../src/mcp/idempotency/mcp-idempotency.service';
import { McpTraceService } from '../../src/mcp/observability/mcp-trace.service';
import { McpIdempotencyRepository } from '../../src/mcp/persistence/mcp-idempotency.repository';
import { McpAccountDataCleanupService } from '../../src/mcp/retention/mcp-account-data-cleanup.service';
import { McpProtocolNegotiator } from '../../src/mcp/transport/mcp-protocol-negotiator';
import { McpModernTransportFactory } from '../../src/mcp/transport/mcp-modern-transport.factory';
import { McpLegacySessionManager } from '../../src/mcp/transport/mcp-legacy-session.manager';
import { McpRequestPipeline } from '../../src/mcp/transport/mcp-request-pipeline';
import {
  MCP_HTTP_REQUEST_HANDLER,
  mountMcpHttpBoundary,
} from '../../src/mcp/transport/mcp-http-boundary';

describe('McpModule default-off shell', () => {
  it('is composed into the AI application module', () => {
    const imports = Reflect.getMetadata('imports', AiModule) as unknown[];
    expect(imports).toContain(McpModule);
  });

  it('does not expose an MCP route before validated gate wiring exists', async () => {
    expect(MCP_MODULE_DEFAULT_ENABLED).toBe(false);

    const testingModule = await Test.createTestingModule({
      imports: [McpModule],
    }).compile();
    expect(testingModule.get(MCP_RUNTIME_CONFIG)).toMatchObject({
      enabled: false,
      readEnabled: false,
      ragEnabled: false,
      quizEnabled: false,
      confirmationEnabled: false,
      submitEnabled: false,
    });
    expect(testingModule.get(MCP_ACCESS_TOKEN_VERIFIER)).toBe(
      testingModule.get(McpAccessTokenVerifier),
    );
    expect(testingModule.get(McpAdmissionService)).toBeDefined();
    expect(testingModule.get(McpTraceService)).toBeDefined();
    expect(testingModule.get(McpIdempotencyRepository)).toBeDefined();
    expect(testingModule.get(McpIdempotencyService)).toBeDefined();
    expect(testingModule.get(McpAccountDataCleanupService)).toBeDefined();
    expect(testingModule.get(McpAuthorizationService)).toBeDefined();
    expect(testingModule.get(McpProtocolNegotiator)).toBeDefined();
    expect(testingModule.get(McpCapabilityRegistry)).toBeDefined();
    expect(testingModule.get(McpModernTransportFactory)).toBeDefined();
    expect(testingModule.get(McpLegacySessionManager)).toBeDefined();
    expect(testingModule.get(McpRequestPipeline)).toBeDefined();
    const app = testingModule.createNestApplication();
    expect(mountMcpHttpBoundary(app)).toBe(false);
    app.setGlobalPrefix('ai');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    try {
      await request(app.getHttpServer()).post('/ai/v1/mcp').expect(404);
    } finally {
      await app.close();
    }
  });

  it('accepts a fake verifier in test and exposes one exact MCP URL when enabled', async () => {
    const nowEpoch = Math.floor(Date.now() / 1_000);
    const fakeVerifier = new FakeVerifier({
      approvedIssuer: 'https://issuer.mcp.test',
      tokens: {
        'fake-token': {
          issuer: 'https://issuer.mcp.test',
          subject: 'subject-a',
          audience: 'https://resource.mcp.test/ai/v1/mcp',
          clientId: 'client-a',
          scopes: ['learning:read'],
          issuedAtEpochSeconds: nowEpoch - 60,
          notBeforeEpochSeconds: nowEpoch - 60,
          expiresAtEpochSeconds: nowEpoch + 3_600,
          active: true,
          authorizationVersion: 1,
          verificationMethodVersion: 'fake.v1',
          tokenType: 'mcp_access',
        },
      },
    });
    const rawHandler = {
      handle: jest.fn(async () =>
        Response.json({ jsonrpc: '2.0', id: 1, result: { ok: true } }),
      ),
    };
    const enabledConfig = Object.freeze({
      ...resolveMcpRuntimeConfig({}),
      enabled: true,
    });
    const testingModule = await Test.createTestingModule({
      imports: [McpModule],
    })
      .overrideProvider(MCP_RUNTIME_CONFIG)
      .useValue(enabledConfig)
      .overrideProvider(MCP_ENDPOINT_OPTIONS)
      .useValue({
        resource: 'https://resource.mcp.test/ai/v1/mcp',
        resourceMetadataUrl:
          'https://resource.mcp.test/.well-known/oauth-protected-resource/ai/v1/mcp',
        authorizationServers: ['https://issuer.mcp.test'],
      })
      .overrideProvider(MCP_IDENTITY_HMAC_KEY)
      .useValue('module-test-hmac-key-00000000000001')
      .overrideProvider(MCP_ACCESS_TOKEN_VERIFIER)
      .useValue(fakeVerifier)
      .overrideProvider(MCP_HTTP_REQUEST_HANDLER)
      .useValue(rawHandler)
      .overrideProvider(MCP_PROTECTED_RESOURCE_OPTIONS)
      .useValue({
        enabled: true,
        resource: 'https://resource.mcp.test/ai/v1/mcp',
        authorizationServers: ['https://issuer.mcp.test'],
        scopesSupported: ['learning:read', 'quiz:create', 'answer:submit'],
      })
      .compile();
    expect(testingModule.get(MCP_ACCESS_TOKEN_VERIFIER)).toBe(fakeVerifier);
    expect(testingModule.get(McpProtectedResourceController)).toBeDefined();

    const app = testingModule.createNestApplication();
    expect(mountMcpHttpBoundary(app)).toBe(true);
    app.setGlobalPrefix('ai', {
      exclude: [
        {
          path: '.well-known/oauth-protected-resource/ai/v1/mcp',
          method: RequestMethod.GET,
        },
      ],
    });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    try {
      await request(app.getHttpServer()).post('/ai/v1/mcp').expect(200);
      await request(app.getHttpServer()).post('/ai/v1/mcp/extra').expect(404);
      await request(app.getHttpServer()).post('/ai/v1/mcp-other').expect(404);
      const metadata = await request(app.getHttpServer())
        .get('/.well-known/oauth-protected-resource/ai/v1/mcp')
        .expect(200);
      expect(metadata.body).toMatchObject({
        resource: 'https://resource.mcp.test/ai/v1/mcp',
        authorization_servers: ['https://issuer.mcp.test'],
      });
      expect(rawHandler.handle).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
