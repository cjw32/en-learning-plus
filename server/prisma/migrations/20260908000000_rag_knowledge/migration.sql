-- Additive knowledge RAG schema. No existing business column is altered and no
-- content is activated by this migration. Rollback is application-first: keep
-- these tables, disable RAG reads, and never reactivate revoked/deleted data.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED', 'DELETED');
CREATE TYPE "KnowledgeAccessScope" AS ENUM ('PUBLIC', 'OWNED_COURSE', 'PRIVATE_OWNER');
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('STAGED', 'ACTIVE', 'SUPERSEDED', 'INVALID', 'PURGING', 'PURGED');
CREATE TYPE "KnowledgeChunkStatus" AS ENUM ('STAGED', 'ACTIVE', 'SUPERSEDED', 'INVALID', 'PURGING');
CREATE TYPE "KnowledgeEmbeddingStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'INVALID', 'PURGING');
CREATE TYPE "KnowledgeReleaseStatus" AS ENUM ('BUILDING', 'READY', 'ACTIVE', 'SUPERSEDED', 'INVALID', 'PURGED');
CREATE TYPE "KnowledgeIngestionOperation" AS ENUM ('UPSERT', 'REEMBED', 'INVALIDATE', 'PURGE');
CREATE TYPE "KnowledgeIngestionStatus" AS ENUM ('PENDING', 'DISPATCHED', 'RUNNING', 'SUCCEEDED', 'RETRYABLE_FAILED', 'TERMINAL_FAILED', 'CANCELLED');
CREATE TYPE "KnowledgeCitationStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'SOURCE_INVALID', 'ACCESS_REVOKED', 'SOURCE_DELETED', 'PRIVATE_DATA_DELETED', 'PURGED');
CREATE TYPE "KnowledgeCategory" AS ENUM ('WORD_MEANING', 'WORD_TRANSLATION', 'WORD_PRONUNCIATION', 'WORD_FORM', 'WORD_USAGE', 'COLLOCATION', 'EXAMPLE_SENTENCE', 'GRAMMAR_RULE', 'GRAMMAR_EXCEPTION', 'COURSE_LESSON', 'EXERCISE_KNOWLEDGE', 'USER_ERROR', 'LEARNING_SUMMARY');
CREATE TYPE "PrivateLearningSummaryTopicType" AS ENUM ('WORD', 'ERROR_TYPE', 'COURSE_TOPIC');
CREATE TYPE "PrivateLearningSummaryStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'DELETING');

CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "sourceKey" VARCHAR(128) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "sourceType" VARCHAR(64) NOT NULL,
    "licenseRef" VARCHAR(500),
    "rightsVersion" VARCHAR(128) NOT NULL,
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'DRAFT',
    "allowEmbedding" BOOLEAN NOT NULL DEFAULT false,
    "allowExcerptDisplay" BOOLEAN NOT NULL DEFAULT false,
    "allowEvaluation" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeSource_window_check" CHECK ("validFrom" IS NULL OR "validUntil" IS NULL OR "validFrom" < "validUntil"),
    CONSTRAINT "KnowledgeSource_active_check" CHECK (
      "status" <> 'ACTIVE' OR
      ("verifiedAt" IS NOT NULL AND length(trim("rightsVersion")) > 0)
    )
);

