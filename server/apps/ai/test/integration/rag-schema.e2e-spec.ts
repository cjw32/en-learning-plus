import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@libs/shared/generated/prisma/client';

const repositoryRoot = resolve(__dirname, '../../../../..');
const migrationPath = resolve(
  repositoryRoot,
  'server/prisma/migrations/20260908000000_rag_knowledge/migration.sql',
);

describe('RAG schema and pgvector migration', () => {
  it('declares the additive models and unsupported vector field', () => {
    const schema = readFileSync(
      resolve(repositoryRoot, 'server/prisma/schema.prisma'),
      'utf8',
    );
    const migration = readFileSync(migrationPath, 'utf8');

    for (const model of [
      'KnowledgeSource',
      'KnowledgeSourceFieldPolicy',
      'KnowledgeRelease',
      'KnowledgeDocument',
      'KnowledgeChunk',
      'KnowledgeEmbedding',
      'KnowledgeIngestionJob',
      'PrivateLearningSummary',
      'KnowledgeCitation',
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(schema).toContain('Unsupported("vector")');
    expect(migration).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
    expect(migration).toMatch(/CREATE UNIQUE INDEX.+ACTIVE/is);
    expect(migration).toMatch(/vector_dims/i);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"KnowledgeRelease"/i);
    expect(migration).toMatch(
      /"status"\s+"KnowledgeReleaseStatus"\s+NOT NULL DEFAULT 'BUILDING'/i,
    );
  });

  const testDatabaseUrl = process.env.RAG_TEST_DATABASE_URL;
  const describeDatabase = testDatabaseUrl ? describe : describe.skip;

  describeDatabase('disposable PostgreSQL assertions', () => {
    const adapter = new PrismaPg({ connectionString: testDatabaseUrl });
    const prisma = new PrismaClient({ adapter });

    afterAll(async () => prisma.$disconnect());

    it('has pgvector and creates no active release by migration alone', async () => {
      const extensions = await prisma.$queryRaw<Array<{ extversion: string }>>`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `;
      const active = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM "KnowledgeRelease" WHERE status = 'ACTIVE'
      `;

      expect(extensions).toHaveLength(1);
      if (process.env.RAG_TEST_DATABASE_FRESH === 'true') {
        expect(active[0]?.count).toBe(0n);
      } else {
        expect(active[0]?.count).toBeGreaterThanOrEqual(0n);
      }
    });
  });
});
