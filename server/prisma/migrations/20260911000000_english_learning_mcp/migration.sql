-- Additive English Learning MCP persistence. All MCP runtime gates remain off
-- by default. Applying this migration does not configure OAuth or expose MCP.

CREATE TYPE "CoachConversationOrigin" AS ENUM ('COACH', 'MCP');
CREATE TYPE "McpAuthorizationStatus" AS ENUM ('ACTIVE', 'REVOKED', 'DELETING');
CREATE TYPE "McpProtocolEra" AS ENUM ('MODERN_2026_07_28', 'LEGACY_2025_11_25');
CREATE TYPE "McpTransport" AS ENUM ('STREAMABLE_HTTP');
CREATE TYPE "McpCapabilityType" AS ENUM ('RESOURCE', 'TOOL', 'PROMPT', 'DISCOVERY');
CREATE TYPE "McpInvocationStatus" AS ENUM ('RECEIVED', 'AUTHORIZED', 'VALIDATED', 'RUNNING', 'INPUT_REQUIRED', 'COMPLETED', 'RECONCILING', 'REJECTED', 'CANCELLED', 'TIMED_OUT', 'FAILED');
CREATE TYPE "McpInvocationResultType" AS ENUM ('SUCCESS', 'INPUT_REQUIRED', 'NOT_SAVED', 'REPLAYED', 'ERROR');
CREATE TYPE "McpIdempotencyToolName" AS ENUM ('CREATE_QUIZ', 'SUBMIT_ANSWER');
CREATE TYPE "McpIdempotencyStatus" AS ENUM ('RESERVED', 'PROCESSING', 'RECONCILING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED');
CREATE TYPE "McpWriteConfirmationState" AS ENUM ('PENDING', 'CONFIRMED', 'CLAIMED', 'CONSUMED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED');
CREATE TYPE "McpTraceStepType" AS ENUM ('PROTOCOL', 'AUTH', 'SCHEMA', 'GOVERNANCE', 'DOMAIN', 'RETRIEVAL', 'MODEL', 'WRITE');
CREATE TYPE "McpTraceStepStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED', 'TIMED_OUT');

ALTER TABLE "CoachConversation"
  ADD COLUMN "origin" "CoachConversationOrigin" NOT NULL DEFAULT 'COACH';

CREATE TABLE "McpSubjectMapping" (
  "id" TEXT NOT NULL,
  "issuer" VARCHAR(512) NOT NULL,
  "subjectHmac" VARCHAR(128) NOT NULL,
  "hmacKeyVersion" VARCHAR(64) NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "McpAuthorizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "McpSubjectMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpSubjectMapping_issuer_check" CHECK ("issuer" ~ '^https://'),
  CONSTRAINT "McpSubjectMapping_status_check" CHECK (
    ("status" = 'ACTIVE' AND "revokedAt" IS NULL) OR
    ("status" = 'DELETING') OR
    ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  )
);

CREATE TABLE "McpClientAuthorization" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subjectMappingId" TEXT NOT NULL,
  "issuer" VARCHAR(512) NOT NULL,
  "audience" VARCHAR(1024) NOT NULL,
  "clientId" VARCHAR(512) NOT NULL,
  "clientDisplayName" VARCHAR(120),
  "scopes" TEXT[] NOT NULL,
  "authorizationVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "McpAuthorizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "retentionExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "McpClientAuthorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpClientAuthorization_identity_check" CHECK (
    "issuer" ~ '^https://' AND "audience" ~ '^https://' AND
    length("clientId") > 0 AND "authorizationVersion" >= 1
  ),
  CONSTRAINT "McpClientAuthorization_scopes_check" CHECK (
    cardinality("scopes") BETWEEN 1 AND 3 AND
    "scopes" <@ ARRAY['learning:read', 'quiz:create', 'answer:submit']::TEXT[]
  ),
  CONSTRAINT "McpClientAuthorization_status_check" CHECK (
    ("status" = 'ACTIVE' AND "revokedAt" IS NULL) OR
    ("status" = 'DELETING') OR
    ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  )
);

