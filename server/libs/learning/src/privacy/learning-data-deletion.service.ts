import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';

export interface LearningDataDeletionRepository {
  hideImmediately(subjectId: string, requestedAt: Date): Promise<void>;
  purgeOwnedData(subjectId: string): Promise<void>;
}

@Injectable()
export class LearningDataDeletionService {
  constructor(private readonly repository: LearningDataDeletionRepository) {}

  hideImmediately(subjectId: string, requestedAt: Date): Promise<void> {
    return this.repository.hideImmediately(subjectId, requestedAt);
  }

  purgeOwnedData(subjectId: string): Promise<void> {
    return this.repository.purgeOwnedData(subjectId);
  }
}

@Injectable()
export class PrismaLearningDataDeletionRepository implements LearningDataDeletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hideImmediately(subjectId: string, requestedAt: Date) {
    await this.prisma.$transaction([
      this.prisma.learnerProfile.deleteMany({ where: { userId: subjectId } }),
      this.prisma.coachConversation.updateMany({
        where: { userId: subjectId, status: 'ACTIVE' },
        data: { status: 'DELETING', deletedAt: requestedAt },
      }),
    ]);
  }

  async purgeOwnedData(subjectId: string) {
    await this.prisma.$transaction([
      this.prisma.learningAttempt.deleteMany({ where: { userId: subjectId } }),
      this.prisma.learningItemState.deleteMany({
        where: { userId: subjectId },
      }),
      this.prisma.learnerProfile.deleteMany({ where: { userId: subjectId } }),
    ]);
  }
}
