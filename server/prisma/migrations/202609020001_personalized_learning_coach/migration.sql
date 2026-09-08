-- Additive schema for the personalized learning Coach. This migration does not
-- alter the meaning or values of legacy User/WordBookRecord fields.

CREATE TYPE "CefrLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');
CREATE TYPE "LearnerLevelSource" AS ENUM ('USER_DECLARED');
CREATE TYPE "LearnerGoalType" AS ENUM ('GENERAL', 'EXAM', 'BUSINESS', 'TRAVEL', 'CUSTOM');
CREATE TYPE "LearningTargetType" AS ENUM ('WORD', 'ERROR_TYPE');
CREATE TYPE "LearningReviewState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'MASTERED');
CREATE TYPE "CoachConversationStatus" AS ENUM ('ACTIVE', 'DELETING', 'DELETED', 'EXPIRED');
CREATE TYPE "CoachMessageRole" AS ENUM ('USER', 'COACH');
CREATE TYPE "CoachRequestInputType" AS ENUM ('MESSAGE', 'EXERCISE_SUBMISSION', 'RECOMMENDATION');
CREATE TYPE "CoachIntent" AS ENUM ('ANSWER', 'CORRECTION', 'CREATE_EXERCISE', 'GRADE_ANSWER', 'REVIEW_RECOMMENDATION', 'UNKNOWN');
CREATE TYPE "CoachRequestStatus" AS ENUM ('CREATED', 'QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'TIMED_OUT', 'BUDGET_EXCEEDED', 'FAILED');
CREATE TYPE "CoachResponseType" AS ENUM ('ANSWER', 'CORRECTION', 'EXERCISE', 'GRADING', 'RECOMMENDATION', 'DEGRADED');
CREATE TYPE "CoachErrorCode" AS ENUM ('AUTH_REQUIRED', 'TOKEN_INVALID', 'FORBIDDEN', 'RESOURCE_NOT_FOUND', 'VALIDATION_FAILED', 'SCHEMA_INVALID', 'MATERIAL_NOT_AVAILABLE', 'MODEL_UNAVAILABLE', 'TOOL_TIMEOUT', 'REQUEST_TIMEOUT', 'BUDGET_EXCEEDED', 'RATE_LIMITED', 'IDEMPOTENCY_CONFLICT', 'STATE_CONFLICT', 'CANCELLED', 'INTERNAL_ERROR');
CREATE TYPE "ExerciseType" AS ENUM ('MULTIPLE_CHOICE', 'FILL_BLANK', 'TRANSLATION', 'SITUATIONAL_DIALOGUE');
CREATE TYPE "ExerciseDifficulty" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'UNKNOWN');
CREATE TYPE "ExerciseStatus" AS ENUM ('DRAFT', 'READY', 'SUBMITTED', 'GRADED', 'SAVED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "ExerciseSubmissionStatus" AS ENUM ('RECEIVED', 'GRADING', 'GRADED_VALID', 'GRADING_FAILED', 'SAVED');
CREATE TYPE "CoachStepName" AS ENUM ('CLASSIFY_INTENT', 'GET_LEARNER_PROFILE', 'GET_DUE_WORDS', 'SEARCH_LEARNING_MATERIALS', 'CREATE_EXERCISE', 'GRADE_ANSWER', 'SAVE_ATTEMPT', 'GENERATE_ANSWER', 'RECOMMEND', 'VALIDATE_RESULT', 'FINALIZE');
CREATE TYPE "CoachToolName" AS ENUM ('GET_LEARNER_PROFILE', 'GET_DUE_WORDS', 'SEARCH_LEARNING_MATERIALS', 'CREATE_EXERCISE', 'GRADE_ANSWER', 'SAVE_ATTEMPT');
CREATE TYPE "CoachStepStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED', 'TIMED_OUT');
CREATE TYPE "CoachFeedbackRating" AS ENUM ('UP', 'DOWN');
CREATE TYPE "CoachFeedbackCategory" AS ENUM ('INCORRECT', 'TOO_HARD', 'TOO_EASY', 'IRRELEVANT', 'UNSAFE', 'OTHER');
CREATE TYPE "CoachDeletionScope" AS ENUM ('CONVERSATION', 'COACH_DATA');
CREATE TYPE "CoachDeletionStatus" AS ENUM ('ACCEPTED', 'PURGING', 'COMPLETED');

CREATE TABLE "LearnerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cefrLevel" "CefrLevel",
    "levelSource" "LearnerLevelSource",
    "goalType" "LearnerGoalType",
    "goalText" VARCHAR(500),
    "activeCourseId" TEXT,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearnerProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LearnerProfile_level_source_check" CHECK (
      ("cefrLevel" IS NULL AND "levelSource" IS NULL) OR
      ("cefrLevel" IS NOT NULL AND "levelSource" IS NOT NULL)
    )
);