CREATE TABLE "McpIdempotencyIntent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "issuer" VARCHAR(512) NOT NULL,
  "clientId" VARCHAR(512) NOT NULL,
  "toolName" "McpIdempotencyToolName" NOT NULL,
  "clientKeyDigest" VARCHAR(128) NOT NULL,
  "requestFingerprint" VARCHAR(128) NOT NULL,
  "logicalResource" VARCHAR(128),
  "status" "McpIdempotencyStatus" NOT NULL DEFAULT 'RESERVED',
  "leaseOwnerHmac" VARCHAR(128),
  "leaseExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "exerciseId" TEXT,
  "submissionId" TEXT,
  "learningAttemptId" TEXT,
  "gradingResult" JSONB,
  "gradingResultHash" VARCHAR(128),
  "safeTerminalProjection" JSONB,
  "safeErrorCode" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "McpIdempotencyIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpIdempotencyIntent_attempt_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "McpIdempotencyIntent_lease_check" CHECK (
    ("leaseOwnerHmac" IS NULL) = ("leaseExpiresAt" IS NULL)
  ),
  CONSTRAINT "McpIdempotencyIntent_grading_check" CHECK (
    ("gradingResult" IS NULL) = ("gradingResultHash" IS NULL)
  ),
  CONSTRAINT "McpIdempotencyIntent_completed_shape_check" CHECK (
    "status" <> 'COMPLETED' OR
    ("toolName" = 'CREATE_QUIZ' AND "exerciseId" IS NOT NULL AND "submissionId" IS NULL AND "learningAttemptId" IS NULL) OR
    ("toolName" = 'SUBMIT_ANSWER' AND "exerciseId" IS NOT NULL AND "submissionId" IS NOT NULL AND "learningAttemptId" IS NOT NULL)
  )
);

CREATE TABLE "McpWriteConfirmation" (
  "id" TEXT NOT NULL,
  "selectorHmac" VARCHAR(128) NOT NULL,
  "idempotencyIntentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "issuer" VARCHAR(512) NOT NULL,
  "clientId" VARCHAR(512) NOT NULL,
  "requiredScope" VARCHAR(64) NOT NULL DEFAULT 'answer:submit',
  "scopeSnapshotDigest" VARCHAR(128) NOT NULL,
  "toolVersion" VARCHAR(64) NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "exerciseVersion" VARCHAR(128) NOT NULL,
  "answerDigest" VARCHAR(128) NOT NULL,
  "operationSummary" JSONB NOT NULL,
  "operationSummaryVersion" VARCHAR(64) NOT NULL,
  "operationSummaryDigest" VARCHAR(128) NOT NULL,
  "state" "McpWriteConfirmationState" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "confirmingWebUserIdHmac" VARCHAR(128),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "McpWriteConfirmation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpWriteConfirmation_scope_check" CHECK ("requiredScope" = 'answer:submit'),
  CONSTRAINT "McpWriteConfirmation_expiry_check" CHECK (
    "expiresAt" = "createdAt" + INTERVAL '5 minutes'
  ),
  CONSTRAINT "McpWriteConfirmation_summary_size_check" CHECK (
    octet_length("operationSummary"::TEXT) <= 4096
  ),
  CONSTRAINT "McpWriteConfirmation_state_check" CHECK (
    ("state" = 'PENDING' AND "confirmedAt" IS NULL AND "claimedAt" IS NULL AND "consumedAt" IS NULL) OR
    ("state" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL AND "claimedAt" IS NULL AND "consumedAt" IS NULL) OR
    ("state" = 'CLAIMED' AND "confirmedAt" IS NOT NULL AND "claimedAt" IS NOT NULL AND "consumedAt" IS NULL) OR
    ("state" = 'CONSUMED' AND "confirmedAt" IS NOT NULL AND "claimedAt" IS NOT NULL AND "consumedAt" IS NOT NULL) OR
    ("state" IN ('REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED') AND "consumedAt" IS NULL)
  )
);

