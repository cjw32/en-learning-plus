import type {
  KnowledgeAccessScope,
  KnowledgeCategory,
  KnowledgeChunkStatus,
  KnowledgeCitationStatus,
  KnowledgeDocumentStatus,
  KnowledgeReleaseStatus,
  KnowledgeSourceStatus,
  PrismaClient,
} from '@libs/shared/generated/prisma/client';
import type {
  CitationPersistence,
  KnowledgeCitationRecord,
} from './citation-issuer.service';

export type CitationProjectionCandidate = Readonly<{
  citationId: string;
  citationStatus: KnowledgeCitationStatus;
  storedExcerpt: string | null;
  excerptHash: string;
  contentVersion: string;
  requestUserId: string;
  chunk: Readonly<{
    id: string;
    content: string;
    source: string;
    title: string;
    category: KnowledgeCategory;
    wordId: string | null;
    courseId: string | null;
    userId: string | null;
    contentVersion: string;
    status: KnowledgeChunkStatus;
  }> | null;
  document: Readonly<{
    id: string;
    sourceRecordType: string;
    sourceRecordId: string;
    accessScope: KnowledgeAccessScope;
    wordId: string | null;
    courseId: string | null;
    userId: string | null;
    contentVersion: string;
    status: KnowledgeDocumentStatus;
    release: Readonly<{
      contentVersion: string;
      status: KnowledgeReleaseStatus;
    }>;
    knowledgeSource: Readonly<{
      status: KnowledgeSourceStatus;
      allowExcerptDisplay: boolean;
      verifiedAt: Date | null;
      validFrom: Date | null;
      validUntil: Date | null;
      revokedAt: Date | null;
      deletedAt: Date | null;
    }>;
  }> | null;
}>;

export interface CitationProjectionRepository {
  findForSubject(
    subjectId: string,
    citationId: string,
  ): Promise<CitationProjectionCandidate | null>;
  hasPurchasedCourse(subjectId: string, courseId: string): Promise<boolean>;
}

export interface CitationReplayLookup {
  findRequestIdsByCitationIds(
    citationIds: readonly string[],
  ): Promise<readonly string[]>;
}

type CitationPrismaClient = Pick<
  PrismaClient,
  'knowledgeCitation' | 'courseRecord'
>;

export class PrismaCitationRepository
  implements CitationPersistence, CitationProjectionRepository, CitationReplayLookup
{
  constructor(private readonly prisma: CitationPrismaClient) {}

  async insertMany(records: readonly KnowledgeCitationRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.prisma.knowledgeCitation.createMany({
      data: records.map((record) => ({
        id: record.citationId,
        requestId: record.requestId,
        chunkId: record.chunkId,
        documentId: record.documentId,
        sourceId: record.sourceId,
        sourceIdHash: record.sourceIdHash,
        contentVersion: record.contentVersion,
        embeddingVersion: record.embeddingVersion,
        excerpt: record.excerpt,
        excerptHash: record.excerptHash,
        rank: record.rank,
        relevanceScore: record.relevanceScore,
        status: 'ACTIVE',
      })),
    });
  }

  async hasId(citationId: string): Promise<boolean> {
    return (
      (await this.prisma.knowledgeCitation.count({
        where: { id: citationId },
      })) > 0
    );
  }

  async findForSubject(
    subjectId: string,
    citationId: string,
  ): Promise<CitationProjectionCandidate | null> {
    const row = await this.prisma.knowledgeCitation.findFirst({
      where: {
        id: citationId,
        request: { is: { userId: subjectId } },
      },
      select: {
        id: true,
        status: true,
        excerpt: true,
        excerptHash: true,
        contentVersion: true,
        request: { select: { userId: true } },
        chunk: {
          select: {
            id: true,
            content: true,
            source: true,
            title: true,
            category: true,
            wordId: true,
            courseId: true,
            userId: true,
            contentVersion: true,
            status: true,
          },
        },
        document: {
          select: {
            id: true,
            sourceRecordType: true,
            sourceRecordId: true,
            accessScope: true,
            wordId: true,
            courseId: true,
            userId: true,
            contentVersion: true,
            status: true,
            release: { select: { contentVersion: true, status: true } },
            knowledgeSource: {
              select: {
                status: true,
                allowExcerptDisplay: true,
                verifiedAt: true,
                validFrom: true,
                validUntil: true,
                revokedAt: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });
    if (!row) return null;
    return Object.freeze({
      citationId: row.id,
      citationStatus: row.status,
      storedExcerpt: row.excerpt,
      excerptHash: row.excerptHash,
      contentVersion: row.contentVersion,
      requestUserId: row.request.userId,
      chunk: row.chunk ? Object.freeze(row.chunk) : null,
      document: row.document
        ? Object.freeze({
            ...row.document,
            release: Object.freeze(row.document.release),
            knowledgeSource: Object.freeze(row.document.knowledgeSource),
          })
        : null,
    });
  }

  async hasPurchasedCourse(
    subjectId: string,
    courseId: string,
  ): Promise<boolean> {
    return (
      (await this.prisma.courseRecord.count({
        where: { userId: subjectId, courseId, isPurchased: true },
      })) > 0
    );
  }

  async findRequestIdsByCitationIds(
    citationIds: readonly string[],
  ): Promise<readonly string[]> {
    if (citationIds.length === 0) return [];
    const rows = await this.prisma.knowledgeCitation.findMany({
      where: { id: { in: [...new Set(citationIds)] } },
      distinct: ['requestId'],
      select: { requestId: true },
    });
    return rows.map((row) => row.requestId);
  }
}
