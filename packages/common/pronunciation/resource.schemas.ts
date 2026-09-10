import { z } from "zod";
import {
  pronunciationAssessmentIdSchema,
  pronunciationAssessmentStatusSchema,
  pronunciationConfidenceTierSchema,
  pronunciationDeletionScopeSchema,
  pronunciationDeletionStatusSchema,
  pronunciationExerciseTypeSchema,
  pronunciationFailureCategorySchema,
  pronunciationLearningWriteStatusSchema,
  pronunciationLocaleSchema,
  pronunciationPublicErrorCodeSchema,
} from "./api.schemas";
import { pronunciationResultSchema } from "./result.schemas";

const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const pronunciationSafeDiagnosticSchema = z
  .object({
    code: pronunciationPublicErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    recognizedText: z.string().max(500).optional(),
  })
  .strict();

export const pronunciationAssessmentResourceSchema = z
  .object({
    assessmentId: pronunciationAssessmentIdSchema,
    status: pronunciationAssessmentStatusSchema,
    exerciseType: pronunciationExerciseTypeSchema,
    locale: pronunciationLocaleSchema,
    referenceText: z.string().min(1).max(200),
    retryOfAssessmentId: pronunciationAssessmentIdSchema.nullable(),
    result: pronunciationResultSchema.nullable(),
    diagnostic: pronunciationSafeDiagnosticSchema.nullable(),
    learningWriteStatus: pronunciationLearningWriteStatusSchema,
    audio: z
      .object({
        status: z.enum([
          "MISSING",
          "VALIDATING",
          "READY",
          "INVALID",
          "REVOKED",
          "PURGING",
          "PURGED",
        ]),
        available: z.boolean(),
        expiresAt: isoDateTimeSchema.nullable(),
      })
      .strict(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    traceId: z.string().min(1).max(128),
  })
  .strict();

export const pronunciationAssessmentResponseSchema = z
  .object({
    code: z.number().int().min(200).max(299),
    data: pronunciationAssessmentResourceSchema,
  })
  .strict();

export const pronunciationAssessmentPageResponseSchema = z
  .object({
    code: z.literal(200),
    data: z
      .object({
        items: z.array(pronunciationAssessmentResourceSchema).max(50),
        nextCursor: z.string().max(512).nullable(),
      })
      .strict(),
  })
  .strict();

export const pronunciationErrorResponseSchema = z
  .object({
    code: z.number().int().min(400).max(599),
    error: z
      .object({
        code: pronunciationPublicErrorCodeSchema,
        category: pronunciationFailureCategorySchema,
        message: z.string().min(1).max(500),
        retryable: z.boolean(),
        retryAfterSeconds: z.number().int().min(1).max(86_400).nullable(),
        assessmentId: pronunciationAssessmentIdSchema.nullable(),
        traceId: z.string().min(1).max(128).nullable(),
      })
      .strict(),
  })
  .strict();

export const pronunciationDeletionResourceSchema = z
  .object({
    deletionId: z.string().min(1).max(128),
    scope: pronunciationDeletionScopeSchema,
    status: pronunciationDeletionStatusSchema,
    accessRevokedAt: isoDateTimeSchema,
    purgeDeadline: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const pronunciationDeletionResponseSchema = z
  .object({
    code: z.number().int().min(200).max(299),
    data: pronunciationDeletionResourceSchema,
  })
  .strict();

export type PronunciationAssessmentResource = z.infer<
  typeof pronunciationAssessmentResourceSchema
>;
export type PronunciationAssessmentPageResponse = z.infer<
  typeof pronunciationAssessmentPageResponseSchema
>;
export type PronunciationSafeDiagnostic = z.infer<
  typeof pronunciationSafeDiagnosticSchema
>;
export type PronunciationDeletionResource = z.infer<
  typeof pronunciationDeletionResourceSchema
>;