CREATE TABLE "KnowledgeSourceFieldPolicy" (
    "id" TEXT NOT NULL,
    "knowledgeSourceId" TEXT NOT NULL,
    "recordType" VARCHAR(64) NOT NULL,
    "fieldName" VARCHAR(128) NOT NULL,
    "allowEmbedding" BOOLEAN NOT NULL DEFAULT false,
    "allowExcerptDisplay" BOOLEAN NOT NULL DEFAULT false,
    "allowEvaluation" BOOLEAN NOT NULL DEFAULT false,
    "contentCategory" "KnowledgeCategory" NOT NULL,
    "policyVersion" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeSourceFieldPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeRelease" (
    "id" TEXT NOT NULL,
    "scopeKey" VARCHAR(300) NOT NULL,
    "contentVersion" VARCHAR(128) NOT NULL,
    "rightsVersion" VARCHAR(128) NOT NULL,
    "chunkingVersion" VARCHAR(128) NOT NULL,
    "embeddingVersion" VARCHAR(256) NOT NULL,
    "retrievalConfigVersion" VARCHAR(128) NOT NULL,
    "indexVersion" VARCHAR(128) NOT NULL,
    "expectedChunkCount" INTEGER NOT NULL DEFAULT 0,
    "readyEmbeddingCount" INTEGER NOT NULL DEFAULT 0,
    "status" "KnowledgeReleaseStatus" NOT NULL DEFAULT 'BUILDING',
    "activatedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeRelease_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeRelease_counts_check" CHECK (
      "expectedChunkCount" >= 0 AND
      "readyEmbeddingCount" >= 0 AND
      "readyEmbeddingCount" <= "expectedChunkCount"
    ),
    CONSTRAINT "KnowledgeRelease_ready_check" CHECK (
      "status" NOT IN ('READY', 'ACTIVE') OR
      ("expectedChunkCount" > 0 AND "readyEmbeddingCount" = "expectedChunkCount")
    ),
    CONSTRAINT "KnowledgeRelease_active_timestamp_check" CHECK (
      "status" <> 'ACTIVE' OR "activatedAt" IS NOT NULL
    )
);

CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "knowledgeSourceId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "source" VARCHAR(128) NOT NULL,
    "sourceId" VARCHAR(300) NOT NULL,
    "sourceRecordType" VARCHAR(64) NOT NULL,
    "sourceRecordId" VARCHAR(128) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "contentVersion" VARCHAR(128) NOT NULL,
    "visibility" VARCHAR(16) NOT NULL,
    "accessScope" "KnowledgeAccessScope" NOT NULL,
    "userId" TEXT,
    "courseId" TEXT,
    "wordId" TEXT,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'STAGED',
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeDocument_access_check" CHECK (
      ("accessScope" = 'PUBLIC' AND "visibility" = 'public' AND "userId" IS NULL) OR
      ("accessScope" = 'OWNED_COURSE' AND "visibility" = 'public' AND "userId" IS NULL AND "courseId" IS NOT NULL) OR
      ("accessScope" = 'PRIVATE_OWNER' AND "visibility" = 'private' AND "userId" IS NOT NULL)
    )
);

CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkKey" VARCHAR(200) NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" VARCHAR(128) NOT NULL,
    "chunkingVersion" VARCHAR(128) NOT NULL,
    "source" VARCHAR(128) NOT NULL,
    "sourceId" VARCHAR(300) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "category" "KnowledgeCategory" NOT NULL,
    "level" "CefrLevel",
    "courseId" TEXT,
    "wordId" TEXT,
    "userId" TEXT,
    "visibility" VARCHAR(16) NOT NULL,
    "contentVersion" VARCHAR(128) NOT NULL,
    "factKey" VARCHAR(300),
    "factValueHash" VARCHAR(128),
    "authorityRank" INTEGER,
    "status" "KnowledgeChunkStatus" NOT NULL DEFAULT 'STAGED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeChunk_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "KnowledgeChunk_visibility_check" CHECK (
      ("visibility" = 'public' AND "userId" IS NULL) OR
      ("visibility" = 'private' AND "userId" IS NOT NULL)
    )
);

CREATE TABLE "KnowledgeEmbedding" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "embeddingVersion" VARCHAR(256) NOT NULL,
    "inputHash" VARCHAR(128) NOT NULL,
    "embedding" vector,
    "status" "KnowledgeEmbeddingStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeEmbedding_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeEmbedding_dimensions_check" CHECK ("dimensions" > 0),
    CONSTRAINT "KnowledgeEmbedding_vector_dimensions_check" CHECK (
      "embedding" IS NULL OR vector_dims("embedding") = "dimensions"
    ),
    CONSTRAINT "KnowledgeEmbedding_ready_check" CHECK (
      "status" <> 'READY' OR
      ("embedding" IS NOT NULL AND "failureCode" IS NULL AND vector_norm("embedding") > 0)
    )
);

