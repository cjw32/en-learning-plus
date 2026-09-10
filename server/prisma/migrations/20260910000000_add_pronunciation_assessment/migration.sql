-- Additive pronunciation-assessment schema. Runtime gates remain disabled by
-- default. This migration does not enable Provider, storage, learning-write or
-- Coach behavior and must never be applied to production without approval.

ALTER TYPE "LearningTargetType" ADD VALUE IF NOT EXISTS 'PRONUNCIATION_WORD';

CREATE TYPE "LearningAttemptType" AS ENUM ('EXERCISE', 'PRONUNCIATION');
CREATE TYPE "LearningEvidenceKind" AS ENUM ('EXERCISE_GRADING', 'PRONUNCIATION_WORD');
CREATE TYPE "PronunciationAssessmentStatus" AS ENUM ('CREATED', 'AUDIO_VALIDATING', 'AUDIO_READY', 'QUEUED', 'PROCESSING', 'COMPLETED', 'REFERENCE_ONLY', 'UNRECOGNIZABLE', 'REJECTED', 'CANCELLED', 'TIMED_OUT', 'FAILED', 'DELETING', 'DELETED');
CREATE TYPE "PronunciationExerciseType" AS ENUM ('WORD', 'PHRASE', 'SENTENCE');
CREATE TYPE "PronunciationTargetSource" AS ENUM ('MANUAL', 'WORD_BOOK', 'COURSE_WORD', 'RAG_CITATION', 'COACH_EXERCISE');
CREATE TYPE "PronunciationConfidenceTier" AS ENUM ('RELIABLE', 'REFERENCE_ONLY', 'REJECTED');
CREATE TYPE "PronunciationWordStatus" AS ENUM ('CORRECT', 'MISPRONOUNCED', 'OMITTED', 'INSERTED', 'UNCERTAIN');
CREATE TYPE "PronunciationAudioStatus" AS ENUM ('UPLOADING', 'QUARANTINED', 'VALIDATING', 'READY', 'INVALID', 'REVOKED', 'PURGING', 'PURGED');
CREATE TYPE "PronunciationLearningWriteStatus" AS ENUM ('NOT_ELIGIBLE', 'PENDING', 'SAVED', 'FAILED', 'COMPENSATING', 'COMPENSATED');
CREATE TYPE "PronunciationNextAction" AS ENUM ('RETRY', 'REVIEW', 'CONTINUE');
CREATE TYPE "PronunciationProviderCallStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'UNRECOGNIZABLE', 'TIMED_OUT', 'RATE_LIMITED', 'CANCELLED', 'FAILED', 'INVALID_RESPONSE');
CREATE TYPE "PronunciationProviderRetryDecision" AS ENUM ('NOT_NEEDED', 'SAFE_NOT_ACCEPTED', 'PROVIDER_IDEMPOTENT', 'UNKNOWN_ACCEPTANCE_NO_RETRY', 'LIMIT_REACHED');
CREATE TYPE "PronunciationTraceStepName" AS ENUM ('UPLOAD', 'VALIDATE_AUDIO', 'QUEUE', 'PROVIDER', 'VALIDATE_RESULT', 'SAVE_LEARNING', 'PURGE');
CREATE TYPE "PronunciationTraceStepStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED', 'TIMED_OUT');
CREATE TYPE "PronunciationDeletionScope" AS ENUM ('PRONUNCIATION_AUDIO', 'PRONUNCIATION_ASSESSMENT');
CREATE TYPE "PronunciationDeletionStatus" AS ENUM ('ACCEPTED', 'COMPENSATING', 'PURGING', 'COMPLETED', 'FAILED');
CREATE TYPE "LearningStateRecalculationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

ALTER TABLE "LearningAttempt"
  ADD COLUMN "attemptType" "LearningAttemptType" NOT NULL DEFAULT 'EXERCISE',
  ADD COLUMN "pronunciationAssessmentId" TEXT,
  ADD COLUMN "evidenceHash" VARCHAR(128),
  ADD COLUMN "policyVersion" VARCHAR(64),
  ALTER COLUMN "exerciseId" DROP NOT NULL,
  ALTER COLUMN "submissionId" DROP NOT NULL,
  ALTER COLUMN "saveRequestId" DROP NOT NULL,
  ALTER COLUMN "gradingHash" DROP NOT NULL;