CREATE TABLE "McpInvocation" (
  "id" TEXT NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "traceId" VARCHAR(128) NOT NULL,
  "protocolEra" "McpProtocolEra" NOT NULL,
  "transport" "McpTransport" NOT NULL DEFAULT 'STREAMABLE_HTTP',
  "sessionIdHmac" VARCHAR(128),
  "protocolRequestIdHmac" VARCHAR(128),
  "capabilityType" "McpCapabilityType" NOT NULL,
  "capabilityName" VARCHAR(128) NOT NULL,
  "capabilityVersion" VARCHAR(64) NOT NULL,
  "inputSchemaVersion" VARCHAR(64),
  "inputFingerprint" VARCHAR(128),
  "status" "McpInvocationStatus" NOT NULL DEFAULT 'RECEIVED',
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "cancelRequestedAt" TIMESTAMP(3),
  "coachRequestId" TEXT,
  "idempotencyIntentId" TEXT,
  "resultType" "McpInvocationResultType",
  "safeErrorCode" VARCHAR(64),
  "businessResultType" VARCHAR(64),
  "businessResultIdHmac" VARCHAR(128),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "McpInvocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpInvocation_session_era_check" CHECK (
    "sessionIdHmac" IS NULL OR "protocolEra" = 'LEGACY_2025_11_25'
  ),
  CONSTRAINT "McpInvocation_terminal_check" CHECK (
    "status" <> 'COMPLETED' OR ("resultType" IS NOT NULL AND "finishedAt" IS NOT NULL)
  )
);

CREATE TABLE "McpTrace" (
  "id" TEXT NOT NULL,
  "traceId" VARCHAR(128) NOT NULL,
  "invocationId" TEXT NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "parentCoachTraceId" TEXT,
  "subjectHmac" VARCHAR(128) NOT NULL,
  "clientHmac" VARCHAR(128) NOT NULL,
  "authorizationVersion" INTEGER NOT NULL,
  "protocolEra" "McpProtocolEra" NOT NULL,
  "protocolVersion" VARCHAR(32) NOT NULL,
  "transport" "McpTransport" NOT NULL DEFAULT 'STREAMABLE_HTTP',
  "protocolMethod" VARCHAR(128) NOT NULL,
  "protocolRequestIdHmac" VARCHAR(128),
  "sessionIdHmac" VARCHAR(128),
  "negotiatedCapabilitiesDigest" VARCHAR(128),
  "clientDisplayName" VARCHAR(120),
  "clientDisplayVersion" VARCHAR(64),
  "capabilityType" "McpCapabilityType" NOT NULL,
  "capabilityName" VARCHAR(128) NOT NULL,
  "capabilityVersion" VARCHAR(64) NOT NULL,
  "capabilityEffect" VARCHAR(64) NOT NULL,
  "requiredScopes" TEXT[] NOT NULL,
  "inputSchemaVersion" VARCHAR(64),
  "outputSchemaVersion" VARCHAR(64),
  "discoveryDecision" VARCHAR(64),
  "executionDecision" VARCHAR(64),
  "governancePolicyVersion" VARCHAR(64) NOT NULL,
  "rateLimitResult" VARCHAR(64),
  "concurrencyResult" VARCHAR(64),
  "budgetResult" VARCHAR(64),
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "cancelled" BOOLEAN NOT NULL DEFAULT false,
  "timedOut" BOOLEAN NOT NULL DEFAULT false,
  "downstreamVersions" JSONB,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostMicros" INTEGER NOT NULL DEFAULT 0,
  "writeOutcome" VARCHAR(64),
  "idempotencyIntentIdHmac" VARCHAR(128),
  "confirmationIdHmac" VARCHAR(128),
  "businessResultIdHmac" VARCHAR(128),
  "terminalStatus" VARCHAR(64) NOT NULL,
  "safeErrorCode" VARCHAR(64),
  "outputBytes" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpTrace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpTrace_metrics_check" CHECK (
    "authorizationVersion" >= 1 AND "retryCount" >= 0 AND
    "inputTokens" >= 0 AND "outputTokens" >= 0 AND
    "estimatedCostMicros" >= 0 AND "outputBytes" BETWEEN 0 AND 262144
  ),
  CONSTRAINT "McpTrace_retention_check" CHECK ("retentionExpiresAt" >= "createdAt")
);