CREATE TABLE "KnowledgeIngestionJob" (
    "id" TEXT NOT NULL,
    "operation" "KnowledgeIngestionOperation" NOT NULL,
    "knowledgeSourceId" TEXT NOT NULL,
    "sourceRecordType" VARCHAR(64) NOT NULL,
    "sourceRecordId" VARCHAR(128) NOT NULL,
    "contentVersion" VARCHAR(128),
    "pipelineVersion" VARCHAR(256) NOT NULL,
    "ownerUserId" TEXT,
    "status" "KnowledgeIngestionStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "failureCode" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeIngestionJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeIngestionJob_attempt_check" CHECK ("attemptCount" >= 0),
    CONSTRAINT "KnowledgeIngestionJob_content_version_check" CHECK (
      "operation" NOT IN ('UPSERT', 'REEMBED') OR "contentVersion" IS NOT NULL
    )
);

CREATE TABLE "PrivateLearningSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicType" "PrivateLearningSummaryTopicType" NOT NULL,
    "topicKey" VARCHAR(128) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "summaryFacts" JSONB NOT NULL,
    "evidenceVersion" VARCHAR(128) NOT NULL,
    "status" "PrivateLearningSummaryStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivateLearningSummary_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrivateLearningSummary_window_check" CHECK ("windowStart" <= "windowEnd")
);