UPDATE "LearningAttempt"
SET "attemptType" = 'EXERCISE'
WHERE "attemptType" IS DISTINCT FROM 'EXERCISE';

ALTER TABLE "LearningReviewEvent"
  ADD COLUMN "evidenceKind" "LearningEvidenceKind" NOT NULL DEFAULT 'EXERCISE_GRADING',
  ADD COLUMN "schedulerVersion" VARCHAR(64) NOT NULL DEFAULT 'SM2_V1',
  ADD COLUMN "policyVersion" VARCHAR(64) NOT NULL DEFAULT 'coach-attempt.v1',
  ADD COLUMN "voidedAt" TIMESTAMP(3);

CREATE TABLE "PronunciationAssessment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientIdempotencyKey" VARCHAR(128) NOT NULL,
  "requestBodyHash" VARCHAR(128) NOT NULL,
  "contentFingerprint" VARCHAR(128),
  "retryOfAssessmentId" TEXT,
  "status" "PronunciationAssessmentStatus" NOT NULL DEFAULT 'CREATED',
  "exerciseType" "PronunciationExerciseType" NOT NULL,
  "confidenceTier" "PronunciationConfidenceTier",
  "recognizedText" VARCHAR(500),
  "overallScore" DECIMAL(5,2),
  "accuracyScore" DECIMAL(5,2),
  "completenessScore" DECIMAL(5,2),
  "fluencyScore" DECIMAL(5,2),
  "prosodyScore" DECIMAL(5,2),
  "confidence" DECIMAL(4,3),
  "summary" VARCHAR(1000),
  "suggestions" JSONB,
  "nextAction" "PronunciationNextAction",
  "resultSchemaVersion" VARCHAR(64),
  "resultHash" VARCHAR(128),
  "provider" VARCHAR(64),
  "modelVersion" VARCHAR(128),
  "providerAdapterVersion" VARCHAR(64),
  "providerApiVersion" VARCHAR(64),
  "assessmentRuleVersion" VARCHAR(64),
  "normalizationVersion" VARCHAR(64),
  "alignmentVersion" VARCHAR(64),
  "confidencePolicyVersion" VARCHAR(64),
  "weaknessMappingVersion" VARCHAR(64),
  "schedulerVersion" VARCHAR(64),
  "budgetVersion" VARCHAR(64),
  "priceVersion" VARCHAR(64),
  "publicErrorCode" VARCHAR(64),
  "learningWriteStatus" "PronunciationLearningWriteStatus" NOT NULL DEFAULT 'NOT_ELIGIBLE',
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "cancelRequestedAt" TIMESTAMP(3),
  "queuedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "hiddenAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PronunciationAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PronunciationAssessment_score_range_check" CHECK (
    ("overallScore" IS NULL OR "overallScore" BETWEEN 0 AND 100) AND
    ("accuracyScore" IS NULL OR "accuracyScore" BETWEEN 0 AND 100) AND
    ("completenessScore" IS NULL OR "completenessScore" BETWEEN 0 AND 100) AND
    ("fluencyScore" IS NULL OR "fluencyScore" BETWEEN 0 AND 100) AND
    ("prosodyScore" IS NULL OR "prosodyScore" BETWEEN 0 AND 100) AND
    ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1)
  ),
  CONSTRAINT "PronunciationAssessment_complete_result_check" CHECK (
    "status" NOT IN ('COMPLETED', 'REFERENCE_ONLY') OR
    ("overallScore" IS NOT NULL AND "accuracyScore" IS NOT NULL AND
     "completenessScore" IS NOT NULL AND "fluencyScore" IS NOT NULL AND
     "confidence" IS NOT NULL AND "resultSchemaVersion" IS NOT NULL AND
     "resultHash" IS NOT NULL AND "provider" IS NOT NULL AND
     "modelVersion" IS NOT NULL AND "providerAdapterVersion" IS NOT NULL AND
     "providerApiVersion" IS NOT NULL AND "assessmentRuleVersion" IS NOT NULL AND
     "normalizationVersion" IS NOT NULL AND "alignmentVersion" IS NOT NULL AND
     "confidencePolicyVersion" IS NOT NULL AND "weaknessMappingVersion" IS NOT NULL AND
     "schedulerVersion" IS NOT NULL AND "budgetVersion" IS NOT NULL AND
     "priceVersion" IS NOT NULL)
  ),
  CONSTRAINT "PronunciationAssessment_confidence_status_check" CHECK (
    ("status" <> 'COMPLETED' OR ("confidence" >= 0.80 AND "confidenceTier" = 'RELIABLE')) AND
    ("status" <> 'REFERENCE_ONLY' OR ("confidence" >= 0.60 AND "confidence" < 0.80 AND "confidenceTier" = 'REFERENCE_ONLY')) AND
    ("status" <> 'UNRECOGNIZABLE' OR ("confidence" < 0.60 AND "overallScore" IS NULL))
  )
);

