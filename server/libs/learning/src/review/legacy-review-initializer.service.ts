import { recordStudyDay } from '@libs/shared/study/study-day';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import { scheduleSm2Review } from './sm2-review-scheduler';

@Injectable()
export class LegacyReviewInitializerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async saveWordMaster(subjectId: string, wordIds: readonly string[]) {
    if (
      !Array.isArray(wordIds) ||
      wordIds.length === 0 ||
      wordIds.length > 100 ||
      wordIds.some(
        (id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id),
      )
    )
      throw new BadRequestException('请选择有效的学习单词');
    const uniqueWordIds = [...new Set(wordIds)];
    return this.prisma.$transaction(async (database) => {
      const created = await database.wordBookRecord.createMany({
        data: uniqueWordIds.map((wordId) => ({
          wordId,
          userId: subjectId,
          isMaster: true,
        })),
        skipDuplicates: true,
      });
      const profile = await database.learnerProfile.findUnique({
        where: { userId: subjectId },
        select: { timezone: true },
      });
      const reviewedAt = this.now();
      const initialState = {
        reviewState: 'NEW' as const,
        repetitionCount: 0,
        easeFactor: 2.5,
        intervalDays: 0,
      };
      let dueAt: Date;
      try {
        dueAt = scheduleSm2Review({
          current: initialState,
          quality: 5,
          reviewedAt,
          timezone: profile?.timezone ?? 'Asia/Shanghai',
        }).dueAt;
      } catch {
        dueAt = scheduleSm2Review({
          current: initialState,
          quality: 5,
          reviewedAt,
          timezone: 'Asia/Shanghai',
        }).dueAt;
      }
      for (const wordId of uniqueWordIds) {
        await database.learningItemState.upsert({
          where: {
            userId_targetType_targetKey: {
              userId: subjectId,
              targetType: 'WORD',
              targetKey: wordId,
            },
          },
          create: {
            userId: subjectId,
            targetType: 'WORD',
            targetKey: wordId,
            wordId,
            reviewState: 'REVIEW',
            repetitionCount: 1,
            easeFactor: 2.5,
            intervalDays: 1,
            dueAt,
            lastReviewedAt: reviewedAt,
          },
          update: { wordId },
        });
      }
      if (created.count > 0)
        await recordStudyDay(database, subjectId, reviewedAt);
      return database.user.update({
        where: { id: subjectId },
        data: { wordNumber: { increment: created.count } },
        select: { wordNumber: true, dayNumber: true },
      });
    });
  }
}
