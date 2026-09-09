import type {
  KnowledgeReleaseStatus,
  PrismaClient,
} from '@libs/shared/generated/prisma/client';

export type KnowledgeReleaseRecord = Readonly<{
  id: string;
  scopeKey: string;
  contentVersion: string;
  expectedChunkCount: number;
  readyEmbeddingCount: number;
  status: KnowledgeReleaseStatus;
}>;

export interface KnowledgeReleaseRepository {
  find(id: string): Promise<KnowledgeReleaseRecord | null>;
  markReady(id: string): Promise<KnowledgeReleaseRecord>;
  activateAtomically(
    id: string,
    activatedAt: Date,
  ): Promise<KnowledgeReleaseRecord>;
  invalidate(id: string, invalidatedAt: Date): Promise<void>;
}

// Promise-based interface methods resolve synchronously in this test adapter.
/* eslint-disable @typescript-eslint/require-await */
export class InMemoryKnowledgeReleaseRepository implements KnowledgeReleaseRepository {
  private readonly records = new Map<string, KnowledgeReleaseRecord>();

  seed(records: readonly KnowledgeReleaseRecord[]): void {
    for (const record of records) this.records.set(record.id, { ...record });
  }

  async find(id: string): Promise<KnowledgeReleaseRecord | null> {
    return this.records.get(id) ?? null;
  }

  async markReady(id: string): Promise<KnowledgeReleaseRecord> {
    const record = this.records.get(id);
    if (!record) throw new Error('KNOWLEDGE_RELEASE_NOT_FOUND');
    const updated = { ...record, status: 'READY' as const };
    this.records.set(id, updated);
    return updated;
  }

  async activateAtomically(id: string): Promise<KnowledgeReleaseRecord> {
    const target = this.records.get(id);
    if (!target) throw new Error('KNOWLEDGE_RELEASE_NOT_FOUND');
    if (target.status === 'ACTIVE') return target;
    if (target.status !== 'READY')
      throw new Error('KNOWLEDGE_RELEASE_NOT_READY');
    for (const [recordId, record] of this.records) {
      if (
        recordId !== id &&
        record.scopeKey === target.scopeKey &&
        record.status === 'ACTIVE'
      ) {
        this.records.set(recordId, { ...record, status: 'SUPERSEDED' });
      }
    }
    const activated = { ...target, status: 'ACTIVE' as const };
    this.records.set(id, activated);
    return activated;
  }

  async invalidate(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record || record.status === 'INVALID') return;
    if (record.status !== 'BUILDING' && record.status !== 'READY') {
      throw new Error('KNOWLEDGE_RELEASE_INVALIDATION_REJECTED');
    }
    this.records.set(id, { ...record, status: 'INVALID' });
  }

  activeForScope(scopeKey: string): KnowledgeReleaseRecord | null {
    return (
      [...this.records.values()].find(
        (record) => record.scopeKey === scopeKey && record.status === 'ACTIVE',
      ) ?? null
    );
  }

  snapshot(): readonly KnowledgeReleaseRecord[] {
    return [...this.records.values()];
  }
}

/* eslint-enable @typescript-eslint/require-await */
type ReleasePrismaClient = Pick<
  PrismaClient,
  'knowledgeRelease' | '$transaction'
>;

export class PrismaKnowledgeReleaseRepository implements KnowledgeReleaseRepository {
  constructor(private readonly prisma: ReleasePrismaClient) {}

  async find(id: string): Promise<KnowledgeReleaseRecord | null> {
    return this.prisma.knowledgeRelease.findUnique({
      where: { id },
      select: {
        id: true,
        scopeKey: true,
        contentVersion: true,
        expectedChunkCount: true,
        readyEmbeddingCount: true,
        status: true,
      },
    });
  }

  async markReady(id: string): Promise<KnowledgeReleaseRecord> {
    return this.prisma.knowledgeRelease.update({
      where: { id },
      data: { status: 'READY' },
      select: {
        id: true,
        scopeKey: true,
        contentVersion: true,
        expectedChunkCount: true,
        readyEmbeddingCount: true,
        status: true,
      },
    });
  }