CREATE TABLE "LearningItemState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" "LearningTargetType" NOT NULL,
    "targetKey" VARCHAR(128) NOT NULL,
    "wordId" TEXT,
    "reviewState" "LearningReviewState" NOT NULL DEFAULT 'NEW',
    "repetitionCount" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" DECIMAL(4,2) NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "lastQuality" INTEGER,
    "lastAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearningItemState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LearningItemState_repetition_check" CHECK ("repetitionCount" >= 0),
    CONSTRAINT "LearningItemState_ease_check" CHECK ("easeFactor" >= 1.3),
    CONSTRAINT "LearningItemState_interval_check" CHECK ("intervalDays" >= 0),
    CONSTRAINT "LearningItemState_quality_check" CHECK ("lastQuality" IS NULL OR "lastQuality" BETWEEN 0 AND 5),
    CONSTRAINT "LearningItemState_target_check" CHECK (
      ("targetType" = 'WORD' AND "wordId" IS NOT NULL AND "targetKey" = "wordId") OR
      ("targetType" = 'ERROR_TYPE' AND "wordId" IS NULL)
    )
);

CREATE TABLE "LearningReviewEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemStateId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "targetType" "LearningTargetType" NOT NULL,
    "targetKey" VARCHAR(128) NOT NULL,
    "itemScore" INTEGER NOT NULL,
    "quality" INTEGER NOT NULL,
    "previousState" JSONB NOT NULL,
    "nextState" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearningReviewEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LearningReviewEvent_score_check" CHECK ("itemScore" BETWEEN 0 AND 100),
    CONSTRAINT "LearningReviewEvent_quality_check" CHECK ("quality" BETWEEN 0 AND 5)
);

CREATE TABLE "CoachConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(120),
    "status" "CoachConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "checkpointThreadId" VARCHAR(128) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoachConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoachMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "requestId" TEXT,
    "role" "CoachMessageRole" NOT NULL,
    "content" TEXT,
    "resultSchemaVersion" VARCHAR(64),
    "structuredResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoachMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoachMessage_result_version_check" CHECK (
      ("structuredResult" IS NULL AND "resultSchemaVersion" IS NULL) OR
      ("structuredResult" IS NOT NULL AND "resultSchemaVersion" IS NOT NULL)
    )
);

CREATE TABLE "CoachRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "clientRequestKey" VARCHAR(128) NOT NULL,
    "requestBodyHash" VARCHAR(128) NOT NULL,
    "inputPayload" JSONB NOT NULL,
    "retryOfRequestId" TEXT,
    "inputType" "CoachRequestInputType" NOT NULL,
    "intent" "CoachIntent",
    "status" "CoachRequestStatus" NOT NULL DEFAULT 'CREATED',
    "exerciseId" TEXT,
    "answerVersion" VARCHAR(128),
    "promptVersion" VARCHAR(128),
    "modelVersion" VARCHAR(128),
    "budgetVersion" VARCHAR(128),
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "finalResultSchemaVersion" VARCHAR(64),
    "finalResult" JSONB,
    "errorCode" "CoachErrorCode",
    "cancelRequestedAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "firstTokenAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoachRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoachRequest_result_version_check" CHECK (
      ("finalResult" IS NULL AND "finalResultSchemaVersion" IS NULL) OR
      ("finalResult" IS NOT NULL AND "finalResultSchemaVersion" IS NOT NULL)
    )
);

CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" "ExerciseType" NOT NULL,
    "status" "ExerciseStatus" NOT NULL DEFAULT 'DRAFT',
    "cefrDifficulty" "ExerciseDifficulty" NOT NULL,
    "instructions" VARCHAR(2000) NOT NULL,
    "personalizationReason" VARCHAR(2000) NOT NULL,
    "schemaVersion" VARCHAR(64) NOT NULL,
    "citations" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExerciseItem" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "choices" JSONB,
    "answerKey" JSONB NOT NULL,
    "gradingRubric" JSONB NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "citations" JSONB NOT NULL,
    CONSTRAINT "ExerciseItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExerciseItem_position_check" CHECK ("position" > 0),
    CONSTRAINT "ExerciseItem_max_score_check" CHECK ("maxScore" > 0)
);

CREATE TABLE "ExerciseItemTarget" (
    "exerciseItemId" TEXT NOT NULL,
    "targetType" "LearningTargetType" NOT NULL,
    "targetKey" VARCHAR(128) NOT NULL,
    "wordId" TEXT,
    "weight" DECIMAL(5,4) NOT NULL,
    CONSTRAINT "ExerciseItemTarget_pkey" PRIMARY KEY ("exerciseItemId", "targetType", "targetKey"),
    CONSTRAINT "ExerciseItemTarget_weight_check" CHECK ("weight" > 0 AND "weight" <= 1),
    CONSTRAINT "ExerciseItemTarget_target_check" CHECK (
      ("targetType" = 'WORD' AND "wordId" IS NOT NULL AND "targetKey" = "wordId") OR
      ("targetType" = 'ERROR_TYPE' AND "wordId" IS NULL)
    )
);

CREATE TABLE "ExerciseSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "gradeRequestId" TEXT NOT NULL,
    "answerVersion" VARCHAR(128) NOT NULL,
    "clientIdempotencyKey" VARCHAR(128) NOT NULL,
    "answers" JSONB NOT NULL,
    "status" "ExerciseSubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
    "score" INTEGER,
    "gradingHash" VARCHAR(128),
    "resultSchemaVersion" VARCHAR(64),
    "gradingResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExerciseSubmission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExerciseSubmission_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100),
    CONSTRAINT "ExerciseSubmission_valid_grade_check" CHECK (
      "status" NOT IN ('GRADED_VALID', 'SAVED') OR
      ("score" IS NOT NULL AND "gradingHash" IS NOT NULL AND "resultSchemaVersion" IS NOT NULL AND "gradingResult" IS NOT NULL)
    )
);

CREATE TABLE "ExerciseSubmissionItem" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "exerciseItemId" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "isCorrect" BOOLEAN,
    "score" INTEGER,
    "correction" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "errorTypes" JSONB NOT NULL,
    "targetQualities" JSONB NOT NULL,
    CONSTRAINT "ExerciseSubmissionItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExerciseSubmissionItem_score_check" CHECK ("score" IS NULL OR "score" >= 0)
);

CREATE TABLE "LearningAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "saveRequestId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "errorTypes" JSONB NOT NULL,
    "gradingHash" VARCHAR(128) NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearningAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LearningAttempt_score_check" CHECK ("score" BETWEEN 0 AND 100)
);

CREATE TABLE "TraceSubjectMapping" (
    "traceSubjectId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TraceSubjectMapping_pkey" PRIMARY KEY ("traceSubjectId")
);