CREATE TABLE "McpTraceStep" (
  "id" TEXT NOT NULL,
  "traceId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "stepType" "McpTraceStepType" NOT NULL,
  "component" VARCHAR(64) NOT NULL,
  "operation" VARCHAR(64) NOT NULL,
  "status" "McpTraceStepStatus" NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "safeErrorCode" VARCHAR(64),
  "approvedMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpTraceStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpTraceStep_bounds_check" CHECK (
    "sequence" BETWEEN 0 AND 31 AND ("durationMs" IS NULL OR "durationMs" >= 0)
  ),
  CONSTRAINT "McpTraceStep_metadata_check" CHECK (
    "approvedMetadata" IS NULL OR NOT (
      "approvedMetadata" ?| ARRAY['token', 'accessToken', 'refreshToken', 'secret', 'prompt', 'reasoning', 'content', 'answers']
    )
  )
);

CREATE UNIQUE INDEX "McpSubjectMapping_issuer_subjectHmac_key" ON "McpSubjectMapping"("issuer", "subjectHmac");
CREATE UNIQUE INDEX "McpSubjectMapping_active_user_key" ON "McpSubjectMapping"("issuer", "userId") WHERE "status" = 'ACTIVE';
CREATE INDEX "McpSubjectMapping_issuer_userId_status_idx" ON "McpSubjectMapping"("issuer", "userId", "status");
CREATE INDEX "McpSubjectMapping_userId_status_idx" ON "McpSubjectMapping"("userId", "status");

CREATE UNIQUE INDEX "McpClientAuthorization_identity_key" ON "McpClientAuthorization"("userId", "subjectMappingId", "issuer", "audience", "clientId");
CREATE INDEX "McpClientAuthorization_issuer_clientId_status_idx" ON "McpClientAuthorization"("issuer", "clientId", "status");
CREATE INDEX "McpClientAuthorization_userId_status_lastSeenAt_idx" ON "McpClientAuthorization"("userId", "status", "lastSeenAt");
CREATE INDEX "McpClientAuthorization_retentionExpiresAt_idx" ON "McpClientAuthorization"("retentionExpiresAt");

CREATE UNIQUE INDEX "McpIdempotencyIntent_replay_key" ON "McpIdempotencyIntent"("userId", "issuer", "clientId", "toolName", "clientKeyDigest");
CREATE INDEX "McpIdempotencyIntent_authorizationId_status_leaseExpiresAt_idx" ON "McpIdempotencyIntent"("authorizationId", "status", "leaseExpiresAt");
CREATE INDEX "McpIdempotencyIntent_exerciseId_idx" ON "McpIdempotencyIntent"("exerciseId");
CREATE INDEX "McpIdempotencyIntent_submissionId_idx" ON "McpIdempotencyIntent"("submissionId");
CREATE INDEX "McpIdempotencyIntent_learningAttemptId_idx" ON "McpIdempotencyIntent"("learningAttemptId");

CREATE UNIQUE INDEX "McpWriteConfirmation_selectorHmac_key" ON "McpWriteConfirmation"("selectorHmac");
CREATE UNIQUE INDEX "McpWriteConfirmation_idempotencyIntentId_key" ON "McpWriteConfirmation"("idempotencyIntentId");
CREATE INDEX "McpWriteConfirmation_authorizationId_state_expiresAt_idx" ON "McpWriteConfirmation"("authorizationId", "state", "expiresAt");
CREATE INDEX "McpWriteConfirmation_userId_state_expiresAt_idx" ON "McpWriteConfirmation"("userId", "state", "expiresAt");
CREATE INDEX "McpWriteConfirmation_exerciseId_idx" ON "McpWriteConfirmation"("exerciseId");

