import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../libs/shared/src/generated/prisma/client';
import {
  KnowledgeOutboxRepository,
  PrismaKnowledgeOutboxPersistence,
} from '../../libs/learning/src/knowledge/ingestion/knowledge-outbox.repository';

type BackfillPrisma = Pick<
  PrismaClient,
  'knowledgeSource' | 'knowledgeIngestionJob' | 'wordBook' | 'course' | '$queryRaw' | '$executeRaw' | '$transaction'
>;

export type KnowledgeBackfillOptions = Readonly<{
  dryRun: boolean;
  limit: number;
  after?: string;
  sourceKey?: string;
  pipelineVersion?: string;
}>;

export type KnowledgeBackfillSummary = Readonly<{
  scanned: number;
  eligible: number;
  changed: number;
  unauthorized: number;
  nextCheckpoint: string | null;
}>;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function contentVersion(
  recordType: 'WordBook' | 'Course',
  row: Record<string, unknown>,
  fieldNames: readonly string[],
): string {
  const canonical = fieldNames
    .slice()
    .sort()
    .map((field) => [field, row[field] ?? null]);
  return `content.${hash(JSON.stringify([recordType, row.id, canonical])).slice(0, 32)}`;
}

export async function runKnowledgeBackfill(
  prisma: BackfillPrisma,
  options: KnowledgeBackfillOptions,
): Promise<KnowledgeBackfillSummary> {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
    throw new Error('KNOWLEDGE_BACKFILL_LIMIT_INVALID');
  }
  const sources = await prisma.knowledgeSource.findMany({
    where: {
      ...(options.sourceKey ? { sourceKey: options.sourceKey } : {}),
      status: 'ACTIVE',
      allowEmbedding: true,
      verifiedAt: { not: null },
      revokedAt: null,
      deletedAt: null,
      OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
    },
    include: {
      fieldPolicies: {
        where: {
          allowEmbedding: true,
          recordType: { in: ['WordBook', 'Course'] },
        },
      },
    },
    orderBy: { sourceKey: 'asc' },
  });
  const outbox = new KnowledgeOutboxRepository(
    new PrismaKnowledgeOutboxPersistence(prisma),
  );
  let scanned = 0;
  let eligible = 0;
  let changed = 0;
  let nextCheckpoint: string | null = null;
  for (const source of sources) {
    for (const recordType of ['WordBook', 'Course'] as const) {
      const fieldNames = [...new Set(
        source.fieldPolicies
          .filter((policy) => policy.recordType === recordType)
          .map((policy) => policy.fieldName),
      )];
      if (fieldNames.length === 0) continue;
      const select = Object.fromEntries([
        ['id', true],
        ['updatedAt', true],
        ...fieldNames.map((fieldName) => [fieldName, true]),
      ]);
      const rows = (recordType === 'WordBook'
        ? await prisma.wordBook.findMany({
            where: options.after ? { id: { gt: options.after } } : {},
            orderBy: { id: 'asc' },
            take: Math.max(0, options.limit - scanned),
            select: select as never,
          })
        : await prisma.course.findMany({
            where: options.after ? { id: { gt: options.after } } : {},
            orderBy: { id: 'asc' },
            take: Math.max(0, options.limit - scanned),
            select: select as never,
          })) as unknown as Array<Record<string, unknown>>;
      for (const row of rows) {
        if (scanned >= options.limit) break;
        scanned += 1;
        eligible += 1;
        const recordId = String(row.id);
        nextCheckpoint = recordId;
        const version = contentVersion(recordType, row, fieldNames);
        const exists = await prisma.knowledgeIngestionJob.count({
          where: {
            operation: 'UPSERT',
            sourceRecordType: recordType,
            sourceRecordId: recordId,
            contentVersion: version,
            pipelineVersion: options.pipelineVersion ?? 'rag-backfill.v1',
          },
        });
        if (exists > 0) continue;
        changed += 1;
        if (!options.dryRun) {
          await outbox.enqueue({
            operation: 'UPSERT',
            knowledgeSourceId: source.id,
            sourceRecordType: recordType,
            sourceRecordId: recordId,
            contentVersion: version,
            pipelineVersion: options.pipelineVersion ?? 'rag-backfill.v1',
            ownerUserId: null,
          });
        }
      }
      if (scanned >= options.limit) break;
    }
    if (scanned >= options.limit) break;
  }
  return Object.freeze({
    scanned,
    eligible,
    changed,
    unauthorized: 0,
    nextCheckpoint,
  });
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.RAG_BACKFILL_DATABASE_URL;
  if (!databaseUrl) throw new Error('RAG_BACKFILL_DATABASE_URL_REQUIRED');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const summary = await runKnowledgeBackfill(prisma, {
      dryRun: process.argv.includes('--dry-run'),
      limit: Number(argument('--limit') ?? 100),
      after: argument('--after'),
      sourceKey: argument('--source-key'),
      pipelineVersion: argument('--pipeline-version'),
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