CREATE TABLE "CoachTrace" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "traceSubjectId" TEXT NOT NULL,
    "promptVersion" VARCHAR(128) NOT NULL,
    "promptHash" VARCHAR(128) NOT NULL,
    "modelProvider" VARCHAR(64) NOT NULL,
    "modelName" VARCHAR(128) NOT NULL,
    "modelVersion" VARCHAR(128) NOT NULL,
    "resultSchemaVersion" VARCHAR(64) NOT NULL,
    "budgetVersion" VARCHAR(128) NOT NULL,
    "ttftMs" INTEGER,
    "totalDurationMs" INTEGER,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "currency" VARCHAR(8) NOT NULL,
    "schemaFailureCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "terminalStatus" "CoachRequestStatus" NOT NULL,
    "resultType" "CoachResponseType",
    "recommendation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoachTrace_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoachTrace_metrics_check" CHECK (
      ("ttftMs" IS NULL OR "ttftMs" >= 0) AND
      ("totalDurationMs" IS NULL OR "totalDurationMs" >= 0) AND
      "inputTokens" >= 0 AND "outputTokens" >= 0 AND
      "estimatedCost" >= 0 AND "schemaFailureCount" >= 0 AND "retryCount" >= 0
    ),
    CONSTRAINT "CoachTrace_terminal_status_check" CHECK (
      "terminalStatus" IN ('COMPLETED', 'CANCELLED', 'TIMED_OUT', 'BUDGET_EXCEEDED', 'FAILED')
    )
);

CREATE TABLE "CoachStepTrace" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stepName" "CoachStepName" NOT NULL,
    "toolName" "CoachToolName",
    "status" "CoachStepStatus" NOT NULL,
    "durationMs" INTEGER,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "schemaFailureCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" "CoachErrorCode",
    "redactedMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoachStepTrace_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoachStepTrace_metrics_check" CHECK (
      "sequence" >= 0 AND ("durationMs" IS NULL OR "durationMs" >= 0) AND
      "inputTokens" >= 0 AND "outputTokens" >= 0 AND
      "schemaFailureCount" >= 0 AND "retryCount" >= 0
    )
);

CREATE TABLE "CoachFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "clientIdempotencyKey" VARCHAR(128) NOT NULL,
    "requestBodyHash" VARCHAR(128) NOT NULL,
    "rating" "CoachFeedbackRating" NOT NULL,
    "category" "CoachFeedbackCategory",
    "comment" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoachFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoachDeletionTombstone" (
    "id" TEXT NOT NULL,
    "subjectHash" VARCHAR(128) NOT NULL,
    "resourceHash" VARCHAR(128) NOT NULL,
    "scope" "CoachDeletionScope" NOT NULL,
    "status" "CoachDeletionStatus" NOT NULL DEFAULT 'ACCEPTED',
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL,
    "purgeDeadline" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoachDeletionTombstone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearnerProfile_userId_key" ON "LearnerProfile"("userId");
