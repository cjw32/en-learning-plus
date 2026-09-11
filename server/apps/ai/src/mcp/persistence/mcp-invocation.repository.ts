import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import type { Prisma } from '@libs/shared/generated/prisma/client';
import type { McpPersistenceIdentity } from './mcp-subject.repository';

function invocationWhere(identity: McpPersistenceIdentity) {
  return {
    authorizationId: identity.authorizationId,
    userId: identity.userId,
    authorization: {
      issuer: identity.issuer,
      audience: identity.audience,
      clientId: identity.clientId,
      authorizationVersion: identity.authorizationVersion,
      status: 'ACTIVE' as const,
      subjectMapping: {
        subjectHmac: identity.subjectHmac,
        issuer: identity.issuer,
        userId: identity.userId,
        status: 'ACTIVE' as const,
      },
    },
  };
}

@Injectable()
export class McpInvocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOwnedById(identity: McpPersistenceIdentity, invocationId: string) {
    return this.prisma.mcpInvocation.findFirst({
      where: { id: invocationId, ...invocationWhere(identity) },
    });
  }

  createScoped(
    identity: McpPersistenceIdentity,
    data: Omit<
      Prisma.McpInvocationUncheckedCreateInput,
      'authorizationId' | 'userId'
    >,
  ) {
    return this.prisma.mcpInvocation.create({
      data: {
        ...data,
        authorizationId: identity.authorizationId,
        userId: identity.userId,
      },
    });
  }

  finishOwned(
    identity: McpPersistenceIdentity,
    invocationId: string,
    data: Prisma.McpInvocationUpdateManyMutationInput,
  ) {
    return this.prisma.mcpInvocation.updateMany({
      where: { id: invocationId, ...invocationWhere(identity) },
      data,
    });
  }
}
