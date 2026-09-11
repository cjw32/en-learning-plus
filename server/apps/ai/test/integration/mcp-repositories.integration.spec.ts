import { McpAuthorizationRepository } from '../../src/mcp/persistence/mcp-authorization.repository';
import { McpInvocationRepository } from '../../src/mcp/persistence/mcp-invocation.repository';
import {
  McpSubjectRepository,
  type McpPersistenceIdentity,
} from '../../src/mcp/persistence/mcp-subject.repository';
import { McpTraceRepository } from '../../src/mcp/persistence/mcp-trace.repository';

const identityA: McpPersistenceIdentity = Object.freeze({
  issuer: 'https://issuer.mcp.test',
  subjectHmac: 'subject_hash_a',
  userId: 'user-a',
  authorizationId: 'authorization-a',
  clientId: 'client-a',
  audience: 'https://resource.mcp.test/ai/v1/mcp',
  authorizationVersion: 3,
});

function createPrismaDouble() {
  return {
    mcpSubjectMapping: {
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    mcpClientAuthorization: {
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    mcpInvocation: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => data),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    mcpTrace: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => data),
    },
    mcpTraceStep: {
      create: jest.fn(async ({ data }) => data),
    },
  };
}

describe('MCP persistence ownership anchors', () => {
  it('uses only verified issuer/subject to bootstrap a mapping', async () => {
    const prisma = createPrismaDouble();
    const repository = new McpSubjectRepository(prisma as never);
    await repository.findMappingForVerifiedSubject(identityA);

    expect(prisma.mcpSubjectMapping.findFirst).toHaveBeenCalledWith({
      where: {
        issuer: identityA.issuer,
        subjectHmac: identityA.subjectHmac,
        status: 'ACTIVE',
      },
    });
  });

  it('anchors mapped subject and authorization reads to every identity axis', async () => {
    const prisma = createPrismaDouble();
    await new McpSubjectRepository(prisma as never).findOwnedActive(identityA);
    await new McpAuthorizationRepository(prisma as never).findOwnedActive(
      identityA,
    );

    const serialized = JSON.stringify([
      prisma.mcpSubjectMapping.findFirst.mock.calls[0]?.[0],
      prisma.mcpClientAuthorization.findFirst.mock.calls[0]?.[0],
    ]);
    for (const value of [
      identityA.issuer,
      identityA.subjectHmac,
      identityA.userId,
      identityA.authorizationId,
      identityA.clientId,
      identityA.audience,
      String(identityA.authorizationVersion),
    ]) {
      expect(serialized).toContain(value);
    }
  });

  it('never queries an invocation or trace by a naked ID', async () => {
    const prisma = createPrismaDouble();
    await new McpInvocationRepository(prisma as never).findOwnedById(
      identityA,
      'invocation-a',
    );
    await new McpTraceRepository(prisma as never).findOwnedByTraceId(
      identityA,
      'trace-a',
    );

    const serialized = JSON.stringify([
      prisma.mcpInvocation.findFirst.mock.calls[0]?.[0],
      prisma.mcpTrace.findFirst.mock.calls[0]?.[0],
    ]);
    for (const value of [
      identityA.issuer,
      identityA.subjectHmac,
      identityA.userId,
      identityA.authorizationId,
      identityA.clientId,
      identityA.audience,
      String(identityA.authorizationVersion),
    ]) {
      expect(serialized).toContain(value);
    }
  });

  it('overwrites attempted ownership injection on scoped creates', async () => {
    const prisma = createPrismaDouble();
    const repository = new McpInvocationRepository(prisma as never);
    await repository.createScoped(identityA, {
      id: 'invocation-a',
      authorizationId: 'attacker-authorization',
      userId: 'attacker-user',
      traceId: 'trace_create_0001',
      protocolEra: 'MODERN_2026_07_28',
      capabilityType: 'DISCOVERY',
      capabilityName: 'server/discover',
      capabilityVersion: 'en-learning.mcp.v1',
      deadlineAt: new Date('2026-09-11T08:00:02.000Z'),
      updatedAt: new Date('2026-09-11T08:00:00.000Z'),
    } as never);

    expect(prisma.mcpInvocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorizationId: identityA.authorizationId,
        userId: identityA.userId,
      }),
    });
    const persisted = prisma.mcpInvocation.create.mock.calls[0]?.[0]?.data;
    expect(persisted.authorizationId).not.toBe('attacker-authorization');
    expect(persisted.userId).not.toBe('attacker-user');
  });

  it('does not append a trace step when the scoped trace is absent', async () => {
    const prisma = createPrismaDouble();
    const result = await new McpTraceRepository(
      prisma as never,
    ).appendStepScoped(identityA, 'trace-other-user', {
      id: 'step-a',
      sequence: 0,
      stepType: 'AUTH',
      component: 'authorization',
      operation: 'verify',
      status: 'FAILED',
      startedAt: new Date('2026-09-11T08:00:00.000Z'),
    });

    expect(result).toBeNull();
    expect(prisma.mcpTraceStep.create).not.toHaveBeenCalled();
  });
});