CREATE TABLE "KnowledgeCitation" (
    "id" VARCHAR(64) NOT NULL,
    "requestId" TEXT NOT NULL,
    "chunkId" TEXT,
    "documentId" TEXT,
    "sourceId" VARCHAR(300),
    "sourceIdHash" VARCHAR(128) NOT NULL,
    "contentVersion" VARCHAR(128) NOT NULL,
    "embeddingVersion" VARCHAR(256) NOT NULL,
    "excerpt" VARCHAR(2000),
    "excerptHash" VARCHAR(128) NOT NULL,
    "rank" INTEGER NOT NULL,
    "relevanceScore" DECIMAL(8,7) NOT NULL,
    "status" "KnowledgeCitationStatus" NOT NULL DEFAULT 'ACTIVE',
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeCitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeCitation_rank_check" CHECK ("rank" > 0 AND "rank" <= 20),
    CONSTRAINT "KnowledgeCitation_relevance_check" CHECK ("relevanceScore" >= 0 AND "relevanceScore" <= 1),
    CONSTRAINT "KnowledgeCitation_status_check" CHECK (
      ("status" = 'ACTIVE' AND "chunkId" IS NOT NULL AND "documentId" IS NOT NULL AND "sourceId" IS NOT NULL AND "excerpt" IS NOT NULL AND "invalidatedAt" IS NULL) OR
      ("status" <> 'ACTIVE' AND "invalidatedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "KnowledgeSource_sourceKey_key" ON "KnowledgeSource"("sourceKey");
CREATE INDEX "KnowledgeSource_status_validUntil_idx" ON "KnowledgeSource"("status", "validUntil");
CREATE UNIQUE INDEX "KnowledgeSourceFieldPolicy_source_record_field_policy_key" ON "KnowledgeSourceFieldPolicy"("knowledgeSourceId", "recordType", "fieldName", "policyVersion");
CREATE UNIQUE INDEX "KnowledgeRelease_pipeline_key" ON "KnowledgeRelease"("scopeKey", "contentVersion", "rightsVersion", "chunkingVersion", "embeddingVersion");
CREATE UNIQUE INDEX "KnowledgeRelease_one_ACTIVE_scope_key" ON "KnowledgeRelease"("scopeKey") WHERE "status" = 'ACTIVE';
CREATE INDEX "KnowledgeRelease_status_embedding_retrieval_idx" ON "KnowledgeRelease"("status", "embeddingVersion", "retrievalConfigVersion");
CREATE UNIQUE INDEX "KnowledgeDocument_source_version_key" ON "KnowledgeDocument"("knowledgeSourceId", "sourceRecordType", "sourceRecordId", "contentVersion");
CREATE INDEX "KnowledgeDocument_status_scope_owner_idx" ON "KnowledgeDocument"("status", "accessScope", "userId");
CREATE INDEX "KnowledgeDocument_status_course_idx" ON "KnowledgeDocument"("status", "courseId");
CREATE INDEX "KnowledgeDocument_word_idx" ON "KnowledgeDocument"("wordId");
CREATE UNIQUE INDEX "KnowledgeChunk_document_strategy_key_hash_key" ON "KnowledgeChunk"("documentId", "chunkingVersion", "chunkKey", "contentHash");
CREATE INDEX "KnowledgeChunk_document_status_idx" ON "KnowledgeChunk"("documentId", "status");
CREATE INDEX "KnowledgeChunk_category_level_idx" ON "KnowledgeChunk"("category", "level");
CREATE INDEX "KnowledgeChunk_course_status_idx" ON "KnowledgeChunk"("courseId", "status");
CREATE INDEX "KnowledgeChunk_word_status_idx" ON "KnowledgeChunk"("wordId", "status");
CREATE INDEX "KnowledgeChunk_user_status_idx" ON "KnowledgeChunk"("userId", "status");
CREATE INDEX "KnowledgeChunk_fact_key_idx" ON "KnowledgeChunk"("factKey");
CREATE UNIQUE INDEX "KnowledgeEmbedding_chunk_version_input_key" ON "KnowledgeEmbedding"("chunkId", "embeddingVersion", "inputHash");
CREATE INDEX "KnowledgeEmbedding_version_dimensions_status_chunk_idx" ON "KnowledgeEmbedding"("embeddingVersion", "dimensions", "status", "chunkId");
CREATE UNIQUE INDEX "KnowledgeIngestionJob_idempotency_key" ON "KnowledgeIngestionJob"("operation", "sourceRecordType", "sourceRecordId", COALESCE("contentVersion", '__none__'), "pipelineVersion");
CREATE INDEX "KnowledgeIngestionJob_status_next_created_idx" ON "KnowledgeIngestionJob"("status", "nextAttemptAt", "createdAt");
CREATE UNIQUE INDEX "PrivateLearningSummary_one_ACTIVE_topic_key" ON "PrivateLearningSummary"("userId", "topicType", "topicKey") WHERE "status" = 'ACTIVE';
CREATE INDEX "PrivateLearningSummary_user_topic_status_idx" ON "PrivateLearningSummary"("userId", "topicType", "topicKey", "status");
CREATE UNIQUE INDEX "KnowledgeCitation_request_chunk_version_key" ON "KnowledgeCitation"("requestId", "chunkId", "contentVersion");
CREATE INDEX "KnowledgeCitation_request_status_idx" ON "KnowledgeCitation"("requestId", "status");
CREATE INDEX "KnowledgeCitation_chunk_status_idx" ON "KnowledgeCitation"("chunkId", "status");
CREATE INDEX "KnowledgeCitation_source_hash_version_idx" ON "KnowledgeCitation"("sourceIdHash", "contentVersion");

ALTER TABLE "KnowledgeSourceFieldPolicy" ADD CONSTRAINT "KnowledgeSourceFieldPolicy_source_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_source_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_release_fkey" FOREIGN KEY ("releaseId") REFERENCES "KnowledgeRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_course_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_word_fkey" FOREIGN KEY ("wordId") REFERENCES "WordBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_document_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeEmbedding" ADD CONSTRAINT "KnowledgeEmbedding_chunk_fkey" FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeIngestionJob" ADD CONSTRAINT "KnowledgeIngestionJob_source_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivateLearningSummary" ADD CONSTRAINT "PrivateLearningSummary_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeCitation" ADD CONSTRAINT "KnowledgeCitation_request_fkey" FOREIGN KEY ("requestId") REFERENCES "CoachRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeCitation" ADD CONSTRAINT "KnowledgeCitation_chunk_fkey" FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeCitation" ADD CONSTRAINT "KnowledgeCitation_document_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON TABLE "KnowledgeRelease" IS 'Atomic publication boundary; migration creates no ACTIVE rows.';
COMMENT ON COLUMN "KnowledgeEmbedding"."embedding" IS 'Raw vector access is confined to the parameterized knowledge vector repository.';
