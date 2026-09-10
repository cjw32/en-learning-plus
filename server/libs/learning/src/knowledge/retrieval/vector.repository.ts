import { Prisma, PrismaClient } from '@libs/shared/generated/prisma/client';
import { KnowledgeDomainError } from '../domain/knowledge.types';
import type {
  KnowledgeAccessScope,
  KnowledgeCategory,
  KnowledgeRetrievalResult,
} from '../domain/knowledge.types';
import { assertEmbeddingVectors } from '../ingestion/embedding.gateway';

type VectorPrismaClient = Pick<PrismaClient, '$executeRaw' | '$queryRaw'>;

export type StoreKnowledgeEmbeddingInput = Readonly<{
  embeddingId: string;
  chunkId: string;
  provider: string;
  model: string;
  dimensions: number;
  embeddingVersion: string;
  inputHash: string;
  vector: readonly number[];
}>;

export type ExactKnowledgeSearchInput = Readonly<{
  subjectId: string;
  queryVector: readonly number[];
  embeddingVersion: string;
  dimensions: number;
  sourceRightsSnapshotVersion: string;
  retrievalConfigVersion: string;
  indexVersion: string;
  topK: number;
  candidateLimit: number;
  minimumRelevance: number;
  filters: Readonly<{
    levels: readonly string[];
    categories: readonly KnowledgeCategory[];
    sources: readonly string[];
    courseIds: readonly string[];
    wordIds: readonly string[];
    accessScopes: readonly KnowledgeAccessScope[];
  }>;
}>;

type ExactKnowledgeSearchRow = Omit<
  KnowledgeRetrievalResult,
  'rank' | 'relevanceScore'
> & { relevanceScore: number };

export function serializeKnowledgeVector(vector: readonly number[]): string {
  assertEmbeddingVectors([vector], 1, vector.length);
  return `[${vector.map((value) => value.toString()).join(',')}]`;
}

export class PrismaKnowledgeVectorRepository {
  constructor(private readonly prisma: VectorPrismaClient) {}