CREATE INDEX "LearnerProfile_activeCourseId_idx" ON "LearnerProfile"("activeCourseId");
CREATE INDEX "LearningItemState_userId_targetType_dueAt_idx" ON "LearningItemState"("userId", "targetType", "dueAt");
CREATE INDEX "LearningItemState_wordId_idx" ON "LearningItemState"("wordId");
CREATE UNIQUE INDEX "LearningItemState_userId_targetType_targetKey_key" ON "LearningItemState"("userId", "targetType", "targetKey");
CREATE INDEX "LearningReviewEvent_userId_createdAt_idx" ON "LearningReviewEvent"("userId", "createdAt");
CREATE INDEX "LearningReviewEvent_itemStateId_createdAt_idx" ON "LearningReviewEvent"("itemStateId", "createdAt");
CREATE UNIQUE INDEX "LearningReviewEvent_attemptId_targetType_targetKey_key" ON "LearningReviewEvent"("attemptId", "targetType", "targetKey");
CREATE UNIQUE INDEX "CoachConversation_checkpointThreadId_key" ON "CoachConversation"("checkpointThreadId");
CREATE INDEX "CoachConversation_userId_status_lastActivityAt_idx" ON "CoachConversation"("userId", "status", "lastActivityAt");
CREATE INDEX "CoachMessage_conversationId_createdAt_id_idx" ON "CoachMessage"("conversationId", "createdAt", "id");
CREATE INDEX "CoachMessage_requestId_idx" ON "CoachMessage"("requestId");
CREATE INDEX "CoachRequest_conversationId_status_createdAt_idx" ON "CoachRequest"("conversationId", "status", "createdAt");
CREATE INDEX "CoachRequest_retryOfRequestId_idx" ON "CoachRequest"("retryOfRequestId");
CREATE INDEX "CoachRequest_exerciseId_idx" ON "CoachRequest"("exerciseId");
CREATE UNIQUE INDEX "CoachRequest_userId_clientRequestKey_key" ON "CoachRequest"("userId", "clientRequestKey");
CREATE UNIQUE INDEX "CoachRequest_one_active_per_conversation_key" ON "CoachRequest"("conversationId") WHERE "status" IN ('CREATED', 'QUEUED', 'RUNNING');
CREATE UNIQUE INDEX "Exercise_requestId_key" ON "Exercise"("requestId");
CREATE INDEX "Exercise_userId_status_createdAt_idx" ON "Exercise"("userId", "status", "createdAt");
CREATE INDEX "Exercise_conversationId_idx" ON "Exercise"("conversationId");
CREATE UNIQUE INDEX "ExerciseItem_exerciseId_position_key" ON "ExerciseItem"("exerciseId", "position");
CREATE INDEX "ExerciseItemTarget_wordId_idx" ON "ExerciseItemTarget"("wordId");
CREATE UNIQUE INDEX "ExerciseSubmission_gradeRequestId_key" ON "ExerciseSubmission"("gradeRequestId");
CREATE INDEX "ExerciseSubmission_exerciseId_status_idx" ON "ExerciseSubmission"("exerciseId", "status");
CREATE UNIQUE INDEX "ExerciseSubmission_userId_exerciseId_answerVersion_key" ON "ExerciseSubmission"("userId", "exerciseId", "answerVersion");
CREATE UNIQUE INDEX "ExerciseSubmission_userId_clientIdempotencyKey_key" ON "ExerciseSubmission"("userId", "clientIdempotencyKey");
CREATE INDEX "ExerciseSubmissionItem_exerciseItemId_idx" ON "ExerciseSubmissionItem"("exerciseItemId");
CREATE UNIQUE INDEX "ExerciseSubmissionItem_submissionId_exerciseItemId_key" ON "ExerciseSubmissionItem"("submissionId", "exerciseItemId");
CREATE UNIQUE INDEX "LearningAttempt_submissionId_key" ON "LearningAttempt"("submissionId");
CREATE UNIQUE INDEX "LearningAttempt_saveRequestId_key" ON "LearningAttempt"("saveRequestId");
CREATE INDEX "LearningAttempt_userId_savedAt_idx" ON "LearningAttempt"("userId", "savedAt");
CREATE UNIQUE INDEX "LearningAttempt_userId_exerciseId_submissionId_key" ON "LearningAttempt"("userId", "exerciseId", "submissionId");
CREATE UNIQUE INDEX "TraceSubjectMapping_userId_key" ON "TraceSubjectMapping"("userId");
CREATE UNIQUE INDEX "CoachTrace_requestId_key" ON "CoachTrace"("requestId");
CREATE INDEX "CoachTrace_traceSubjectId_createdAt_idx" ON "CoachTrace"("traceSubjectId", "createdAt");
CREATE INDEX "CoachTrace_expiresAt_idx" ON "CoachTrace"("expiresAt");
CREATE UNIQUE INDEX "CoachStepTrace_traceId_sequence_key" ON "CoachStepTrace"("traceId", "sequence");
CREATE INDEX "CoachFeedback_expiresAt_idx" ON "CoachFeedback"("expiresAt");
CREATE UNIQUE INDEX "CoachFeedback_userId_requestId_key" ON "CoachFeedback"("userId", "requestId");
CREATE UNIQUE INDEX "CoachFeedback_userId_clientIdempotencyKey_key" ON "CoachFeedback"("userId", "clientIdempotencyKey");
CREATE UNIQUE INDEX "CoachDeletionTombstone_subjectHash_scope_resourceHash_key" ON "CoachDeletionTombstone"("subjectHash", "scope", "resourceHash");
CREATE INDEX "CoachDeletionTombstone_status_purgeDeadline_idx" ON "CoachDeletionTombstone"("status", "purgeDeadline");
CREATE INDEX "CoachDeletionTombstone_expiresAt_idx" ON "CoachDeletionTombstone"("expiresAt");

