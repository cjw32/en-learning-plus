import type {
  KnowledgeCitationStatus,
  KnowledgeSourceStatus,
  PrismaClient,
} from '@libs/shared/generated/prisma/client';

type InvalidatingSourceStatus = Extract<
  KnowledgeSourceStatus,
  'REVOKED' | 'EXPIRED' | 'DELETED'
>;

type CitationInvalidStatus = Extract<
  KnowledgeCitationStatus,
  'ACCESS_REVOKED' | 'SOURCE_INVALID' | 'SOURCE_DELETED'
>;

export interface KnowledgeReplayInvalidator {
  purgeRequests(requestIds: readonly string[]): Promise<void>;
}

export interface KnowledgeInvalidationRepository {
  invalidateSource(input: {
    sourceId: string;
    sourceStatus: InvalidatingSourceStatus;
    citationStatus: CitationInvalidStatus;
    hiddenAt: Date;
  }): Promise<readonly string[]>;
  purgeDue(cutoff: Date): Promise<void>;
}

type MemoryState = {
  sourceId: string;
  sourceStatus: KnowledgeSourceStatus;
  hiddenAt: Date | null;
  releases: Array<{ id: string; status: 'ACTIVE' | 'INVALID' | 'PURGED' }>;
  documents: Array<{ id: string; status: 'ACTIVE' | 'INVALID' }>;
  chunks: Array<{ id: string; status: 'ACTIVE' | 'INVALID' }>;
  citations: Array<{
    id: string;
    requestId: string;
    status: KnowledgeCitationStatus;
    excerpt: string | null;
    sourceId: string | null;
  }>;
};

// Promise-based interface methods resolve synchronously in this test adapter.
/* eslint-disable @typescript-eslint/require-await */
export class InMemoryKnowledgeInvalidationRepository implements KnowledgeInvalidationRepository {
  private state: MemoryState | null = null;

  seed(input: {
    sourceId: string;
    releaseIds: readonly string[];
    documentIds: readonly string[];
    chunkIds: readonly string[];
    citations: readonly Readonly<{
      id: string;
      requestId: string;
      excerpt: string;
    }>[];
  }): void {
    this.state = {
      sourceId: input.sourceId,
      sourceStatus: 'ACTIVE',
      hiddenAt: null,
      releases: input.releaseIds.map((id) => ({ id, status: 'ACTIVE' })),
      documents: input.documentIds.map((id) => ({ id, status: 'ACTIVE' })),
      chunks: input.chunkIds.map((id) => ({ id, status: 'ACTIVE' })),
      citations: input.citations.map((citation) => ({
        ...citation,
        status: 'ACTIVE',
        sourceId: `source:${citation.id}`,
      })),
    };
  }

  async invalidateSource(input: {
    sourceId: string;
    sourceStatus: InvalidatingSourceStatus;
    citationStatus: CitationInvalidStatus;
    hiddenAt: Date;
  }): Promise<readonly string[]> {
    if (!this.state || this.state.sourceId !== input.sourceId) return [];
    this.state.sourceStatus = input.sourceStatus;
    this.state.hiddenAt = input.hiddenAt;
    for (const release of this.state.releases) release.status = 'INVALID';
    for (const document of this.state.documents) document.status = 'INVALID';
    for (const chunk of this.state.chunks) chunk.status = 'INVALID';
    for (const citation of this.state.citations) {
      citation.status = input.citationStatus;
      citation.excerpt = null;
      citation.sourceId = null;
    }
    return [...new Set(this.state.citations.map((item) => item.requestId))];
  }

  async purgeDue(cutoff: Date): Promise<void> {
    if (!this.state?.hiddenAt || this.state.hiddenAt > cutoff) return;
    this.state.documents = [];
    this.state.chunks = [];
    this.state.releases = this.state.releases.map((release) => ({
      ...release,
      status: 'PURGED',
    }));
    this.state.citations = this.state.citations.map((citation) => ({
      ...citation,
      status: 'PURGED',
      excerpt: null,
      sourceId: null,
    }));
  }

  snapshot(): MemoryState {
    if (!this.state) throw new Error('KNOWLEDGE_INVALIDATION_NOT_SEEDED');
    return structuredClone(this.state);
  }
}

/* eslint-enable @typescript-eslint/require-await */
type InvalidationPrismaClient = Pick<
  PrismaClient,
  '$transaction' | 'knowledgeRelease'
>;

export class PrismaKnowledgeInvalidationRepository implements KnowledgeInvalidationRepository {
  constructor(private readonly prisma: InvalidationPrismaClient) {}

