import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import type { McpPersistenceIdentity } from './mcp-subject.repository';

export type McpPrincipalAuthorizationKey = Readonly<{
  subjectMappingId: string;
  subjectHmac: string;
  userId: string;
  issuer: string;
  audience: string;
  clientId: string;
  authorizationVersion: number;
}>;

function authorizationWhere(identity: McpPersistenceIdentity) {
  return {
    id: identity.authorizationId,
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
  };
}

@Injectable()
export class McpAuthorizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveForPrincipal(key: McpPrincipalAuthorizationKey) {
    return this.prisma.mcpClientAuthorization.findFirst({
      where: {
        subjectMappingId: key.subjectMappingId,
        userId: key.userId,
        issuer: key.issuer,
        audience: key.audience,
        clientId: key.clientId,
        authorizationVersion: key.authorizationVersion,
        status: 'ACTIVE',
        subjectMapping: {
          id: key.subjectMappingId,
          issuer: key.issuer,
          subjectHmac: key.subjectHmac,
          userId: key.userId,
          status: 'ACTIVE',
        },
      },
    });
  }

  findOwnedActive(identity: McpPersistenceIdentity) {
    return this.prisma.mcpClientAuthorization.findFirst({
      where: authorizationWhere(identity),
    });
  }

  async touchOwnedActive(identity: McpPersistenceIdentity, at: Date) {
    const result = await this.prisma.mcpClientAuthorization.updateMany({
      where: authorizationWhere(identity),
      data: { lastSeenAt: at },
    });
    return result.count === 1;
  }

  revokeOwned(identity: McpPersistenceIdentity, at: Date) {
    return this.prisma.mcpClientAuthorization.updateMany({
      where: authorizationWhere(identity),
      data: {
        status: 'REVOKED',
        revokedAt: at,
        authorizationVersion: { increment: 1 },
      },
    });
  }
}
