import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@libs/shared/generated/prisma/client';
import {
  LearningDataDeletionService,
  PrismaLearningDataDeletionRepository,
} from '@libs/learning';

const testDatabaseUrl = process.env.RAG_TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('private RAG deletion lifecycle', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
  });
  const service = new LearningDataDeletionService(
    new PrismaLearningDataDeletionRepository(prisma),
  );
  const requestedAt = new Date('2026-09-08T00:00:00.000Z');
  const userA = 'rag_delete_user_a';
  const userB = 'rag_delete_user_b';
  const sourceId = 'source_rag_delete_e2e';

  const records = [
    {
      ownerUserId: userA,
      suffix: 'a',
      sourceRecordId: 'private-delete-a',
      canary: 'PRIVATE_DELETE_CANARY_ALPHA',
    },
    {
      ownerUserId: userB,
      suffix: 'b',
      sourceRecordId: 'private-delete-b',
      canary: 'PRIVATE_DELETE_CANARY_BRAVO',
    },
  ] as const;

  beforeAll(async () => {
    await prisma.knowledgeIngestionJob.deleteMany({
      where: { knowledgeSourceId: sourceId },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await prisma.knowledgeSource.deleteMany({ where: { id: sourceId } });
    await prisma.knowledgeRelease.deleteMany({
      where: { id: { in: ['release_rag_delete_a', 'release_rag_delete_b'] } },
    });

    for (const [id, phone] of [
      [userA, '18800009101'],
      [userB, '18800009102'],
    ] as const) {
      await prisma.user.create({
        data: { id, name: id, phone, password: 'synthetic-not-a-secret' },
      });
    }
    await prisma.knowledgeSource.create({
      data: {
        id: sourceId,
        sourceKey: 'rag-private-deletion-e2e',
        name: 'RAG private deletion E2E',
        sourceType: 'PRIVATE_LEARNING',
        rightsVersion: 'rights.test.v1',
        status: 'ACTIVE',
        allowEmbedding: true,
        allowExcerptDisplay: true,
        allowEvaluation: true,
        verifiedAt: requestedAt,
      },
    });

    for (const record of records) {
      const releaseId = `release_rag_delete_${record.suffix}`;
      const documentId = `document_rag_delete_${record.suffix}`;
      const chunkId = `chunk_rag_delete_${record.suffix}`;
      const conversationId = `conversation_rag_delete_${record.suffix}`;
      const requestId = `request_rag_delete_${record.suffix}`;
      await prisma.knowledgeRelease.create({
        data: {
          id: releaseId,
          scopeKey: `rag-private-deletion:${record.ownerUserId}`,
          contentVersion: 'content.delete.v1',
          rightsVersion: 'rights.test.v1',
          chunkingVersion: 'chunking.v1',
          embeddingVersion: 'embedding.fake.8d.v1',
          retrievalConfigVersion: 'retrieval.exact.v1',
          indexVersion: 'exact-cosine.v1',
          expectedChunkCount: 1,
          readyEmbeddingCount: 1,
          status: 'ACTIVE',
          activatedAt: requestedAt,
        },
      });
      await prisma.knowledgeDocument.create({
        data: {
          id: documentId,
          knowledgeSourceId: sourceId,
          releaseId,
          source: 'private-learning-summary',
          sourceId: `summary:${record.sourceRecordId}`,
          sourceRecordType: 'PrivateLearningSummary',
          sourceRecordId: record.sourceRecordId,
          title: 'Private learning summary',
          contentVersion: 'content.delete.v1',
          visibility: 'private',
          accessScope: 'PRIVATE_OWNER',
          userId: record.ownerUserId,
          status: 'ACTIVE',
          sourceUpdatedAt: requestedAt,
          chunks: {
            create: {
              id: chunkId,
              chunkKey: 'summary:01',
              ordinal: 0,
              content: `${record.canary} verified private fact`,
              contentHash: `hash_${record.suffix}`,
              chunkingVersion: 'chunking.v1',
              source: 'private-learning-summary',
              sourceId: `summary:${record.sourceRecordId}`,
              title: 'Private learning summary',
              category: 'LEARNING_SUMMARY',
              userId: record.ownerUserId,
              visibility: 'private',
              contentVersion: 'content.delete.v1',
              status: 'ACTIVE',
            },
          },
        },
      });
      await prisma.privateLearningSummary.create({
        data: {
          id: `summary_rag_delete_${record.suffix}`,
          userId: record.ownerUserId,
          topicType: 'WORD',
          topicKey: `topic-${record.suffix}`,
          windowStart: requestedAt,
          windowEnd: requestedAt,
          summaryFacts: { canary: record.canary },
          evidenceVersion: 'evidence.test.v1',
          status: 'ACTIVE',
        },
      });
      await prisma.coachConversation.create({
        data: {
          id: conversationId,
          userId: record.ownerUserId,
          checkpointThreadId: `thread_rag_delete_${record.suffix}`,
          expiresAt: new Date('2026-10-08T00:00:00.000Z'),
        },
      });
      await prisma.coachRequest.create({
        data: {
          id: requestId,
          userId: record.ownerUserId,
          conversationId,
          clientRequestKey: `delete-e2e-${record.suffix}`,
          requestBodyHash: `request_hash_${record.suffix}`,
          inputPayload: { type: 'MESSAGE', content: 'synthetic' },
          inputType: 'MESSAGE',
          status: 'COMPLETED',
          deadlineAt: new Date('2026-09-08T00:01:00.000Z'),
          finalResultSchemaVersion: 'coach.result.v2',
          finalResult: {
            citationIds: [`citation_rag_delete_${record.suffix}`],
          },
        },
      });
      await prisma.knowledgeCitation.create({
        data: {
          id: `citation_rag_delete_${record.suffix}`,
          requestId,
          chunkId,
          documentId,
          sourceId: `summary:${record.sourceRecordId}`,
          sourceIdHash: `source_hash_${record.suffix}`,
          contentVersion: 'content.delete.v1',
          embeddingVersion: 'embedding.fake.8d.v1',
          excerpt: record.canary,
          excerptHash: `excerpt_hash_${record.suffix}`,
          rank: 1,
          relevanceScore: '0.99',
          status: 'ACTIVE',
        },
      });
    }
  });

  afterAll(async () => prisma.$disconnect());

  it('immediately hides User A private retrieval and citation state only', async () => {
    await service.hideImmediately(userA, requestedAt);

    await expect(
      prisma.knowledgeDocument.findUnique({
        where: { id: 'document_rag_delete_a' },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'INVALID' });
    await expect(
      prisma.knowledgeChunk.findUnique({
        where: { id: 'chunk_rag_delete_a' },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'INVALID' });
    await expect(
      prisma.knowledgeCitation.findUnique({
        where: { id: 'citation_rag_delete_a' },
        select: { status: true, excerpt: true, sourceId: true },
      }),
    ).resolves.toEqual({
      status: 'PRIVATE_DATA_DELETED',
      excerpt: null,
      sourceId: null,
    });
    await expect(
      prisma.privateLearningSummary.findUnique({
        where: { id: 'summary_rag_delete_a' },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'DELETING' });
    await expect(
      prisma.knowledgeIngestionJob.count({
        where: {
          operation: 'PURGE',
          ownerUserId: userA,
          status: 'PENDING',
        },
      }),
    ).resolves.toBe(1);

    await expect(
      prisma.knowledgeDocument.findUnique({
        where: { id: 'document_rag_delete_b' },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'ACTIVE' });
    await expect(
      prisma.knowledgeCitation.findUnique({
        where: { id: 'citation_rag_delete_b' },
        select: { status: true, excerpt: true },
      }),
    ).resolves.toEqual({
      status: 'ACTIVE',
      excerpt: 'PRIVATE_DELETE_CANARY_BRAVO',
    });
  });

  it('physically removes User A private content at the purge stage', async () => {
    await service.purgeOwnedData(userA);

    await expect(
      prisma.knowledgeDocument.count({ where: { userId: userA } }),
    ).resolves.toBe(0);
    await expect(
      prisma.privateLearningSummary.count({ where: { userId: userA } }),
    ).resolves.toBe(0);
    await expect(
      prisma.knowledgeCitation.findUnique({
        where: { id: 'citation_rag_delete_a' },
        select: {
          status: true,
          chunkId: true,
          documentId: true,
          sourceId: true,
          excerpt: true,
        },
      }),
    ).resolves.toEqual({
      status: 'PURGED',
      chunkId: null,
      documentId: null,
      sourceId: null,
      excerpt: null,
    });
    await expect(
      prisma.knowledgeChunk.findUnique({
        where: { id: 'chunk_rag_delete_b' },
        select: { content: true, status: true },
      }),
    ).resolves.toEqual({
      content: 'PRIVATE_DELETE_CANARY_BRAVO verified private fact',
      status: 'ACTIVE',
    });
  });
});