  async invalidateSource(input: {
    sourceId: string;
    sourceStatus: InvalidatingSourceStatus;
    citationStatus: CitationInvalidStatus;
    hiddenAt: Date;
  }): Promise<readonly string[]> {
    return this.prisma.$transaction(async (database) => {
      const documents = await database.knowledgeDocument.findMany({
        where: { knowledgeSourceId: input.sourceId },
        select: {
          id: true,
          releaseId: true,
          chunks: { select: { id: true } },
          citations: { select: { requestId: true } },
        },
      });
      const documentIds = documents.map((document) => document.id);
      const releaseIds = [
        ...new Set(documents.map((document) => document.releaseId)),
      ];
      const chunkIds = documents.flatMap((document) =>
        document.chunks.map((chunk) => chunk.id),
      );
      const requestIds = [
        ...new Set(
          documents.flatMap((document) =>
            document.citations.map((citation) => citation.requestId),
          ),
        ),
      ];
      await database.knowledgeSource.updateMany({
        where: { id: input.sourceId },
        data: {
          status: input.sourceStatus,
          ...(input.sourceStatus === 'REVOKED'
            ? { revokedAt: input.hiddenAt }
            : {}),
          ...(input.sourceStatus === 'DELETED'
            ? { deletedAt: input.hiddenAt }
            : {}),
        },
      });
      if (documentIds.length) {
        await database.knowledgeCitation.updateMany({
          where: { documentId: { in: documentIds }, status: 'ACTIVE' },
          data: {
            status: input.citationStatus,
            excerpt: null,
            sourceId: null,
            invalidatedAt: input.hiddenAt,
          },
        });
        if (chunkIds.length) {
          await database.knowledgeEmbedding.updateMany({
            where: {
              chunkId: { in: chunkIds },
              status: { in: ['PENDING', 'READY'] },
            },
            data: { status: 'INVALID', failureCode: 'SOURCE_INVALID' },
          });
          await database.knowledgeChunk.updateMany({
            where: {
              id: { in: chunkIds },
              status: { in: ['STAGED', 'ACTIVE'] },
            },
            data: { status: 'INVALID' },
          });
        }
        await database.knowledgeDocument.updateMany({
          where: {
            id: { in: documentIds },
            status: { in: ['STAGED', 'ACTIVE'] },
          },
          data: { status: 'INVALID' },
        });
      }
      if (releaseIds.length) {
        await database.knowledgeRelease.updateMany({
          where: {
            id: { in: releaseIds },
            status: { in: ['BUILDING', 'READY', 'ACTIVE'] },
          },
          data: { status: 'INVALID', invalidatedAt: input.hiddenAt },
        });
      }
      return requestIds;
    });
  }

  async purgeDue(cutoff: Date): Promise<void> {
    await this.prisma.$transaction(async (database) => {
      const releases = await database.knowledgeRelease.findMany({
        where: { status: 'INVALID', invalidatedAt: { lte: cutoff } },
        select: {
          id: true,
          documents: {
            select: {
              id: true,
              citations: { select: { id: true } },
            },
          },
        },
      });
      const releaseIds = releases.map((release) => release.id);
      const documentIds = releases.flatMap((release) =>
        release.documents.map((document) => document.id),
      );
      const citationIds = releases.flatMap((release) =>
        release.documents.flatMap((document) =>
          document.citations.map((citation) => citation.id),
        ),
      );
      if (citationIds.length) {
        await database.knowledgeCitation.updateMany({
          where: { id: { in: citationIds } },
          data: {
            status: 'PURGED',
            excerpt: null,
            sourceId: null,
            chunkId: null,
            documentId: null,
          },
        });
      }
      if (documentIds.length) {
        await database.knowledgeDocument.deleteMany({
          where: { id: { in: documentIds } },
        });
      }
      if (releaseIds.length) {
        await database.knowledgeRelease.updateMany({
          where: { id: { in: releaseIds } },
          data: { status: 'PURGED' },
        });
      }
    });
  }
}

export class KnowledgeInvalidationService {
  constructor(
    private readonly repository: KnowledgeInvalidationRepository,
    private readonly replay: KnowledgeReplayInvalidator,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async invalidateSource(
    sourceId: string,
    status: InvalidatingSourceStatus,
    hiddenAt: Date = this.now(),
  ): Promise<void> {
    const citationStatus =
      status === 'REVOKED'
        ? 'ACCESS_REVOKED'
        : status === 'DELETED'
          ? 'SOURCE_DELETED'
          : 'SOURCE_INVALID';
    const requestIds = await this.repository.invalidateSource({
      sourceId,
      sourceStatus: status,
      citationStatus,
      hiddenAt,
    });
    if (requestIds.length) await this.replay.purgeRequests(requestIds);
  }

  purgeDue(now: Date, retentionMs: number): Promise<void> {
    if (!Number.isSafeInteger(retentionMs) || retentionMs < 0) {
      throw new Error('KNOWLEDGE_RETENTION_INVALID');
    }
    return this.repository.purgeDue(new Date(now.getTime() - retentionMs));
  }
}
