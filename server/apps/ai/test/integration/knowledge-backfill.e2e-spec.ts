import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@libs/shared/generated/prisma/client';
import { runKnowledgeBackfill } from '../../../../prisma/backfills/knowledge-index';

const testDatabaseUrl = process.env.RAG_TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('knowledge index backfill', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
  });
  const sourceId = 'source_backfill_e2e';
  const sourceKey = 'synthetic-approved-backfill-e2e';
  const wordId = 'word_backfill_e2e';

  beforeAll(async () => {
    await prisma.knowledgeIngestionJob.deleteMany({
      where: { knowledgeSourceId: sourceId },
    });
    await prisma.knowledgeSource.deleteMany({ where: { id: sourceId } });
    await prisma.wordBook.deleteMany({ where: { id: wordId } });
    await prisma.wordBook.create({
      data: {
        id: wordId,
        word: 'harbor',
        definition: 'A sheltered place for boats.',
      },
    });
    await prisma.knowledgeSource.create({
      data: {
        id: sourceId,
        sourceKey,
        name: 'Synthetic approved backfill E2E',
        sourceType: 'SYNTHETIC_APPROVED',
        rightsVersion: 'rights.backfill.v1',
        status: 'ACTIVE',
        allowEmbedding: true,
        allowExcerptDisplay: true,
        verifiedAt: new Date('2026-09-09T00:00:00.000Z'),
        fieldPolicies: {
          create: {
            recordType: 'WordBook',
            fieldName: 'definition',
            allowEmbedding: true,
            allowExcerptDisplay: true,
            allowEvaluation: true,
            contentCategory: 'WORD_MEANING',
            policyVersion: 'policy.backfill.v1',
          },
        },
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  const run = (dryRun: boolean) =>
    runKnowledgeBackfill(prisma, {
      dryRun,
      limit: 100,
      sourceKey,
      pipelineVersion: 'rag-backfill.e2e.v1',
    });

  it('supports dry-run and is idempotent on the second real execution', async () => {
    await expect(run(true)).resolves.toMatchObject({
      changed: 1,
      unauthorized: 0,
      nextCheckpoint: wordId,
    });
    await expect(
      prisma.knowledgeIngestionJob.count({
        where: { knowledgeSourceId: sourceId },
      }),
    ).resolves.toBe(0);

    await expect(run(false)).resolves.toMatchObject({
      changed: 1,
      unauthorized: 0,
    });
    await expect(run(false)).resolves.toMatchObject({
      changed: 0,
      unauthorized: 0,
    });
    await expect(
      prisma.knowledgeIngestionJob.count({
        where: { knowledgeSourceId: sourceId, status: 'PENDING' },
      }),
    ).resolves.toBe(1);
  });
});