  async storeReadyEmbedding(
    input: StoreKnowledgeEmbeddingInput,
  ): Promise<void> {
    if (
      !input.embeddingId.trim() ||
      !input.chunkId.trim() ||
      !input.provider.trim() ||
      !input.model.trim() ||
      !input.embeddingVersion.trim() ||
      !input.inputHash.trim() ||
      input.vector.length !== input.dimensions
    ) {
      throw new KnowledgeDomainError('EMBEDDING_REQUEST_INVALID');
    }
    const serialized = serializeKnowledgeVector(input.vector);

    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "KnowledgeEmbedding" (
        "id", "chunkId", "provider", "model", "dimensions",
        "embeddingVersion", "inputHash", "embedding", "status",
        "createdAt", "updatedAt"
      ) VALUES (
        ${input.embeddingId}, ${input.chunkId}, ${input.provider}, ${input.model},
        ${input.dimensions}, ${input.embeddingVersion}, ${input.inputHash},
        CAST(${serialized} AS vector), 'READY', NOW(), NOW()
      )
      ON CONFLICT ("chunkId", "embeddingVersion", "inputHash")
      DO UPDATE SET
        "provider" = EXCLUDED."provider",
        "model" = EXCLUDED."model",
        "dimensions" = EXCLUDED."dimensions",
        "embedding" = EXCLUDED."embedding",
        "status" = 'READY',
        "failureCode" = NULL,
        "updatedAt" = NOW()
      WHERE "KnowledgeEmbedding"."status" <> 'READY'
    `);
  }

  async invalidateByChunkIds(chunkIds: readonly string[]): Promise<number> {
    const ids = [...new Set(chunkIds.filter((id) => id.trim()))];
    if (ids.length === 0) return 0;
    return this.prisma.$executeRaw(Prisma.sql`
      UPDATE "KnowledgeEmbedding"
      SET "status" = 'INVALID', "updatedAt" = NOW()
      WHERE "chunkId" IN (${Prisma.join(ids)})
        AND "status" IN ('PENDING', 'READY', 'FAILED')
    `);
  }

  async searchExact(
    input: ExactKnowledgeSearchInput,
  ): Promise<readonly KnowledgeRetrievalResult[]> {
    if (
      !input.subjectId.trim() ||
      !input.embeddingVersion.trim() ||
      !input.sourceRightsSnapshotVersion.trim() ||
      !input.retrievalConfigVersion.trim() ||
      input.indexVersion !== 'exact-cosine.v1' ||
      input.queryVector.length !== input.dimensions ||
      !Number.isInteger(input.topK) ||
      input.topK < 1 ||
      input.topK > 20 ||
      !Number.isInteger(input.candidateLimit) ||
      input.candidateLimit < input.topK ||
      input.candidateLimit > 100 ||
      !Number.isFinite(input.minimumRelevance) ||
      input.minimumRelevance < 0 ||
      input.minimumRelevance > 1
    ) {
      throw new KnowledgeDomainError('EMBEDDING_REQUEST_INVALID');
    }
    assertEmbeddingVectors([input.queryVector], 1, input.dimensions);
    if (input.filters.accessScopes.length === 0) return [];

    const queryVector = serializeKnowledgeVector(input.queryVector);
    const optionalIn = (
      column: Prisma.Sql,
      values: readonly string[],
    ): Prisma.Sql =>
      values.length > 0
        ? Prisma.sql`AND ${column} IN (${Prisma.join([...new Set(values)])})`
        : Prisma.empty;
    const publicAllowed = input.filters.accessScopes.includes('PUBLIC');
    const ownedCourseAllowed =
      input.filters.accessScopes.includes('OWNED_COURSE');
    const privateOwnerAllowed =
      input.filters.accessScopes.includes('PRIVATE_OWNER');

    const rows = await this.prisma.$queryRaw<
      ExactKnowledgeSearchRow[]
    >(Prisma.sql`
      WITH eligible AS MATERIALIZED (
        SELECT
          c."id" AS "chunkId",
          c."documentId" AS "documentId",
          d."releaseId" AS "releaseId",
          c."source" AS "source",
          c."sourceId" AS "sourceId",
          c."title" AS "title",
          c."category"::text AS "category",
          c."level"::text AS "level",
          c."courseId" AS "courseId",
          c."wordId" AS "wordId",
          c."visibility" AS "visibility",
          d."accessScope"::text AS "accessScope",
          c."contentVersion" AS "contentVersion",
          e."embeddingVersion" AS "embeddingVersion",
          c."content" AS "content",
          c."factKey" AS "factKey",
          c."factValueHash" AS "factValueHash",
          c."authorityRank" AS "authorityRank",
          e."embedding" AS embedding
        FROM "KnowledgeChunk" c
        JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
        JOIN "KnowledgeRelease" r ON r."id" = d."releaseId"
        JOIN "KnowledgeSource" s ON s."id" = d."knowledgeSourceId"
        JOIN "KnowledgeEmbedding" e ON e."chunkId" = c."id"
        WHERE s."status" = 'ACTIVE'
          AND s."allowEmbedding" = true
          AND s."allowExcerptDisplay" = true
          AND s."verifiedAt" IS NOT NULL
          AND s."rightsVersion" = ${input.sourceRightsSnapshotVersion}
          AND s."revokedAt" IS NULL
          AND s."deletedAt" IS NULL
          AND (s."validFrom" IS NULL OR s."validFrom" <= NOW())
          AND (s."validUntil" IS NULL OR s."validUntil" > NOW())
          AND r."status" = 'ACTIVE'
          AND r."rightsVersion" = ${input.sourceRightsSnapshotVersion}
          AND r."embeddingVersion" = ${input.embeddingVersion}
          AND r."retrievalConfigVersion" = ${input.retrievalConfigVersion}
          AND r."indexVersion" = ${input.indexVersion}
          AND d."status" = 'ACTIVE'
          AND c."status" = 'ACTIVE'
          AND d."contentVersion" = r."contentVersion"
          AND c."contentVersion" = d."contentVersion"
          AND c."chunkingVersion" = r."chunkingVersion"
          AND e."status" = 'READY'
          AND e."embeddingVersion" = ${input.embeddingVersion}
          AND e."dimensions" = ${input.dimensions}
          AND vector_dims(e."embedding") = ${input.dimensions}
          AND (
            (d."accessScope" = 'PUBLIC' AND ${publicAllowed})
            OR (
              d."accessScope" = 'OWNED_COURSE'
              AND ${ownedCourseAllowed}
              AND d."courseId" IS NOT NULL
              AND c."courseId" = d."courseId"
              AND EXISTS (
                SELECT 1
                FROM "CourseRecord" entitlement
                WHERE entitlement."userId" = ${input.subjectId}
                  AND entitlement."courseId" = d."courseId"
                  AND entitlement."isPurchased" = true
              )
            )
            OR (
              d."accessScope" = 'PRIVATE_OWNER'
              AND ${privateOwnerAllowed}
              AND d."userId" = ${input.subjectId}
              AND c."userId" = ${input.subjectId}
            )
          )
          ${optionalIn(Prisma.sql`c."level"::text`, input.filters.levels)}
          ${optionalIn(Prisma.sql`c."category"::text`, input.filters.categories)}
          ${optionalIn(Prisma.sql`c."source"`, input.filters.sources)}
          ${optionalIn(Prisma.sql`c."courseId"`, input.filters.courseIds)}
          ${optionalIn(Prisma.sql`c."wordId"`, input.filters.wordIds)}
      ), scored AS MATERIALIZED (
        SELECT
          eligible.*,
          GREATEST(
            0.0,
            LEAST(1.0, 1.0 - ((embedding <=> CAST(${queryVector} AS vector)) / 2.0))
          )::float8 AS "relevanceScore"
        FROM eligible
      )
      SELECT
        "chunkId", "documentId", "releaseId", "source", "sourceId", "title",
        "category", "level", "courseId", "wordId", "visibility", "accessScope",
        "contentVersion", "embeddingVersion", "content", "factKey", "factValueHash",
        "authorityRank", "relevanceScore"
      FROM scored
      WHERE "relevanceScore" >= ${input.minimumRelevance}
      ORDER BY "relevanceScore" DESC, "chunkId" ASC
      LIMIT ${input.candidateLimit}
    `);

    return Object.freeze(
      rows.map((row, index) =>
        Object.freeze({
          ...row,
          rank: index + 1,
          relevanceScore: Math.max(0, Math.min(1, Number(row.relevanceScore))),
        }),
      ),
    );
  }
}
