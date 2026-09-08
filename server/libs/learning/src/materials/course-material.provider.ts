import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import {
  LearningMaterialProvider,
  LearningMaterialSearchContext,
} from './learning-material.provider';

export interface CourseMaterialRepository {
  searchOwnedCourses(
    subjectId: string,
    query: string,
    limit: number,
    courseId?: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      value: string;
      description: string | null;
      updatedAt: Date;
    }>
  >;
}

@Injectable()
export class PrismaCourseMaterialRepository implements CourseMaterialRepository {
  constructor(private readonly prisma: PrismaService) {}

  searchOwnedCourses(
    subjectId: string,
    query: string,
    limit: number,
    courseId?: string,
  ) {
    return this.prisma.course.findMany({
      where: {
        ...(courseId ? { id: courseId } : {}),
        courseRecords: { some: { userId: subjectId, isPurchased: true } },
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { value: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        value: true,
        description: true,
        updatedAt: true,
      },
    });
  }
}

@Injectable()
export class CourseMaterialProvider implements LearningMaterialProvider {
  readonly materialType = 'course' as const;

  constructor(private readonly repository: CourseMaterialRepository) {}

  async search(context: LearningMaterialSearchContext) {
    const courses = await this.repository.searchOwnedCourses(
      context.subjectId,
      context.query,
      context.limit,
      context.courseId,
    );
    return {
      available: true,
      materials: courses.map((course) => ({
        citation: {
          sourceId: `course:${course.id}`,
          materialType: this.materialType,
          title: course.name,
          locator: `course/${course.id}`,
          supports: course.description || course.value,
          accessScope: 'OWNED_COURSE' as const,
        },
        summary: course.description || course.value,
        freshness: course.updatedAt,
      })),
    };
  }
}
