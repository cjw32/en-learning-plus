import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import type { Prisma } from '@libs/shared/generated/prisma/client';
import type { McpPersistenceIdentity } from './mcp-subject.repository';

function traceWhere(identity: McpPersistenceIdentity) {
  return {
    authorizationId: identity.authorizationId,
    authorization: {
      userId: identity.userId,
      issuer: identity.issuer,
      audience: identity.audience,
      clientId: identity.clientId,
      authorizationVersion: identity.authorizationVersion,
      status: 'ACTIVE' as const,
      subjectMapping: {
        issuer: identity.issuer,
        subjectHmac: identity.subjectHmac,
        userId: identity.userId,
        status: 'ACTIVE' as const,
      },
    },
  };
}

@Injectable()
export class McpTraceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOwnedByTraceId(identity: McpPersistenceIdentity, traceId: string) {
    return this.prisma.mcpTrace.findFirst({
      where: { traceId, ...traceWhere(identity) },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
  }

  createScoped(
    identity: McpPersistenceIdentity,
    data: Omit<Prisma.McpTraceUncheckedCreateInput, 'authorizationId'>,
  ) {
    return this.prisma.mcpTrace.create({
      data: { ...data, authorizationId: identity.authorizationId },
    });
  }

  async appendStepScoped(
    identity: McpPersistenceIdentity,
    traceId: string,
    data: Omit<Prisma.McpTraceStepUncheckedCreateInput, 'traceId'>,
  ) {
    const trace = await this.prisma.mcpTrace.findFirst({
      where: { traceId, ...traceWhere(identity) },
      select: { id: true },
    });
    if (!trace) return null;
    return this.prisma.mcpTraceStep.create({
      data: { ...data, traceId: trace.id },
    });
  }
}
