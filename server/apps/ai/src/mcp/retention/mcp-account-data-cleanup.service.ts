import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  LearningDataDeletionService,
  type LearningDataCleanupPort,
} from '@libs/learning';
import { PrismaService } from '@libs/shared';

@Injectable()
export class McpAccountDataCleanupService
  implements LearningDataCleanupPort, OnModuleInit
{
  readonly cleanupKey = 'mcp';

  constructor(
    private readonly prisma: PrismaService,
    private readonly learningDeletion: LearningDataDeletionService,
  ) {}

  onModuleInit(): void {
    this.learningDeletion.registerCleanup(this);
  }

  async hideImmediately(subjectId: string, requestedAt: Date): Promise<void> {
    await this.prisma.$transaction(async (database) => {
      await database.mcpClientAuthorization.updateMany({
        where: { userId: subjectId, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: requestedAt,
          authorizationVersion: { increment: 1 },
        },
      });
      await database.mcpSubjectMapping.updateMany({
        where: { userId: subjectId, status: 'ACTIVE' },
        data: { status: 'DELETING', revokedAt: requestedAt },
      });
    });
  }

  async purgeOwnedData(subjectId: string): Promise<void> {
    // McpSubjectMapping owns the authorization subtree. Database cascades remove
    // invocations, intents, confirmations and traces without unscoped queries.
    await this.prisma.mcpSubjectMapping.deleteMany({
      where: { userId: subjectId },
    });
  }
}