CREATE TABLE "PronunciationTarget" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceType" "PronunciationTargetSource" NOT NULL,
  "exerciseType" "PronunciationExerciseType" NOT NULL,
  "languageTag" VARCHAR(16) NOT NULL,
  "referenceText" VARCHAR(200) NOT NULL,
  "normalizedTokens" JSONB NOT NULL,
  "targetHash" VARCHAR(128) NOT NULL,
  "wordId" TEXT,
  "courseId" TEXT,
  "knowledgeCitationId" TEXT,
  "coachRequestId" TEXT,
  "exerciseId" TEXT,
  "itemId" TEXT,
  "sourceRecordType" VARCHAR(64),
  "sourceRecordId" VARCHAR(128),
  "sourceVersion" VARCHAR(128),
  "sourceContentHash" VARCHAR(128),
  "sourceRightsVersion" VARCHAR(128),
  "authorizedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PronunciationTarget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PronunciationTarget_locale_check" CHECK ("languageTag" IN ('en-US', 'en-GB')),
  CONSTRAINT "PronunciationTarget_text_check" CHECK (length("referenceText") BETWEEN 1 AND 200),
  CONSTRAINT "PronunciationTarget_source_xor_check" CHECK (
    ("sourceType" = 'MANUAL' AND "wordId" IS NULL AND "courseId" IS NULL AND "knowledgeCitationId" IS NULL AND "coachRequestId" IS NULL) OR
    ("sourceType" = 'WORD_BOOK' AND "wordId" IS NOT NULL AND "courseId" IS NULL AND "knowledgeCitationId" IS NULL AND "coachRequestId" IS NULL) OR
    ("sourceType" = 'COURSE_WORD' AND "wordId" IS NOT NULL AND "courseId" IS NOT NULL AND "knowledgeCitationId" IS NULL AND "coachRequestId" IS NULL) OR
    ("sourceType" = 'RAG_CITATION' AND "wordId" IS NULL AND "courseId" IS NULL AND "knowledgeCitationId" IS NOT NULL AND "coachRequestId" IS NULL) OR
    ("sourceType" = 'COACH_EXERCISE' AND "courseId" IS NULL AND "knowledgeCitationId" IS NULL AND "coachRequestId" IS NOT NULL AND "exerciseId" IS NOT NULL AND "itemId" IS NOT NULL)
  )
);

CREATE TABLE "PronunciationAudioAsset" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "objectKey" VARCHAR(256) NOT NULL,
  "declaredMediaType" VARCHAR(128) NOT NULL,
  "detectedMediaType" VARCHAR(128),
  "container" VARCHAR(64),
  "codec" VARCHAR(64),
  "byteSize" INTEGER NOT NULL,
  "durationMs" INTEGER,
  "sampleRate" INTEGER,
  "channelCount" INTEGER,
  "sha256" VARCHAR(64) NOT NULL,
  "qualityStatus" VARCHAR(64),
  "status" "PronunciationAudioStatus" NOT NULL DEFAULT 'UPLOADING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "accessRevokedAt" TIMESTAMP(3),
  "purgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PronunciationAudioAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PronunciationAudioAsset_size_check" CHECK ("byteSize" BETWEEN 1 AND 8388608),
  CONSTRAINT "PronunciationAudioAsset_duration_check" CHECK (
    "durationMs" IS NULL OR "durationMs" BETWEEN 500 AND 30000
  ),
  CONSTRAINT "PronunciationAudioAsset_ready_check" CHECK (
    "status" <> 'READY' OR ("durationMs" IS NOT NULL AND "detectedMediaType" IS NOT NULL AND "container" IS NOT NULL AND "codec" IS NOT NULL)
  )
);

