import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';

export type McpVerifiedSubjectKey = Readonly<{
  issuer: string;
  subjectHmac: string;
}>;

export type McpPersistenceIdentity = McpVerifiedSubjectKey &
  Readonly<{
    userId: string;
    authorizationId: string;
    clientId: string;
    audience: string;
    authorizationVersion: number;
  }>;

@Injectable()
export class McpSubjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMappingForVerifiedSubject(key: McpVerifiedSubjectKey) {
    return this.prisma.mcpSubjectMapping.findFirst({
      where: {
        issuer: key.issuer,
        subjectHmac: key.subjectHmac,
        status: 'ACTIVE',
      },
    });
  }

  findOwnedActive(identity: McpPersistenceIdentity) {
    return this.prisma.mcpSubjectMapping.findFirst({
      where: {
        issuer: identity.issuer,
        subjectHmac: identity.subjectHmac,
        userId: identity.userId,
        status: 'ACTIVE',
        clientAuthorizations: {
          some: {
            id: identity.authorizationId,
            clientId: identity.clientId,
            audience: identity.audience,
            authorizationVersion: identity.authorizationVersion,
            status: 'ACTIVE',
          },
        },
      },
    });
  }

  markDeletingByUser(userId: string, at: Date) {
    return this.prisma.mcpSubjectMapping.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'DELETING', revokedAt: at },
    });
  }
}