CREATE UNIQUE INDEX "McpInvocation_traceId_key" ON "McpInvocation"("traceId");
CREATE UNIQUE INDEX "McpInvocation_coachRequestId_key" ON "McpInvocation"("coachRequestId");
CREATE INDEX "McpInvocation_authorizationId_status_createdAt_idx" ON "McpInvocation"("authorizationId", "status", "createdAt");
CREATE INDEX "McpInvocation_userId_capabilityType_createdAt_idx" ON "McpInvocation"("userId", "capabilityType", "createdAt");
CREATE INDEX "McpInvocation_idempotencyIntentId_idx" ON "McpInvocation"("idempotencyIntentId");
CREATE INDEX "McpInvocation_deadlineAt_status_idx" ON "McpInvocation"("deadlineAt", "status");

CREATE UNIQUE INDEX "McpTrace_traceId_key" ON "McpTrace"("traceId");
CREATE UNIQUE INDEX "McpTrace_invocationId_key" ON "McpTrace"("invocationId");
CREATE INDEX "McpTrace_authorizationId_createdAt_idx" ON "McpTrace"("authorizationId", "createdAt");
CREATE INDEX "McpTrace_subjectHmac_createdAt_idx" ON "McpTrace"("subjectHmac", "createdAt");
CREATE INDEX "McpTrace_parentCoachTraceId_idx" ON "McpTrace"("parentCoachTraceId");
CREATE INDEX "McpTrace_retentionExpiresAt_idx" ON "McpTrace"("retentionExpiresAt");
CREATE UNIQUE INDEX "McpTraceStep_traceId_sequence_key" ON "McpTraceStep"("traceId", "sequence");

CREATE INDEX "CoachConversation_userId_origin_status_lastActivityAt_idx" ON "CoachConversation"("userId", "origin", "status", "lastActivityAt");

ALTER TABLE "McpSubjectMapping" ADD CONSTRAINT "McpSubjectMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpClientAuthorization" ADD CONSTRAINT "McpClientAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpClientAuthorization" ADD CONSTRAINT "McpClientAuthorization_subjectMappingId_fkey" FOREIGN KEY ("subjectMappingId") REFERENCES "McpSubjectMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpIdempotencyIntent" ADD CONSTRAINT "McpIdempotencyIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpIdempotencyIntent" ADD CONSTRAINT "McpIdempotencyIntent_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "McpClientAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpIdempotencyIntent" ADD CONSTRAINT "McpIdempotencyIntent_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "McpIdempotencyIntent" ADD CONSTRAINT "McpIdempotencyIntent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ExerciseSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "McpIdempotencyIntent" ADD CONSTRAINT "McpIdempotencyIntent_learningAttemptId_fkey" FOREIGN KEY ("learningAttemptId") REFERENCES "LearningAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "McpWriteConfirmation" ADD CONSTRAINT "McpWriteConfirmation_idempotencyIntentId_fkey" FOREIGN KEY ("idempotencyIntentId") REFERENCES "McpIdempotencyIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpWriteConfirmation" ADD CONSTRAINT "McpWriteConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpWriteConfirmation" ADD CONSTRAINT "McpWriteConfirmation_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "McpClientAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpWriteConfirmation" ADD CONSTRAINT "McpWriteConfirmation_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpInvocation" ADD CONSTRAINT "McpInvocation_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "McpClientAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpInvocation" ADD CONSTRAINT "McpInvocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpInvocation" ADD CONSTRAINT "McpInvocation_coachRequestId_fkey" FOREIGN KEY ("coachRequestId") REFERENCES "CoachRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "McpInvocation" ADD CONSTRAINT "McpInvocation_idempotencyIntentId_fkey" FOREIGN KEY ("idempotencyIntentId") REFERENCES "McpIdempotencyIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "McpTrace" ADD CONSTRAINT "McpTrace_invocationId_fkey" FOREIGN KEY ("invocationId") REFERENCES "McpInvocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpTrace" ADD CONSTRAINT "McpTrace_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "McpClientAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpTrace" ADD CONSTRAINT "McpTrace_parentCoachTraceId_fkey" FOREIGN KEY ("parentCoachTraceId") REFERENCES "CoachTrace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "McpTraceStep" ADD CONSTRAINT "McpTraceStep_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "McpTrace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