ALTER TABLE "LearnerProfile" ADD CONSTRAINT "LearnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearnerProfile" ADD CONSTRAINT "LearnerProfile_activeCourseId_fkey" FOREIGN KEY ("activeCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningItemState" ADD CONSTRAINT "LearningItemState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningItemState" ADD CONSTRAINT "LearningItemState_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "WordBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningItemState" ADD CONSTRAINT "LearningItemState_lastAttemptId_fkey" FOREIGN KEY ("lastAttemptId") REFERENCES "LearningAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningReviewEvent" ADD CONSTRAINT "LearningReviewEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningReviewEvent" ADD CONSTRAINT "LearningReviewEvent_itemStateId_fkey" FOREIGN KEY ("itemStateId") REFERENCES "LearningItemState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningReviewEvent" ADD CONSTRAINT "LearningReviewEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "LearningAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachConversation" ADD CONSTRAINT "CoachConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachMessage" ADD CONSTRAINT "CoachMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CoachConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachMessage" ADD CONSTRAINT "CoachMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CoachRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoachRequest" ADD CONSTRAINT "CoachRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachRequest" ADD CONSTRAINT "CoachRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CoachConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachRequest" ADD CONSTRAINT "CoachRequest_retryOfRequestId_fkey" FOREIGN KEY ("retryOfRequestId") REFERENCES "CoachRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoachRequest" ADD CONSTRAINT "CoachRequest_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CoachConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CoachRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseItem" ADD CONSTRAINT "ExerciseItem_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseItemTarget" ADD CONSTRAINT "ExerciseItemTarget_exerciseItemId_fkey" FOREIGN KEY ("exerciseItemId") REFERENCES "ExerciseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseItemTarget" ADD CONSTRAINT "ExerciseItemTarget_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "WordBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseSubmission" ADD CONSTRAINT "ExerciseSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseSubmission" ADD CONSTRAINT "ExerciseSubmission_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseSubmission" ADD CONSTRAINT "ExerciseSubmission_gradeRequestId_fkey" FOREIGN KEY ("gradeRequestId") REFERENCES "CoachRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseSubmissionItem" ADD CONSTRAINT "ExerciseSubmissionItem_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ExerciseSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseSubmissionItem" ADD CONSTRAINT "ExerciseSubmissionItem_exerciseItemId_fkey" FOREIGN KEY ("exerciseItemId") REFERENCES "ExerciseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningAttempt" ADD CONSTRAINT "LearningAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningAttempt" ADD CONSTRAINT "LearningAttempt_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningAttempt" ADD CONSTRAINT "LearningAttempt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ExerciseSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningAttempt" ADD CONSTRAINT "LearningAttempt_saveRequestId_fkey" FOREIGN KEY ("saveRequestId") REFERENCES "CoachRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TraceSubjectMapping" ADD CONSTRAINT "TraceSubjectMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachTrace" ADD CONSTRAINT "CoachTrace_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CoachRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachTrace" ADD CONSTRAINT "CoachTrace_traceSubjectId_fkey" FOREIGN KEY ("traceSubjectId") REFERENCES "TraceSubjectMapping"("traceSubjectId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoachStepTrace" ADD CONSTRAINT "CoachStepTrace_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "CoachTrace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachFeedback" ADD CONSTRAINT "CoachFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachFeedback" ADD CONSTRAINT "CoachFeedback_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CoachRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
