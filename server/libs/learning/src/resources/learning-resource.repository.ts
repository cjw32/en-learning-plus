import type { PrismaClient } from '@libs/shared/generated/prisma/client';

export type AuthorizedCourseMaterialRecord = Readonly<{
  documentId: string;
  courseId: string;
  materialId: string;
  title: string;
  contentVersion: string;
  sourceUpdatedAt: Date;
  sourceKey: string;
  sourceName: string;
  rightsVersion: string;
  releaseContentVersion: string;
  releaseRightsVersion: string;
  entitledUserIds: readonly string[];
  chunks: readonly Readonly<{
    id: string;
    ordinal: number;
    content: string;
    contentVersion: string;
    courseId: string | null;
  }>[];
}>;

export interface LearningResourceRepository {
  findAuthorizedCourseMaterial(
    input: Readonly<{
      userId: string;
      courseId: string;
      materialId: string;
      at: Date;
    }>,
  ): Promise<AuthorizedCourseMaterialRecord | null>;
}

type LearningResourcePrismaClient = Pick<PrismaClient, 'knowledgeDocument'>;

export class PrismaLearningResourceRepository implements LearningResourceRepository {
  constructor(private readonly prisma: LearningResourcePrismaClient) {}

  async findAuthorizedCourseMaterial(
    input: Readonly<{
      userId: string;
      courseId: string;
      materialId: string;
      at: Date;
    }>,
  ): Promise<AuthorizedCourseMaterialRecord | null> {
    const row = await this.prisma.knowledgeDocument.findFirst({
      where: {
        courseId: input.courseId,
        sourceRecordId: input.materialId,
        accessScope: 'OWNED_COURSE',
        visibility: 'private',
        status: 'ACTIVE',
        course: {
          is: {
            courseRecords: {
              some: { userId: input.userId, isPurchased: true },
            },
          },
        },
        release: { is: { status: 'ACTIVE', invalidatedAt: null } },
        knowledgeSource: {
          is: {
            status: 'ACTIVE',
            allowExcerptDisplay: true,
            verifiedAt: { not: null },
            revokedAt: null,
            deletedAt: null,
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: input.at } }] },
              { OR: [{ validUntil: null }, { validUntil: { gt: input.at } }] },
              {
                fieldPolicies: {
                  some: {
                    recordType: 'Course',
                    fieldName: 'content',
                    allowExcerptDisplay: true,
                  },
                },
              },
            ],
          },
        },
      },
      orderBy: [{ sourceUpdatedAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        courseId: true,
        sourceRecordId: true,
        title: true,
        contentVersion: true,
        sourceUpdatedAt: true,
        release: {
          select: { contentVersion: true, rightsVersion: true },
        },
        knowledgeSource: {
          select: {
            sourceKey: true,
            name: true,
            rightsVersion: true,
          },
        },
        course: {
          select: {
            courseRecords: {
              where: { userId: input.userId, isPurchased: true },
              take: 1,
              select: { userId: true },
            },
          },
        },
        chunks: {
          where: {
            status: 'ACTIVE',
            courseId: input.courseId,
          },
          orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
          take: 20,
          select: {
            id: true,
            ordinal: true,
            content: true,
            contentVersion: true,
            courseId: true,
          },
        },
      },
    });
    if (!row || !row.courseId) return null;

    return Object.freeze({
      documentId: row.id,
      courseId: row.courseId,
      materialId: row.sourceRecordId,
      title: row.title,
      contentVersion: row.contentVersion,
      sourceUpdatedAt: row.sourceUpdatedAt,
      sourceKey: row.knowledgeSource.sourceKey,
      sourceName: row.knowledgeSource.name,
      rightsVersion: row.knowledgeSource.rightsVersion,
      releaseContentVersion: row.release.contentVersion,
      releaseRightsVersion: row.release.rightsVersion,
      entitledUserIds: Object.freeze(
        row.course?.courseRecords.map(({ userId }) => userId) ?? [],
      ),
      chunks: Object.freeze(row.chunks.map((chunk) => Object.freeze(chunk))),
    });
  }
}