CREATE TABLE "PronunciationWordAssessment" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "targetPosition" INTEGER,
  "insertionAfterPosition" INTEGER,
  "word" VARCHAR(100) NOT NULL,
  "normalizedWord" VARCHAR(100) NOT NULL,
  "startMs" INTEGER,
  "endMs" INTEGER,
  "score" DECIMAL(5,2),
  "status" "PronunciationWordStatus" NOT NULL,
  "feedback" VARCHAR(500),
  "wordId" TEXT,
  "alignmentConfidence" DECIMAL(4,3),
  "alignmentReliable" BOOLEAN NOT NULL DEFAULT false,
  "quality" INTEGER,
  "mappingVersion" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PronunciationWordAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PronunciationWordAssessment_range_check" CHECK (
    "sequence" BETWEEN 0 AND 89 AND
    ("targetPosition" IS NULL OR "targetPosition" BETWEEN 0 AND 29) AND
    ("insertionAfterPosition" IS NULL OR "insertionAfterPosition" BETWEEN -1 AND 29) AND
    ("score" IS NULL OR "score" BETWEEN 0 AND 100) AND
    ("alignmentConfidence" IS NULL OR "alignmentConfidence" BETWEEN 0 AND 1) AND
    ("quality" IS NULL OR "quality" BETWEEN 0 AND 5)
  ),
  CONSTRAINT "PronunciationWordAssessment_timestamp_check" CHECK (
    ("startMs" IS NULL AND "endMs" IS NULL) OR
    ("startMs" >= 0 AND "endMs" >= "startMs" AND "endMs" <= 30000)
  ),
  CONSTRAINT "PronunciationWordAssessment_status_check" CHECK (
    ("status" = 'INSERTED' AND "targetPosition" IS NULL AND "quality" IS NULL) OR
    ("status" = 'UNCERTAIN' AND "quality" IS NULL) OR
    ("status" = 'OMITTED' AND "targetPosition" IS NOT NULL AND "startMs" IS NULL AND "endMs" IS NULL) OR
    ("status" IN ('CORRECT', 'MISPRONOUNCED') AND "targetPosition" IS NOT NULL)
  )
);

CREATE TABLE "PronunciationProviderCall" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "modelVersion" VARCHAR(128) NOT NULL,
  "providerAdapterVersion" VARCHAR(64) NOT NULL,
  "apiContractVersion" VARCHAR(64) NOT NULL,
  "capabilityVersion" VARCHAR(64) NOT NULL,
  "applicationConnectionId" VARCHAR(128) NOT NULL,
  "providerRequestId" VARCHAR(256),
  "inputHash" VARCHAR(128) NOT NULL,
  "status" "PronunciationProviderCallStatus" NOT NULL DEFAULT 'STARTED',
  "providerAccepted" BOOLEAN,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "latencyMs" INTEGER,
  "billableDurationMs" INTEGER,
  "cost" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "currency" VARCHAR(8) NOT NULL,
  "priceVersion" VARCHAR(128) NOT NULL,
  "failureCode" VARCHAR(64),
  "retryDecision" "PronunciationProviderRetryDecision" NOT NULL DEFAULT 'NOT_NEEDED',
  "lateResultDiscardedAt" TIMESTAMP(3),
  "responseHash" VARCHAR(128),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PronunciationProviderCall_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PronunciationProviderCall_range_check" CHECK (
    "attemptNo" BETWEEN 1 AND 2 AND
    ("latencyMs" IS NULL OR "latencyMs" BETWEEN 0 AND 30000) AND
    ("billableDurationMs" IS NULL OR "billableDurationMs" BETWEEN 0 AND 30000) AND
    "cost" >= 0
  )
);

