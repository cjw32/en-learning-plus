import { z } from "zod";

export const PRONUNCIATION_API_SCHEMA_VERSION = "pronunciation.api.v1" as const;

export const pronunciationLocaleSchema = z.enum(["en-US", "en-GB"]);

export const pronunciationAssessmentStatusSchema = z.enum([
  "CREATED",
  "AUDIO_VALIDATING",
  "AUDIO_READY",
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "REFERENCE_ONLY",
  "UNRECOGNIZABLE",
  "REJECTED",
  "CANCELLED",
  "TIMED_OUT",
  "FAILED",
  "DELETING",
  "DELETED",
]);

export const pronunciationExerciseTypeSchema = z.enum([
  "WORD",
  "PHRASE",
  "SENTENCE",
]);

export const pronunciationTargetSourceSchema = z.enum([
  "MANUAL",
  "WORD_BOOK",
  "COURSE_WORD",
  "RAG_CITATION",
  "COACH_EXERCISE",
]);

export const pronunciationConfidenceTierSchema = z.enum([
  "RELIABLE",
  "REFERENCE_ONLY",
  "REJECTED",
]);

export const pronunciationWordStatusSchema = z.enum([
  "correct",
  "mispronounced",
  "omitted",
  "inserted",
  "uncertain",
]);

export const pronunciationAudioStatusSchema = z.enum([
  "MISSING",
  "UPLOADING",
  "QUARANTINED",
  "VALIDATING",
  "READY",
  "INVALID",
  "REVOKED",
  "PURGING",
  "PURGED",
]);

export const pronunciationLearningWriteStatusSchema = z.enum([
  "NOT_ELIGIBLE",
  "PENDING",
  "SAVED",
  "FAILED",
  "COMPENSATING",
  "COMPENSATED",
]);

export type PronunciationLearningWriteStatus = z.infer<typeof pronunciationLearningWriteStatusSchema>;

export const pronunciationNextActionSchema = z.enum([
  "retry",
  "review",
  "continue",
]);

export const pronunciationDeletionScopeSchema = z.enum([
  "PRONUNCIATION_AUDIO",
  "PRONUNCIATION_ASSESSMENT",
]);

export const pronunciationDeletionStatusSchema = z.enum([
  "ACCEPTED",
  "COMPENSATING",
  "PURGING",
  "COMPLETED",
  "FAILED",
]);

export const pronunciationPublicErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "TOKEN_INVALID",
  "RESOURCE_NOT_FOUND",
  "VALIDATION_FAILED",
  "IDEMPOTENCY_CONFLICT",
  "STATE_CONFLICT",
  "RATE_LIMITED",
  "CONCURRENCY_LIMITED",
  "AUDIO_TOO_SHORT",
  "AUDIO_TOO_LONG",
  "AUDIO_TOO_LARGE",
  "AUDIO_UNSUPPORTED",
  "AUDIO_INVALID",
  "AUDIO_SILENT",
  "AUDIO_LOW_VOLUME",
  "SPEECH_UNRECOGNIZABLE",
  "SOURCE_UNAVAILABLE",
  "FEATURE_DISABLED",
  "PROVIDER_NOT_APPROVED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "STORAGE_NOT_APPROVED",
  "PRICE_UNKNOWN",
  "BUDGET_NOT_APPROVED",
  "BUDGET_EXCEEDED",
  "REQUEST_TIMEOUT",
  "CANCELLED",
  "LEARNING_WRITE_FAILED",
  "INTERNAL_ERROR",
]);

export const pronunciationFailureCategorySchema = z.enum([
  "AUTH",
  "TARGET",
  "UPLOAD",
  "AUDIO",
  "GOVERNANCE",
  "PROVIDER",
  "LEARNING",
]);

export const pronunciationAssessmentIdSchema = z.string().min(1).max(128);
export const pronunciationIdempotencyKeySchema = z.string().min(16).max(128);

const sourceIdSchema = z.string().min(1).max(128);

export const manualPronunciationTargetSchema = z
  .object({
    sourceType: z.literal("MANUAL"),
    text: z.string().trim().min(1).max(200),
  })
  .strict();

export const wordBookPronunciationTargetSchema = z
  .object({
    sourceType: z.literal("WORD_BOOK"),
    wordId: sourceIdSchema,
  })
  .strict();

export const courseWordPronunciationTargetSchema = z
  .object({
    sourceType: z.literal("COURSE_WORD"),
    courseId: sourceIdSchema,
    wordId: sourceIdSchema,
  })
  .strict();

export const ragCitationPronunciationTargetSchema = z
  .object({
    sourceType: z.literal("RAG_CITATION"),
    citationId: sourceIdSchema,
    selection: z
      .object({
        start: z.number().int().min(0).max(2000),
        end: z.number().int().min(1).max(2000),
      })
      .strict()
      .refine((selection) => selection.end > selection.start, {
        message: "selection end must be greater than start",
      }),
  })
  .strict();

export const coachExercisePronunciationTargetSchema = z
  .object({
    sourceType: z.literal("COACH_EXERCISE"),
    coachRequestId: sourceIdSchema,
    exerciseId: sourceIdSchema,
    itemId: sourceIdSchema,
  })
  .strict();

export const pronunciationTargetInputSchema = z.discriminatedUnion(
  "sourceType",
  [
    manualPronunciationTargetSchema,
    wordBookPronunciationTargetSchema,
    courseWordPronunciationTargetSchema,
    ragCitationPronunciationTargetSchema,
    coachExercisePronunciationTargetSchema,
  ],
);

export const createPronunciationAssessmentSchema = z
  .object({
    locale: pronunciationLocaleSchema,
    target: pronunciationTargetInputSchema,
  })
  .strict();

export type PronunciationLocale = z.infer<typeof pronunciationLocaleSchema>;
export type PronunciationAssessmentStatus = z.infer<
  typeof pronunciationAssessmentStatusSchema
>;
export type PronunciationExerciseType = z.infer<
  typeof pronunciationExerciseTypeSchema
>;
export type PronunciationTargetSource = z.infer<
  typeof pronunciationTargetSourceSchema
>;
export type PronunciationConfidenceTier = z.infer<
  typeof pronunciationConfidenceTierSchema
>;
export type PronunciationNextAction = z.infer<
  typeof pronunciationNextActionSchema
>;
export type PronunciationTargetInput = z.infer<
  typeof pronunciationTargetInputSchema
>;
export type CreatePronunciationAssessment = z.infer<
  typeof createPronunciationAssessmentSchema
>;
export type PronunciationPublicErrorCode = z.infer<
  typeof pronunciationPublicErrorCodeSchema
>;
export type PronunciationFailureCategory = z.infer<
  typeof pronunciationFailureCategorySchema
>;

export const pronunciationCapabilitiesSchema = z.object({
  available: z.boolean(),
  reason: z.enum(["FEATURE_DISABLED", "SERVICE_UNAVAILABLE"]).nullable(),
  locales: z.array(pronunciationLocaleSchema),
  sources: z.array(pronunciationTargetSourceSchema),
  learningWrite: z.boolean(),
  coachSummary: z.boolean(),
  maxDurationMs: z.number().int().positive(),
  maxBytes: z.number().int().positive(),
  maxWords: z.number().int().positive(),
  maxCharacters: z.number().int().positive(),
}).strict();
export type PronunciationCapabilities = z.infer<typeof pronunciationCapabilitiesSchema>;
