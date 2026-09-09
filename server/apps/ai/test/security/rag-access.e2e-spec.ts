import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@libs/shared/generated/prisma/client';
import { PrismaKnowledgeVectorRepository } from '@libs/learning';
import { RAG_ACCESS_FIXTURES } from '../fixtures/rag-access-fixtures';

const testDatabaseUrl = process.env.RAG_TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('RAG SQL access isolation', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
  });
  const repository = new PrismaKnowledgeVectorRepository(prisma);
  const { userA, userB } = RAG_ACCESS_FIXTURES;

  beforeAll(async () => {
    for (const [fixture, phone] of [
      [userA, '18800009001'],
      [userB, '18800009002'],
    ] as const) {
      await prisma.user.upsert({
        where: { phone },
        update: {},
        create: {
          id: fixture.subjectId,
          name: fixture.subjectId,
          phone,
          password: 'synthetic-not-a-secret',
        },
      });
    }
    await prisma.course.upsert({
      where: { id: userA.purchasedCourseId },
      update: {},
      create: {
        id: userA.purchasedCourseId,
        name: 'Synthetic course A',
        value: 'rag-test-course-a',
        teacher: 'Synthetic teacher',
        url: '/synthetic/course-a',
        price: '0',
      },
    });
    await prisma.courseRecord.upsert({
      where: {
        userId_courseId: {
          userId: userA.subjectId,
          courseId: userA.purchasedCourseId,
        },
      },
      update: { isPurchased: true },
      create: {
        userId: userA.subjectId,
        courseId: userA.purchasedCourseId,
        isPurchased: true,
      },
    });
    await prisma.knowledgeSource.upsert({
      where: { sourceKey: 'access-e2e-source' },
      update: {
        status: 'ACTIVE',
        allowEmbedding: true,
        allowExcerptDisplay: true,
      },
      create: {
        id: 'source_access_e2e',
        sourceKey: 'access-e2e-source',
        name: 'Access E2E source',
        sourceType: 'COURSE_PRIVATE',
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
            scopeKey: 'access-e2e-source:access-fixture',
            contentVersion: 'content.access.v1',
            rightsVersion: 'rights.test.v1',
            chunkingVersion: 'chunking.v1',
            embeddingVersion: 'embedding.fake.8d.v1',
          },
      },
      update: {},
      create: {
        id: 'release_access_e2e',
        scopeKey: 'access-e2e-source:access-fixture',
        contentVersion: 'content.access.v1',
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

    const documents = [
      {
        id: 'document_access_course_a',
        sourceRecordId: 'course-a-lesson',
        sourceId: 'course:rag-test-course-a:lesson-1',
        title: 'Purchased course lesson',
        accessScope: 'OWNED_COURSE' as const,
        visibility: 'public',
        userId: null,
        courseId: userA.purchasedCourseId,
        chunkId: 'chunk_access_course_a',
        content: 'COURSE_CANARY_ALPHA is an authorized purchased lesson.',
        category: 'COURSE_LESSON' as const,
      },
      {
        id: 'document_access_private_a',
        sourceRecordId: userA.privateSummaryId,
        sourceId: `summary:${userA.privateSummaryId}`,
        title: 'Private learning summary',
        accessScope: 'PRIVATE_OWNER' as const,
        visibility: 'private',
        userId: userA.subjectId,
        courseId: null,
        chunkId: 'chunk_access_private_a',
        content: `${userA.privateCanary} is a verified private learning fact.`,
        category: 'LEARNING_SUMMARY' as const,
      },
    ];
    for (const item of documents) {
      await prisma.knowledgeDocument.upsert({
        where: {
          knowledgeSourceId_sourceRecordType_sourceRecordId_contentVersion: {
            knowledgeSourceId: 'source_access_e2e',
            sourceRecordType: 'AccessFixture',
            sourceRecordId: item.sourceRecordId,
            contentVersion: 'content.access.v1',
          },
        },
        update: { status: 'ACTIVE' },
        create: {
          id: item.id,
          knowledgeSourceId: 'source_access_e2e',
          releaseId: 'release_access_e2e',
          source: 'access-e2e-source',
          sourceId: item.sourceId,
          sourceRecordType: 'AccessFixture',
          sourceRecordId: item.sourceRecordId,
          title: item.title,
          contentVersion: 'content.access.v1',
          visibility: item.visibility,
          accessScope: item.accessScope,
          userId: item.userId,
          courseId: item.courseId,
          status: 'ACTIVE',
          sourceUpdatedAt: new Date('2026-09-08T00:00:00.000Z'),
        },
      });
      await prisma.knowledgeChunk.upsert({
        where: {
          documentId_chunkingVersion_chunkKey_contentHash: {
            documentId: item.id,
            chunkingVersion: 'chunking.v1',
            chunkKey: 'section:01',
            contentHash: `hash_${item.chunkId}`,
          },
        },
        update: { status: 'ACTIVE' },
        create: {
          id: item.chunkId,
          documentId: item.id,
          chunkKey: 'section:01',
          ordinal: 0,
          content: item.content,
          contentHash: `hash_${item.chunkId}`,
          chunkingVersion: 'chunking.v1',
          source: 'access-e2e-source',
          sourceId: item.sourceId,
          title: item.title,
          category: item.category,
          courseId: item.courseId,
          userId: item.userId,
          visibility: item.visibility,
          contentVersion: 'content.access.v1',
          status: 'ACTIVE',
        },
      });
      await repository.storeReadyEmbedding({
        embeddingId: `embedding_${item.chunkId}`,
        chunkId: item.chunkId,
        provider: 'fake',
        model: 'deterministic',
        dimensions: 8,
        embeddingVersion: 'embedding.fake.8d.v1',
        inputHash: `input_${item.chunkId}`,
        vector: [1, 0, 0, 0, 0, 0, 0, 0],
      });
    }
  });

  afterAll(async () => prisma.$disconnect());

  const search = (subjectId: string) =>
    repository.searchExact({
      subjectId,
      queryVector: [1, 0, 0, 0, 0, 0, 0, 0],
      embeddingVersion: 'embedding.fake.8d.v1',
      dimensions: 8,
      sourceRightsSnapshotVersion: 'rights.test.v1',
      retrievalConfigVersion: 'retrieval.exact.v1',
      indexVersion: 'exact-cosine.v1',
      topK: 8,
      candidateLimit: 20,
      minimumRelevance: 0.5,
      filters: {
        levels: [],
        categories: ['COURSE_LESSON', 'LEARNING_SUMMARY'],
        sources: ['access-e2e-source'],
        courseIds: [],
        wordIds: [],
        accessScopes: ['OWNED_COURSE', 'PRIVATE_OWNER'],
      },
    });

  it('returns purchased-course and exact-owner private rows only to User A', async () => {
    const results = await search(userA.subjectId);
    expect(results.map((item) => item.chunkId).sort()).toEqual([
      'chunk_access_course_a',
      'chunk_access_private_a',
    ]);
  });

  it('leaks zero User A rows to User B', async () => {
    const results = await search(userB.subjectId);
    expect(results).toEqual([]);
    expect(JSON.stringify(results)).not.toContain(userA.privateCanary);
  });
});