CREATE TABLE "PronunciationTrace" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "traceSubjectId" VARCHAR(128) NOT NULL,
  "exerciseType" "PronunciationExerciseType" NOT NULL,
  "targetWordCount" INTEGER NOT NULL,
  "targetCharacterCount" INTEGER NOT NULL,
  "audioMediaType" VARCHAR(128),
  "audioByteSize" INTEGER,
  "audioDurationMs" INTEGER,
  "provider" VARCHAR(64),
  "modelVersion" VARCHAR(128),
  "uploadDurationMs" INTEGER,
  "queueDurationMs" INTEGER,
  "decodeDurationMs" INTEGER,
  "providerDurationMs" INTEGER,
  "totalDurationMs" INTEGER,
  "terminalStatus" "PronunciationAssessmentStatus",
  "confidence" DECIMAL(4,3),
  "confidenceTier" "PronunciationConfidenceTier",
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "cancelled" BOOLEAN NOT NULL DEFAULT false,
  "timedOut" BOOLEAN NOT NULL DEFAULT false,
  "degraded" BOOLEAN NOT NULL DEFAULT false,
  "learningWriteStatus" "PronunciationLearningWriteStatus" NOT NULL DEFAULT 'NOT_ELIGIBLE',
  "learningWriteCount" INTEGER NOT NULL DEFAULT 0,
  "estimatedCost" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "actualCost" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "currency" VARCHAR(8) NOT NULL,
  "resultSchemaVersion" VARCHAR(64),
  "providerAdapterVersion" VARCHAR(64),
  "providerApiVersion" VARCHAR(64),
  "normalizationVersion" VARCHAR(64),
  "alignmentVersion" VARCHAR(64),
  "assessmentRuleVersion" VARCHAR(64),
  "confidencePolicyVersion" VARCHAR(64),
  "learningMappingVersion" VARCHAR(64),
  "schedulerVersion" VARCHAR(64),
  "budgetVersion" VARCHAR(64),
  "priceVersion" VARCHAR(128),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PronunciationTrace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PronunciationTrace_metrics_check" CHECK (
    "targetWordCount" BETWEEN 1 AND 30 AND "targetCharacterCount" BETWEEN 1 AND 200 AND
    ("audioByteSize" IS NULL OR "audioByteSize" BETWEEN 1 AND 8388608) AND
    ("audioDurationMs" IS NULL OR "audioDurationMs" BETWEEN 500 AND 30000) AND
    ("uploadDurationMs" IS NULL OR "uploadDurationMs" >= 0) AND
    ("queueDurationMs" IS NULL OR "queueDurationMs" >= 0) AND
    ("decodeDurationMs" IS NULL OR "decodeDurationMs" >= 0) AND
    ("providerDurationMs" IS NULL OR "providerDurationMs" >= 0) AND
    ("totalDurationMs" IS NULL OR "totalDurationMs" >= 0) AND
    ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1) AND
    "retryCount" BETWEEN 0 AND 1 AND "learningWriteCount" >= 0 AND
    "estimatedCost" >= 0 AND "actualCost" >= 0
  )
);

CREATE TABLE "PronunciationTraceStep" (
  "id" TEXT NOT NULL,
  "traceId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "stepName" "PronunciationTraceStepName" NOT NULL,
  "status" "PronunciationTraceStepStatus" NOT NULL,
  "durationMs" INTEGER,
  "errorCode" VARCHAR(64),
  "redactedMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PronunciationTraceStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PronunciationTraceStep_metrics_check" CHECK (
    "sequence" >= 0 AND ("durationMs" IS NULL OR "durationMs" >= 0)
  )
);

CREATE TABLE "PronunciationDeletionTombstone" (
  "id" TEXT NOT NULL,
  "subjectHash" VARCHAR(128) NOT NULL,
  "resourceHash" VARCHAR(128) NOT NULL,
  "scope" "PronunciationDeletionScope" NOT NULL,
  "status" "PronunciationDeletionStatus" NOT NULL DEFAULT 'ACCEPTED',
  "idempotencyKeyHash" VARCHAR(128) NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL,
  "hiddenAt" TIMESTAMP(3) NOT NULL,
  "purgeDeadline" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "failureCode" VARCHAR(64),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PronunciationDeletionTombstone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PronunciationDeletionTombstone_deadline_check" CHECK ("purgeDeadline" <= "requestedAt" + INTERVAL '1 hour')
);

CREATE TABLE "LearningStateRecalculationEvent" (
  "id" TEXT NOT NULL,
  "deletionId" TEXT NOT NULL,
  "itemStateId" TEXT NOT NULL,
  "sourceAttemptHash" VARCHAR(128) NOT NULL,
  "previousState" JSONB NOT NULL,
  "nextState" JSONB NOT NULL,
  "schedulerVersion" VARCHAR(64) NOT NULL,
  "policyVersion" VARCHAR(64) NOT NULL,
  "recalculationVersion" VARCHAR(64) NOT NULL,
  "replayedEventCount" INTEGER NOT NULL,
  "status" "LearningStateRecalculationStatus" NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningStateRecalculationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningStateRecalculationEvent_count_check" CHECK ("replayedEventCount" >= 0)
);

