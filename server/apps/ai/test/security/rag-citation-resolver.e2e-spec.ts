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

describeDatabase('RAG citation resolver access control', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
  });
  const projection = new CitationProjectionService(
    new PrismaCitationRepository(prisma),
  );
  const userA = 'citation_resolver_user_a';
  const userB = 'citation_resolver_user_b';
  const sourceId = 'source_citation_resolver_e2e';
  const courseId = 'course_citation_resolver_e2e';
  const requestId = 'request_citation_resolver_a';
  const citationIds = {
    public: 'cit_resolver_public_000001',
    course: 'cit_resolver_course_000001',
    private: 'cit_resolver_private_000001',
  } as const;

  beforeAll(async () => {
    await prisma.knowledgeCitation.deleteMany({
      where: { id: { in: Object.values(citationIds) } },
    });
    await prisma.coachRequest.deleteMany({ where: { id: requestId } });
    await prisma.coachConversation.deleteMany({
      where: { id: 'conversation_citation_resolver_a' },
    });
    await prisma.knowledgeDocument.deleteMany({
      where: { knowledgeSourceId: sourceId },
    });
    await prisma.knowledgeRelease.deleteMany({
      where: { id: 'release_citation_resolver_e2e' },
    });
    await prisma.knowledgeSource.deleteMany({ where: { id: sourceId } });
    await prisma.courseRecord.deleteMany({ where: { courseId } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });

    for (const [id, phone] of [
      [userA, '18800009201'],
      [userB, '18800009202'],
    ] as const) {
      await prisma.user.create({
        data: { id, name: id, phone, password: 'synthetic-not-a-secret' },
      });
    }
    await prisma.course.create({
      data: {
        id: courseId,
        name: 'Citation resolver course',
        value: 'citation-resolver-course',
        teacher: 'Synthetic teacher',
        url: '/courses/citation-resolver-course',
        price: '0',
      },
    });
    await prisma.courseRecord.create({
      data: { userId: userA, courseId, isPurchased: true },
    });
    await prisma.knowledgeSource.create({
      data: {
        id: sourceId,
        sourceKey: 'citation-resolver-e2e',
        name: 'Citation resolver E2E',
        sourceType: 'SYNTHETIC_APPROVED',
        rightsVersion: 'rights.citation.v1',
        status: 'ACTIVE',
        allowEmbedding: true,
        allowExcerptDisplay: true,
        allowEvaluation: true,
        verifiedAt: new Date('2026-09-09T00:00:00.000Z'),
      },
    });
    await prisma.knowledgeRelease.create({
      data: {
        id: 'release_citation_resolver_e2e',
        scopeKey: 'citation-resolver-e2e',
        contentVersion: 'content.citation.v1',
        rightsVersion: 'rights.citation.v1',
        chunkingVersion: 'chunking.v1',
        embeddingVersion: 'embedding.fake.8d.v1',
        retrievalConfigVersion: 'retrieval.exact.v1',
        indexVersion: 'exact-cosine.v1',
        expectedChunkCount: 3,
        readyEmbeddingCount: 3,
        status: 'ACTIVE',
        activatedAt: new Date('2026-09-09T00:00:00.000Z'),
      },
    });
    await prisma.coachConversation.create({
      data: {
        id: 'conversation_citation_resolver_a',
        userId: userA,
        checkpointThreadId: 'thread_citation_resolver_a',
        expiresAt: new Date('2026-10-09T00:00:00.000Z'),
      },
    });
    await prisma.coachRequest.create({
      data: {
        id: requestId,
        userId: userA,
        conversationId: 'conversation_citation_resolver_a',
        clientRequestKey: 'citation-resolver-a',
        requestBodyHash: 'citation_resolver_request_hash',
        inputPayload: { type: 'MESSAGE', content: 'synthetic' },
        inputType: 'MESSAGE',
        status: 'COMPLETED',
        deadlineAt: new Date('2026-09-09T00:01:00.000Z'),
      },
    });

    const records = [
      {
        suffix: 'public',
        citationId: citationIds.public,
        accessScope: 'PUBLIC' as const,
        courseId: null,
        userId: null,
        source: 'synthetic-word-source',
        sourceId: 'word:harbor',
        title: 'harbor',
        category: 'WORD_MEANING' as const,
        excerpt: 'A harbor is a sheltered place for boats.',
      },
      {
        suffix: 'course',
        citationId: citationIds.course,
        accessScope: 'OWNED_COURSE' as const,
        courseId,
        userId: null,
        source: 'approved-course',
        sourceId: 'course:lesson-1',
        title: 'Course lesson 1',
        category: 'COURSE_LESSON' as const,
        excerpt: 'Use context to distinguish port from harbor.',
      },
      {
        suffix: 'private',
        citationId: citationIds.private,
        accessScope: 'PRIVATE_OWNER' as const,
        courseId: null,
        userId: userA,
        source: 'private-learning-summary',
        sourceId: 'summary:private-a',
        title: 'Your learning summary',
        category: 'LEARNING_SUMMARY' as const,
        excerpt: 'You often confuse port and harbor.',
      },
    ];
    for (const record of records) {
      const documentId = `document_citation_resolver_${record.suffix}`;
      const chunkId = `chunk_citation_resolver_${record.suffix}`;
      await prisma.knowledgeDocument.create({
        data: {
          id: documentId,
          knowledgeSourceId: sourceId,
          releaseId: 'release_citation_resolver_e2e',
          source: record.source,
          sourceId: record.sourceId,
          sourceRecordType: 'CitationResolverFixture',
          sourceRecordId: record.suffix,
          title: record.title,
          contentVersion: 'content.citation.v1',
          visibility:
            record.accessScope === 'PRIVATE_OWNER' ? 'private' : 'public',
          accessScope: record.accessScope,
          userId: record.userId,
          courseId: record.courseId,
          status: 'ACTIVE',
          sourceUpdatedAt: new Date('2026-09-09T00:00:00.000Z'),
          chunks: {
            create: {
              id: chunkId,
              chunkKey: 'section:01',
              ordinal: 0,
              content: record.excerpt,
              contentHash: `hash_${record.suffix}`,
              chunkingVersion: 'chunking.v1',
              source: record.source,
              sourceId: record.sourceId,
              title: record.title,
              category: record.category,
              courseId: record.courseId,
              userId: record.userId,
              visibility:
                record.accessScope === 'PRIVATE_OWNER' ? 'private' : 'public',
              contentVersion: 'content.citation.v1',
              status: 'ACTIVE',
            },
          },
        },
      });
      await prisma.knowledgeCitation.create({
        data: {
          id: record.citationId,
          requestId,
          chunkId,
          documentId,
          sourceId: record.sourceId,
          sourceIdHash: `source_hash_${record.suffix}`,
          contentVersion: 'content.citation.v1',
          embeddingVersion: 'embedding.fake.8d.v1',
          excerpt: record.excerpt,
          excerptHash: sha256(record.excerpt),
          rank: 1,
          relevanceScore: '0.99',
          status: 'ACTIVE',
        },
      });
    }
  });

  afterAll(async () => prisma.$disconnect());

  it('projects public, purchased-course and exact-owner evidence for the request owner', async () => {
    await expect(
      projection.resolve({ subjectId: userA, citationId: citationIds.public }),
    ).resolves.toMatchObject({
      citationId: citationIds.public,
      status: 'active',
      excerpt: 'A harbor is a sheltered place for boats.',
      accessScope: 'PUBLIC',
    });
    await expect(
      projection.resolve({ subjectId: userA, citationId: citationIds.course }),
    ).resolves.toMatchObject({
      status: 'active',
      accessScope: 'OWNED_COURSE',
      locator: { kind: 'course', id: courseId },
    });
    const privateCitation = await projection.resolve({
      subjectId: userA,
      citationId: citationIds.private,
    });
    expect(privateCitation).toMatchObject({
      status: 'active',
      accessScope: 'PRIVATE_OWNER',
      excerpt: 'You often confuse port and harbor.',
    });
    expect(JSON.stringify(privateCitation)).not.toMatch(
      /citation_resolver_user_a|summary:private-a|documentId|chunkId|sourceId/i,
    );
  });

  it('makes cross-subject, unowned, malformed, and nonexistent IDs indistinguishable', async () => {
    const expected = {
      citationId: citationIds.private,
      status: 'unavailable',
      reason: 'SOURCE_UNAVAILABLE',
    };
    await expect(
      projection.resolve({ subjectId: userB, citationId: citationIds.private }),
    ).resolves.toEqual(expected);
    await expect(
      projection.resolve({ subjectId: userB, citationId: citationIds.course }),
    ).resolves.toEqual({ ...expected, citationId: citationIds.course });
    await expect(
      projection.resolve({
        subjectId: userB,
        citationId: 'cit_nonexistent_000001',
      }),
    ).resolves.toEqual({ ...expected, citationId: 'cit_nonexistent_000001' });
    await expect(
      projection.resolve({ subjectId: userB, citationId: '../../private' }),
    ).resolves.toEqual({
      ...expected,
      citationId: 'cit_unavailable_000000',
    });
  });
});
