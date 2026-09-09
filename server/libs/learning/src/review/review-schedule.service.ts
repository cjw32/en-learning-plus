import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import type { Prisma } from '@libs/shared/generated/prisma/client';
import { z } from '@en/common/coach/zod';
import {
  LearningDomainError,
  ownedResourceNotFound,
} from '../common/learning-errors';

const dueQuerySchema = z
  .object({
    learningDate: z.iso.date(),
    timezone: z.string().min(1).max(64),
    limit: z.number().int().min(1).max(100),
    courseId: z.string().max(64).optional(),
  })
  .strict();

export type DueWordRow = {
  wordId: string;
  word: string;
  definition: string | null;
  translation: string | null;
  reviewState: 'LEARNING' | 'REVIEW' | 'MASTERED';
  dueAt: Date;
  lastQuality: number | null;
};

export interface ReviewScheduleRepository {
  findPurchasedCourseTag(
    subjectId: string,
    courseId: string,
  ): Promise<string | null>;
  findDueWordStates(
    subjectId: string,
    query: { before: Date; limit: number; courseTag?: string },
  ): Promise<{ rows: DueWordRow[]; total: number }>;
}

@Injectable()
export class PrismaReviewScheduleRepository
  implements ReviewScheduleRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async findPurchasedCourseTag(subjectId: string, courseId: string) {
    const record = await this.prisma.courseRecord.findFirst({
      where: { userId: subjectId, courseId, isPurchased: true },
      select: { course: { select: { value: true } } },
    });
    return record?.course.value ?? null;
  }

  async findDueWordStates(
    subjectId: string,
    query: { before: Date; limit: number; courseTag?: string },
  ) {
    const where: Prisma.LearningItemStateWhereInput = {
      userId: subjectId,
      targetType: 'WORD' as const,
      dueAt: { not: null, lt: query.before },
      reviewState: { in: ['LEARNING', 'REVIEW', 'MASTERED'] },
      word: {
        is: {
          ...(query.courseTag
            ? {
                tag: {
                  contains: query.courseTag,
                  mode: 'insensitive' as const,
                },
              }
            : {}),
        },
      },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.learningItemState.findMany({
        where,
        take: query.limit,
        orderBy: [
          { dueAt: 'asc' },
          { lastQuality: 'asc' },
          { targetKey: 'asc' },
        ],
        select: {
          reviewState: true,
          dueAt: true,
          lastQuality: true,
          word: {
            select: {
              id: true,
              word: true,
              definition: true,
              translation: true,
            },
          },
        },
      }),
      this.prisma.learningItemState.count({ where }),
    ]);
    return {
      total,
      rows: rows
        .filter(
          (row): row is typeof row & { word: NonNullable<typeof row.word>; dueAt: Date } =>
            Boolean(row.word && row.dueAt),
        )
        .map((row) => ({
          wordId: row.word.id,
          word: row.word.word,
          definition: row.word.definition,
          translation: row.word.translation,
          reviewState: row.reviewState as DueWordRow['reviewState'],
          dueAt: row.dueAt,
          lastQuality: row.lastQuality,
        })),
    };
  }
}

function assertTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new LearningDomainError(
      'VALIDATION_FAILED',
      '复习时区参数无效',
      400,
    );
  }
}

function nextIsoDate(date: string) {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

function zonedStartOfDay(date: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    guess += target - represented;
  }
  return new Date(guess);
}

@Injectable()
export class ReviewScheduleService {
  constructor(
    private readonly repository: ReviewScheduleRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getDueWords(subjectId: string, untrustedInput: unknown) {
    const parsed = dueQuerySchema.safeParse(untrustedInput);
    if (!parsed.success || !subjectId) {
      throw new LearningDomainError(
        'VALIDATION_FAILED',
        '复习计划参数无效',
        400,
      );
    }
    assertTimeZone(parsed.data.timezone);
    const courseTag = parsed.data.courseId
      ? await this.repository.findPurchasedCourseTag(
          subjectId,
          parsed.data.courseId,
        )
      : undefined;
    if (parsed.data.courseId && !courseTag) throw ownedResourceNotFound();
    const before = zonedStartOfDay(
      nextIsoDate(parsed.data.learningDate),
      parsed.data.timezone,
    );
    const result = await this.repository.findDueWordStates(subjectId, {
      before,
      limit: parsed.data.limit,
      ...(courseTag ? { courseTag } : {}),
    });
    return {
      asOf: this.now(),
      words: result.rows.map((row, index) => ({
        ...row,
        priority: index + 1,
        reason:
          row.lastQuality !== null && row.lastQuality < 3
            ? '最近掌握较弱且已到复习时间'
            : '已到复习时间',
        citation: {
          sourceId: `word:${row.wordId}`,
          materialType: 'word' as const,
          title: row.word,
          locator: `dictionary/${row.wordId}`,
          supports: row.definition || row.translation || row.word,
          accessScope: 'PUBLIC' as const,
        },
      })),
      totalDue: result.total,
      truncated: result.total > result.rows.length,
    };
  }
}