ALTER TABLE "LearningItemState" DROP CONSTRAINT "LearningItemState_target_check";
ALTER TABLE "LearningItemState" ADD CONSTRAINT "LearningItemState_target_check" CHECK (
  ("targetType" IN ('WORD', 'PRONUNCIATION_WORD') AND "wordId" IS NOT NULL AND "targetKey" = "wordId") OR
  ("targetType" = 'ERROR_TYPE' AND "wordId" IS NULL)
);

ALTER TABLE "LearningAttempt" ADD CONSTRAINT "LearningAttempt_variant_xor_check" CHECK (
  ("attemptType" = 'EXERCISE' AND "exerciseId" IS NOT NULL AND "submissionId" IS NOT NULL AND "saveRequestId" IS NOT NULL AND "gradingHash" IS NOT NULL AND "pronunciationAssessmentId" IS NULL AND "evidenceHash" IS NULL AND "policyVersion" IS NULL) OR
  ("attemptType" = 'PRONUNCIATION' AND "exerciseId" IS NULL AND "submissionId" IS NULL AND "saveRequestId" IS NULL AND "gradingHash" IS NULL AND "pronunciationAssessmentId" IS NOT NULL AND "evidenceHash" IS NOT NULL AND "policyVersion" IS NOT NULL)
);

CREATE UNIQUE INDEX "LearningAttempt_pronunciationAssessmentId_key" ON "LearningAttempt"("pronunciationAssessmentId");
CREATE INDEX "LearningAttempt_userId_attemptType_savedAt_idx" ON "LearningAttempt"("userId", "attemptType", "savedAt");
CREATE UNIQUE INDEX "PronunciationAssessment_userId_clientIdempotencyKey_key" ON "PronunciationAssessment"("userId", "clientIdempotencyKey");
CREATE INDEX "PronunciationAssessment_userId_createdAt_id_idx" ON "PronunciationAssessment"("userId", "createdAt" DESC, "id" DESC);
CREATE INDEX "PronunciationAssessment_status_deadlineAt_idx" ON "PronunciationAssessment"("status", "deadlineAt");
CREATE INDEX "PronunciationAssessment_retryOfAssessmentId_idx" ON "PronunciationAssessment"("retryOfAssessmentId");
CREATE UNIQUE INDEX "PronunciationAssessment_one_active_per_user_key" ON "PronunciationAssessment"("userId") WHERE "status" IN ('AUDIO_VALIDATING', 'AUDIO_READY', 'QUEUED', 'PROCESSING');
CREATE UNIQUE INDEX "PronunciationTarget_assessmentId_key" ON "PronunciationTarget"("assessmentId");
CREATE INDEX "PronunciationTarget_userId_sourceType_idx" ON "PronunciationTarget"("userId", "sourceType");
CREATE INDEX "PronunciationTarget_wordId_idx" ON "PronunciationTarget"("wordId");
CREATE INDEX "PronunciationTarget_courseId_idx" ON "PronunciationTarget"("courseId");
CREATE INDEX "PronunciationTarget_knowledgeCitationId_idx" ON "PronunciationTarget"("knowledgeCitationId");
CREATE INDEX "PronunciationTarget_coachRequestId_idx" ON "PronunciationTarget"("coachRequestId");
CREATE UNIQUE INDEX "PronunciationAudioAsset_assessmentId_key" ON "PronunciationAudioAsset"("assessmentId");
CREATE UNIQUE INDEX "PronunciationAudioAsset_objectKey_key" ON "PronunciationAudioAsset"("objectKey");
CREATE INDEX "PronunciationAudioAsset_status_expiresAt_idx" ON "PronunciationAudioAsset"("status", "expiresAt");
CREATE INDEX "PronunciationAudioAsset_userId_createdAt_idx" ON "PronunciationAudioAsset"("userId", "createdAt");
CREATE UNIQUE INDEX "PronunciationWordAssessment_assessmentId_sequence_key" ON "PronunciationWordAssessment"("assessmentId", "sequence");
CREATE UNIQUE INDEX "PronunciationWordAssessment_target_position_key" ON "PronunciationWordAssessment"("assessmentId", "targetPosition") WHERE "targetPosition" IS NOT NULL;
CREATE INDEX "PronunciationWordAssessment_wordId_idx" ON "PronunciationWordAssessment"("wordId");
CREATE UNIQUE INDEX "PronunciationProviderCall_assessmentId_attemptNo_key" ON "PronunciationProviderCall"("assessmentId", "attemptNo");
CREATE UNIQUE INDEX "PronunciationProviderCall_provider_providerRequestId_key" ON "PronunciationProviderCall"("provider", "providerRequestId");
CREATE INDEX "PronunciationProviderCall_assessmentId_status_idx" ON "PronunciationProviderCall"("assessmentId", "status");
CREATE UNIQUE INDEX "PronunciationTrace_assessmentId_key" ON "PronunciationTrace"("assessmentId");
CREATE INDEX "PronunciationTrace_traceSubjectId_createdAt_idx" ON "PronunciationTrace"("traceSubjectId", "createdAt");
CREATE INDEX "PronunciationTrace_expiresAt_idx" ON "PronunciationTrace"("expiresAt");
CREATE UNIQUE INDEX "PronunciationTraceStep_traceId_sequence_key" ON "PronunciationTraceStep"("traceId", "sequence");
CREATE UNIQUE INDEX "PronunciationDeletionTombstone_subjectHash_scope_resourceHash_key" ON "PronunciationDeletionTombstone"("subjectHash", "scope", "resourceHash");
CREATE UNIQUE INDEX "PronunciationDeletionTombstone_subjectHash_idempotencyKeyHash_key" ON "PronunciationDeletionTombstone"("subjectHash", "idempotencyKeyHash");
CREATE INDEX "PronunciationDeletionTombstone_status_purgeDeadline_idx" ON "PronunciationDeletionTombstone"("status", "purgeDeadline");
CREATE INDEX "PronunciationDeletionTombstone_expiresAt_idx" ON "PronunciationDeletionTombstone"("expiresAt");
CREATE UNIQUE INDEX "LearningStateRecalculationEvent_deletionId_itemStateId_key" ON "LearningStateRecalculationEvent"("deletionId", "itemStateId");
CREATE INDEX "LearningStateRecalculationEvent_itemStateId_createdAt_idx" ON "LearningStateRecalculationEvent"("itemStateId", "createdAt");
CREATE INDEX "LearningStateRecalculationEvent_status_createdAt_idx" ON "LearningStateRecalculationEvent"("status", "createdAt");