  async activateAtomically(
    id: string,
    activatedAt: Date,
  ): Promise<KnowledgeReleaseRecord> {
    return this.prisma.$transaction(async (database) => {
      const target = await database.knowledgeRelease.findUnique({
        where: { id },
        include: {
          documents: {
            select: {
              id: true,
              status: true,
              knowledgeSource: {
                select: {
                  status: true,
                  rightsVersion: true,
                  allowEmbedding: true,
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
      if (!target) throw new Error('KNOWLEDGE_RELEASE_NOT_FOUND');
      if (target.status === 'ACTIVE') return target;
      if (target.status !== 'READY')
        throw new Error('KNOWLEDGE_RELEASE_NOT_READY');
      if (
        target.expectedChunkCount === 0 ||
        target.readyEmbeddingCount !== target.expectedChunkCount ||
        target.documents.length === 0 ||
        target.documents.some(
          ({ knowledgeSource: source }) =>
            source.status !== 'ACTIVE' ||
            source.rightsVersion !== target.rightsVersion ||
            !source.allowEmbedding ||
            !source.verifiedAt ||
            source.revokedAt !== null ||
            source.deletedAt !== null ||
            (source.validFrom !== null && source.validFrom > activatedAt) ||
            (source.validUntil !== null && source.validUntil <= activatedAt),
        )
      ) {
        throw new Error('KNOWLEDGE_RELEASE_ACTIVATION_REJECTED');
      }
      const old = await database.knowledgeRelease.findMany({
        where: { scopeKey: target.scopeKey, status: 'ACTIVE', id: { not: id } },
        select: { id: true },
      });
      const oldIds = old.map((release) => release.id);
      const oldDocuments = oldIds.length
        ? await database.knowledgeDocument.findMany({
            where: { releaseId: { in: oldIds } },
            select: { id: true },
          })
        : [];
      const oldDocumentIds = oldDocuments.map((document) => document.id);
      if (oldDocumentIds.length) {
        await database.knowledgeChunk.updateMany({
          where: { documentId: { in: oldDocumentIds }, status: 'ACTIVE' },
          data: { status: 'SUPERSEDED' },
        });
        await database.knowledgeDocument.updateMany({
          where: { id: { in: oldDocumentIds }, status: 'ACTIVE' },
          data: { status: 'SUPERSEDED' },
        });
      }
      if (oldIds.length) {
        await database.knowledgeRelease.updateMany({
          where: { id: { in: oldIds }, status: 'ACTIVE' },
          data: { status: 'SUPERSEDED' },
        });
      }
      await database.knowledgeDocument.updateMany({
        where: { releaseId: id, status: 'STAGED' },
        data: { status: 'ACTIVE' },
      });
      const targetDocuments = target.documents.map((document) => document.id);
      await database.knowledgeChunk.updateMany({
        where: { documentId: { in: targetDocuments }, status: 'STAGED' },
        data: { status: 'ACTIVE' },
      });
      return database.knowledgeRelease.update({
        where: { id },
        data: { status: 'ACTIVE', activatedAt, invalidatedAt: null },
        select: {
          id: true,
          scopeKey: true,
          contentVersion: true,
          expectedChunkCount: true,
          readyEmbeddingCount: true,
          status: true,
        },
      });
    });
  }

  async invalidate(id: string, invalidatedAt: Date): Promise<void> {
    await this.prisma.$transaction(async (database) => {
      const release = await database.knowledgeRelease.findUnique({
        where: { id },
        select: { status: true, documents: { select: { id: true } } },
      });
      if (!release || release.status === 'INVALID') return;
      if (release.status !== 'BUILDING' && release.status !== 'READY') {
        throw new Error('KNOWLEDGE_RELEASE_INVALIDATION_REJECTED');
      }
      const documentIds = release.documents.map((document) => document.id);
      if (documentIds.length) {
        const chunks = await database.knowledgeChunk.findMany({
          where: { documentId: { in: documentIds } },
          select: { id: true },
        });
        const chunkIds = chunks.map((chunk) => chunk.id);
        if (chunkIds.length) {
          await database.knowledgeEmbedding.updateMany({
            where: {
              chunkId: { in: chunkIds },
              status: { in: ['PENDING', 'READY'] },
            },
            data: { status: 'INVALID', failureCode: 'RELEASE_INVALID' },
          });
          await database.knowledgeChunk.updateMany({
            where: { id: { in: chunkIds }, status: 'STAGED' },
            data: { status: 'INVALID' },
          });
        }
        await database.knowledgeDocument.updateMany({
          where: { id: { in: documentIds }, status: 'STAGED' },
          data: { status: 'INVALID' },
        });
      }
      await database.knowledgeRelease.update({
        where: { id },
        data: { status: 'INVALID', invalidatedAt },
      });
    });
  }
}

export class KnowledgeReleaseService {
  constructor(
    private readonly repository: KnowledgeReleaseRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async markReady(id: string): Promise<KnowledgeReleaseRecord> {
    const release = await this.require(id);
    if (release.status === 'READY' || release.status === 'ACTIVE')
      return release;
    if (release.status !== 'BUILDING')
      throw new Error('KNOWLEDGE_RELEASE_NOT_BUILDING');
    if (
      release.expectedChunkCount === 0 ||
      release.readyEmbeddingCount !== release.expectedChunkCount
    ) {
      throw new Error('KNOWLEDGE_RELEASE_INCOMPLETE');
    }
    return this.repository.markReady(id);
  }

  async activate(id: string): Promise<KnowledgeReleaseRecord> {
    const release = await this.require(id);
    if (release.status === 'ACTIVE') return release;
    if (release.status !== 'READY')
      throw new Error('KNOWLEDGE_RELEASE_NOT_READY');
    if (release.readyEmbeddingCount !== release.expectedChunkCount) {
      throw new Error('KNOWLEDGE_RELEASE_INCOMPLETE');
    }
    return this.repository.activateAtomically(id, this.now());
  }

  async invalidate(id: string): Promise<void> {
    return this.repository.invalidate(id, this.now());
  }

  private async require(id: string): Promise<KnowledgeReleaseRecord> {
    const release = await this.repository.find(id);
    if (!release) throw new Error('KNOWLEDGE_RELEASE_NOT_FOUND');
    return release;
  }
}
