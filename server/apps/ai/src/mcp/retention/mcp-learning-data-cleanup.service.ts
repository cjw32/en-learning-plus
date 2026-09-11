import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  LearningDataDeletionService,
  type LearningDataCleanupPort,
} from '@libs/learning';
import { PrismaService } from '@libs/shared';

export interface McpLearningDataCleanupPort {
  revokeAccess(userId: string, at: Date): Promise<void>;
  purgeOwnedData(userId: string): Promise<void>;
}

@Injectable()
export class McpLearningDataCleanupService
  implements LearningDataCleanupPort, OnModuleInit
{
  readonly cleanupKey = 'mcp';
  constructor(
    private readonly repository: McpLearningDataCleanupPort,
    private readonly deletion?: LearningDataDeletionService,
  ) {}
  onModuleInit() {
    this.deletion?.registerCleanup(this);
  }
  hideImmediately(subjectId: string, requestedAt: Date) {
    return this.repository.revokeAccess(subjectId, requestedAt);
  }
  purgeOwnedData(subjectId: string) {
    return this.repository.purgeOwnedData(subjectId);
  }
}

@Injectable()
export class PrismaMcpLearningDataCleanupRepository implements McpLearningDataCleanupPort {
  constructor(private readonly prisma: PrismaService) {}
  async revokeAccess(userId: string, at: Date) {
    await this.prisma.$transaction(async (db) => {
      await db.mcpClientAuthorization.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: at,
          authorizationVersion: { increment: 1 },
        },
      });
      await db.mcpSubjectMapping.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'DELETING', revokedAt: at },
      });
      await db.mcpWriteConfirmation.updateMany({
        where: { userId, state: { in: ['PENDING', 'CONFIRMED', 'CLAIMED'] } },
        data: { state: 'CANCELLED' },
      });
    });
  }
  async purgeOwnedData(userId: string) {
    await this.prisma.mcpSubjectMapping.deleteMany({ where: { userId } });
  }
}
