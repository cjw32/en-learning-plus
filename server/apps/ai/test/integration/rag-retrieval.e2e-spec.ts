import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@libs/shared/generated/prisma/client';
import { PrismaKnowledgeVectorRepository } from '@libs/learning';

const testDatabaseUrl = process.env.RAG_TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('RAG exact retrieval', () => {
  const adapter = new PrismaPg({ connectionString: testDatabaseUrl });
  const prisma = new PrismaClient({ adapter });
  const repository = new PrismaKnowledgeVectorRepository(prisma);

  beforeAll(async () => {
    await prisma.knowledgeSource.upsert({
      where: { sourceKey: 'retrieval-e2e-source' },
      update: {
        status: 'ACTIVE',
        allowEmbedding: true,
        allowExcerptDisplay: true,
        verifiedAt: new Date('2026-09-08T00:00:00.000Z'),
      },
      create: {
        id: 'source_retrieval_e2e',
        sourceKey: 'retrieval-e2e-source',
        name: 'Retrieval E2E source',
        sourceType: 'WORD_BOOK',
        rightsVersion: 'rights.test.v1',
        status: 'ACTIVE',
        allowEmbedding: true,
        allowExcerptDisplay: true,
        allowEvaluation: true,
        verifiedAt: new Date('2026-09-08T00:00:00.000Z'),
      },
    });
    await prisma.knowledgeRelease.upsert({
      where: {
        scopeKey_contentVersion_rightsVersion_chunkingVersion_embeddingVersion:
          {
            scopeKey: 'retrieval-e2e-source:WordBook:harbor',
            contentVersion: 'content.retrieval.v1',
            rightsVersion: 'rights.test.v1',
            chunkingVersion: 'chunking.v1',
            embeddingVersion: 'embedding.fake.8d.v1',
          },
      },
      update: {
        status: 'ACTIVE',
        expectedChunkCount: 2,
        readyEmbeddingCount: 2,
        activatedAt: new Date('2026-09-08T00:00:00.000Z'),
      },
      create: {
        id: 'release_retrieval_e2e',
        scopeKey: 'retrieval-e2e-source:WordBook:harbor',
        contentVersion: 'content.retrieval.v1',
        rightsVersion: 'rights.test.v1',
        chunkingVersion: 'chunking.v1',
        embeddingVersion: 'embedding.fake.8d.v1',
        retrievalConfigVersion: 'retrieval.exact.v1',
        indexVersion: 'exact-cosine.v1',
        expectedChunkCount: 2,
        readyEmbeddingCount: 2,
        status: 'ACTIVE',
        activatedAt: new Date('2026-09-08T00:00:00.000Z'),
      },
    });
    await prisma.knowledgeDocument.upsert({
      where: {
        knowledgeSourceId_sourceRecordType_sourceRecordId_contentVersion: {
          knowledgeSourceId: 'source_retrieval_e2e',
          sourceRecordType: 'WordBook',
          sourceRecordId: 'word_retrieval_harbor',
          contentVersion: 'content.retrieval.v1',
        },
      },
      update: { status: 'ACTIVE' },
      create: {
        id: 'document_retrieval_e2e',
        knowledgeSourceId: 'source_retrieval_e2e',
        releaseId: 'release_retrieval_e2e',
        source: 'retrieval-e2e-source',
        sourceId: 'word:word_retrieval_harbor',
        sourceRecordType: 'WordBook',
        sourceRecordId: 'word_retrieval_harbor',
        title: 'harbor',
        contentVersion: 'content.retrieval.v1',
        visibility: 'public',
        accessScope: 'PUBLIC',
        status: 'ACTIVE',
        sourceUpdatedAt: new Date('2026-09-08T00:00:00.000Z'),
      },
    });

    const chunks = [
      {
        id: 'chunk_retrieval_harbor',
        chunkKey: 'sense:noun:01',
        ordinal: 0,
        content: 'Harbor is a sheltered place for boats.',
        contentHash: 'hash_retrieval_harbor',
        category: 'WORD_MEANING' as const,
        level: 'B1' as const,
        vector: [1, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'chunk_retrieval_unrelated',
        chunkKey: 'sense:noun:02',
        ordinal: 1,
        content: 'A tense describes the time of an action.',
        contentHash: 'hash_retrieval_unrelated',
        category: 'GRAMMAR_RULE' as const,
        level: 'B2' as const,
        vector: [0, 1, 0, 0, 0, 0, 0, 0],
      },
    ];
    for (const chunk of chunks) {
      await prisma.knowledgeChunk.upsert({
        where: {
          documentId_chunkingVersion_chunkKey_contentHash: {
            documentId: 'document_retrieval_e2e',
            chunkingVersion: 'chunking.v1',
            chunkKey: chunk.chunkKey,
            contentHash: chunk.contentHash,
          },
        },
        update: { status: 'ACTIVE' },
        create: {
          id: chunk.id,
          documentId: 'document_retrieval_e2e',
          chunkKey: chunk.chunkKey,
          ordinal: chunk.ordinal,
          content: chunk.content,
          contentHash: chunk.contentHash,
          chunkingVersion: 'chunking.v1',
          source: 'retrieval-e2e-source',
          sourceId: 'word:word_retrieval_harbor',
          title: 'harbor',
          category: chunk.category,
          level: chunk.level,
          visibility: 'public',
          contentVersion: 'content.retrieval.v1',
          status: 'ACTIVE',
        },
      });
      await repository.storeReadyEmbedding({
        embeddingId: `embedding_${chunk.id}`,
        chunkId: chunk.id,
        provider: 'fake',
        model: 'deterministic',
        dimensions: 8,
        embeddingVersion: 'embedding.fake.8d.v1',
        inputHash: `input_${chunk.contentHash}`,
        vector: chunk.vector,
      });
    }
  });

  afterAll(async () => prisma.$disconnect());

  it('applies status, rights, version, dimensions, threshold and filters before stable Top K', async () => {
    const results = await repository.searchExact({
      subjectId: 'synthetic-subject-not-stored',
      queryVector: [1, 0, 0, 0, 0, 0, 0, 0],
      embeddingVersion: 'embedding.fake.8d.v1',
      dimensions: 8,
      sourceRightsSnapshotVersion: 'rights.test.v1',
      retrievalConfigVersion: 'retrieval.exact.v1',
      indexVersion: 'exact-cosine.v1',
      topK: 1,
      candidateLimit: 4,
      minimumRelevance: 0.65,
      filters: {
        levels: ['B1'],
        categories: ['WORD_MEANING'],
        sources: ['retrieval-e2e-source'],
        courseIds: [],
        wordIds: [],
        accessScopes: ['PUBLIC'],
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      chunkId: 'chunk_retrieval_harbor',
      rank: 1,
      relevanceScore: 1,
      category: 'WORD_MEANING',
      level: 'B1',
    });
  });

  it('does not mix incompatible embedding versions or expand invalid filters', async () => {
    const results = await repository.searchExact({
      subjectId: 'synthetic-subject-not-stored',
      queryVector: [1, 0, 0, 0, 0, 0, 0, 0],
      embeddingVersion: 'embedding.fake.8d.v2',
      dimensions: 8,
      sourceRightsSnapshotVersion: 'rights.test.v1',
      retrievalConfigVersion: 'retrieval.exact.v1',
      indexVersion: 'exact-cosine.v1',
      topK: 8,
      candidateLimit: 20,
      minimumRelevance: 0,
      filters: {
        levels: ['C2'],
        categories: ['WORD_MEANING'],
        sources: [],
        courseIds: [],
        wordIds: [],
        accessScopes: ['PUBLIC'],
      },
    });
    expect(results).toEqual([]);
  });

  it('fails closed for an unapproved rights snapshot or explicit revocation marker', async () => {
    const search = (sourceRightsSnapshotVersion: string) =>
      repository.searchExact({
        subjectId: 'synthetic-subject-not-stored',
        queryVector: [1, 0, 0, 0, 0, 0, 0, 0],
        embeddingVersion: 'embedding.fake.8d.v1',
        dimensions: 8,
        sourceRightsSnapshotVersion,
        retrievalConfigVersion: 'retrieval.exact.v1',
        indexVersion: 'exact-cosine.v1',
        topK: 1,
        candidateLimit: 4,
        minimumRelevance: 0.65,
        filters: {
          levels: ['B1'],
          categories: ['WORD_MEANING'],
          sources: ['retrieval-e2e-source'],
          courseIds: [],
          wordIds: [],
          accessScopes: ['PUBLIC'],
        },
      });

    await expect(search('rights.unapproved.v2')).resolves.toEqual([]);
    await prisma.knowledgeSource.update({
      where: { id: 'source_retrieval_e2e' },
      data: { revokedAt: new Date('2026-09-09T00:00:00.000Z') },
    });
    try {
      await expect(search('rights.test.v1')).resolves.toEqual([]);
    } finally {
      await prisma.knowledgeSource.update({
        where: { id: 'source_retrieval_e2e' },
        data: { revokedAt: null },
      });
    }
  });
});