ALTER TABLE "PronunciationAssessment" ADD CONSTRAINT "PronunciationAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PronunciationAssessment" ADD CONSTRAINT "PronunciationAssessment_retryOfAssessmentId_fkey" FOREIGN KEY ("retryOfAssessmentId") REFERENCES "PronunciationAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PronunciationTarget" ADD CONSTRAINT "PronunciationTarget_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "PronunciationAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PronunciationTarget" ADD CONSTRAINT "PronunciationTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PronunciationTarget" ADD CONSTRAINT "PronunciationTarget_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "WordBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PronunciationTarget" ADD CONSTRAINT "PronunciationTarget_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PronunciationTarget" ADD CONSTRAINT "PronunciationTarget_knowledgeCitationId_fkey" FOREIGN KEY ("knowledgeCitationId") REFERENCES "KnowledgeCitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PronunciationTarget" ADD CONSTRAINT "PronunciationTarget_coachRequestId_fkey" FOREIGN KEY ("coachRequestId") REFERENCES "CoachRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PronunciationAudioAsset" ADD CONSTRAINT "PronunciationAudioAsset_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "PronunciationAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PronunciationAudioAsset" ADD CONSTRAINT "PronunciationAudioAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PronunciationWordAssessment" ADD CONSTRAINT "PronunciationWordAssessment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "PronunciationAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PronunciationWordAssessment" ADD CONSTRAINT "PronunciationWordAssessment_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "WordBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PronunciationProviderCall" ADD CONSTRAINT "PronunciationProviderCall_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "PronunciationAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PronunciationTrace" ADD CONSTRAINT "PronunciationTrace_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "PronunciationAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PronunciationTraceStep" ADD CONSTRAINT "PronunciationTraceStep_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "PronunciationTrace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningAttempt" ADD CONSTRAINT "LearningAttempt_pronunciationAssessmentId_fkey" FOREIGN KEY ("pronunciationAssessmentId") REFERENCES "PronunciationAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningStateRecalculationEvent" ADD CONSTRAINT "LearningStateRecalculationEvent_deletionId_fkey" FOREIGN KEY ("deletionId") REFERENCES "PronunciationDeletionTombstone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningStateRecalculationEvent" ADD CONSTRAINT "LearningStateRecalculationEvent_itemStateId_fkey" FOREIGN KEY ("itemStateId") REFERENCES "LearningItemState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
