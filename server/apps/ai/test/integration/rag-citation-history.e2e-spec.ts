import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@libs/shared/generated/prisma/client';
import {
  CitationProjectionService,
  PrismaCitationRepository,
} from '@libs/learning';

const testDatabaseUrl = process.env.RAG_TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describeDatabase('RAG citation history dynamic projection', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
  });
  const projection = new CitationProjectionService(
    new PrismaCitationRepository(prisma),
  );
  const userId = 'citation_history_user';
  const sourceId = 'source_citation_history_e2e';
  const releaseId = 'release_citation_history_v1';
  const documentId = 'document_citation_history_v1';
  const chunkId = 'chunk_citation_history_v1';
  const citationId = 'cit_history_version_000001';
  const oldCanary = 'OLD_CITATION_EXCERPT_CANARY';
  const newCanary = 'NEW_VERSION_CONTENT_CANARY';

  beforeAll(async () => {
    await prisma.knowledgeCitation.deleteMany({ where: { id: citationId } });
    await prisma.coachRequest.deleteMany({
      where: { id: 'request_citation_history' },
    });
    await prisma.coachConversation.deleteMany({
      where: { id: 'conversation_citation_history' },
    });
    await prisma.knowledgeDocument.deleteMany({
      where: { knowledgeSourceId: sourceId },
    });
    await prisma.knowledgeRelease.deleteMany({
      where: {
        id: { in: [releaseId, 'release_citation_history_v2'] },
      },
    });
    await prisma.knowledgeSource.deleteMany({ where: { id: sourceId } });
    await prisma.user.deleteMany({ where: { id: userId } });

    await prisma.user.create({
      data: {
        id: userId,
        name: userId,
        phone: '18800009301',
        password: 'synthetic-not-a-secret',
      },
    });
    await prisma.knowledgeSource.create({
      data: {
        id: sourceId,
        sourceKey: 'citation-history-e2e',
        name: 'Citation history E2E',
        sourceType: 'SYNTHETIC_APPROVED',
        rightsVersion: 'rights.history.v1',
        status: 'ACTIVE',
        allowEmbedding: true,
        allowExcerptDisplay: true,
        verifiedAt: new Date('2026-09-09T00:00:00.000Z'),
      },
    });
    await prisma.knowledgeRelease.create({
      data: {
        id: releaseId,
        scopeKey: 'citation-history-e2e',
        contentVersion: 'content.history.v1',
        rightsVersion: 'rights.history.v1',
        chunkingVersion: 'chunking.v1',
        embeddingVersion: 'embedding.fake.8d.v1',
        retrievalConfigVersion: 'retrieval.exact.v1',
        indexVersion: 'exact-cosine.v1',
        expectedChunkCount: 1,
        readyEmbeddingCount: 1,
        status: 'ACTIVE',
        activatedAt: new Date('2026-09-09T00:00:00.000Z'),
      },
    });
    await prisma.coachConversation.create({
      data: {
        id: 'conversation_citation_history',
        userId,
        checkpointThreadId: 'thread_citation_history',
        expiresAt: new Date('2026-10-09T00:00:00.000Z'),
      },
    });
    await prisma.coachRequest.create({
      data: {
        id: 'request_citation_history',
        userId,
        conversationId: 'conversation_citation_history',
        clientRequestKey: 'citation-history',
        requestBodyHash: 'citation_history_request_hash',
        inputPayload: { type: 'MESSAGE', content: 'synthetic' },
        inputType: 'MESSAGE',
        status: 'COMPLETED',
        deadlineAt: new Date('2026-09-09T00:01:00.000Z'),
      },
    });
    await prisma.knowledgeDocument.create({
      data: {
        id: documentId,
        knowledgeSourceId: sourceId,
        releaseId,
        source: 'synthetic-history-source',
        sourceId: 'word:historical',
        sourceRecordType: 'CitationHistoryFixture',
        sourceRecordId: 'historical',
        title: 'Historical source',
        contentVersion: 'content.history.v1',
        visibility: 'public',
        accessScope: 'PUBLIC',
        status: 'ACTIVE',
        sourceUpdatedAt: new Date('2026-09-09T00:00:00.000Z'),
        chunks: {
          create: {
            id: chunkId,
            chunkKey: 'section:01',
            ordinal: 0,
            content: oldCanary,
            contentHash: 'hash_history_v1',
            chunkingVersion: 'chunking.v1',
            source: 'synthetic-history-source',
            sourceId: 'word:historical',
            title: 'Historical source',
            category: 'WORD_MEANING',
            visibility: 'public',
            contentVersion: 'content.history.v1',
            status: 'ACTIVE',
          },
        },
      },
    });
    await prisma.knowledgeCitation.create({
      data: {
        id: citationId,
        requestId: 'request_citation_history',
        chunkId,
        documentId,
        sourceId: 'word:historical',
        sourceIdHash: 'source_hash_history_v1',
        contentVersion: 'content.history.v1',
        embeddingVersion: 'embedding.fake.8d.v1',
        excerpt: oldCanary,
        excerptHash: sha256(oldCanary),
        rank: 1,
        relevanceScore: '0.99',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  const resolve = () => projection.resolve({ subjectId: userId, citationId });
  const expectUnavailableWithoutHistory = async () => {
    const result = await resolve();
    expect(result).toEqual({
      citationId,
      status: 'unavailable',
      reason: 'SOURCE_UNAVAILABLE',
    });
    expect(JSON.stringify(result)).not.toContain(oldCanary);
    expect(JSON.stringify(result)).not.toContain(newCanary);
  };

  it('revalidates current source rights instead of replaying stored excerpts', async () => {
    await expect(resolve()).resolves.toMatchObject({
      status: 'active',
      excerpt: oldCanary,
    });
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'REVOKED', revokedAt: new Date('2026-09-09T00:10:00Z') },
    });
    await expectUnavailableWithoutHistory();
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'ACTIVE', revokedAt: null },
    });
  });

  it('never binds an old citation ID to a replacement content version', async () => {
    await prisma.knowledgeRelease.create({
      data: {
        id: 'release_citation_history_v2',
        scopeKey: 'citation-history-e2e',
        contentVersion: 'content.history.v2',
        rightsVersion: 'rights.history.v1',
        chunkingVersion: 'chunking.v1',
        embeddingVersion: 'embedding.fake.8d.v1',
        retrievalConfigVersion: 'retrieval.exact.v1',
        indexVersion: 'exact-cosine.v1',
        expectedChunkCount: 1,
        readyEmbeddingCount: 1,
        status: 'READY',
      },
    });
    await prisma.knowledgeDocument.create({
      data: {
        id: 'document_citation_history_v2',
        knowledgeSourceId: sourceId,
        releaseId: 'release_citation_history_v2',
        source: 'synthetic-history-source',
        sourceId: 'word:historical',
        sourceRecordType: 'CitationHistoryFixture',
        sourceRecordId: 'historical',
        title: 'Historical source updated',
        contentVersion: 'content.history.v2',
        visibility: 'public',
        accessScope: 'PUBLIC',
        status: 'ACTIVE',
        sourceUpdatedAt: new Date('2026-09-09T00:20:00.000Z'),
        chunks: {
          create: {
            id: 'chunk_citation_history_v2',
            chunkKey: 'section:01',
            ordinal: 0,
            content: newCanary,
            contentHash: 'hash_history_v2',
            chunkingVersion: 'chunking.v1',
            source: 'synthetic-history-source',
            sourceId: 'word:historical',
            title: 'Historical source updated',
            category: 'WORD_MEANING',
            visibility: 'public',
            contentVersion: 'content.history.v2',
            status: 'ACTIVE',
          },
        },
      },
    });
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: 'SUPERSEDED' },
    });
    await prisma.knowledgeChunk.update({
      where: { id: chunkId },
      data: { status: 'SUPERSEDED' },
    });
    await prisma.knowledgeRelease.update({
      where: { id: releaseId },
      data: { status: 'SUPERSEDED' },
    });
    await prisma.knowledgeRelease.update({
      where: { id: 'release_citation_history_v2' },
      data: {
        status: 'ACTIVE',
        activatedAt: new Date('2026-09-09T00:20:00.000Z'),
      },
    });
    await expectUnavailableWithoutHistory();
  });

  it('returns the same generic card after deletion redaction', async () => {
    await prisma.knowledgeCitation.update({
      where: { id: citationId },
      data: {
        status: 'SOURCE_DELETED',
        excerpt: null,
        sourceId: null,
        invalidatedAt: new Date('2026-09-09T00:30:00.000Z'),
      },
    });
    await expectUnavailableWithoutHistory();
  });
});
