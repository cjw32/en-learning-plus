import { studyDate, STUDY_TIMEZONE } from '@libs/shared/study/study-day';
import { NotFoundException, Injectable } from '@nestjs/common';
import { CreateLearnDto } from './dto/create-learn.dto';
import { UpdateLearnDto } from './dto/update-learn.dto';
import { PrismaService, ResponseService } from '@libs/shared';
import { LegacyReviewInitializerService } from '@libs/learning';

@Injectable()
export class LearnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly response: ResponseService,
    private readonly legacyReview: LegacyReviewInitializerService,
  ) {}
  //读取单词列表
  async getWordList(id: string, userId: string) {
    //查询课程
    const courseRecord = await this.prisma.courseRecord.findFirst({
      where: {
        userId: userId,
        courseId: id,
        isPurchased: true,
      },
      include: {
        course: true,
      },
    });
    if (!courseRecord) {
      return this.response.error(null, '课程未购买');
    }
    const courseType = courseRecord.course.value;
    const words = await this.prisma.wordBook.findMany({
      where: {
        [courseType]: true,
        //掌握的单词不能被查出来
        wordBookRecords: {
          none: {
            userId: userId,
          },
        },
      },
      skip: 0, //跳过多少条
      take: 10, //取多少条
      orderBy: {
        frq: 'desc', //按频率排序
      },
    });
    return this.response.success(words);
  }
  //保存单词到wordBookRecord
  async saveWordMaster(wordIds: string[], userId: string) {
    const user = await this.legacyReview.saveWordMaster(userId, wordIds);
    return this.response.success({
      wordNumber: user.wordNumber,
      dayNumber: user.dayNumber,
    });
  }
  async getStudyStats(userId: string) {
    const date = studyDate();
    return this.prisma.$transaction(
      async (database) => {
        const user = await database.user.findUnique({
          where: { id: userId },
          select: { wordNumber: true, dayNumber: true },
        });
        if (!user) throw new NotFoundException('账号不可用');
        const today = await database.userStudyDay.findUnique({
          where: { userId_studyDate: { userId, studyDate: date } },
          select: { userId: true },
        });
        return this.response.success({
          ...user,
          checkedInToday: Boolean(today),
          studyDate: date,
          timezone: STUDY_TIMEZONE,
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
