import { z } from "zod";
import {
  pronunciationConfidenceTierSchema,
  pronunciationNextActionSchema,
  pronunciationWordStatusSchema,
} from "./api.schemas";

export const PRONUNCIATION_RESULT_SCHEMA_VERSION =
  "pronunciation-result.v1" as const;

const scoreSchema = z.number().min(0).max(100);
const versionSchema = z.string().trim().min(1).max(128);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const pronunciationScoresSchema = z
  .object({
    overall: scoreSchema,
    accuracy: scoreSchema,
    completeness: scoreSchema,
    fluency: scoreSchema,
    prosody: scoreSchema.nullable(),
  })
  .strict();

export const pronunciationWordAssessmentSchema = z
  .object({
    sequence: z.number().int().min(0).max(89),
    targetPosition: z.number().int().min(0).max(29).nullable(),
    word: z.string().min(1).max(100),
    normalizedWord: z.string().min(1).max(100),
    startMs: z.number().int().min(0).max(30_000).nullable(),
    endMs: z.number().int().min(0).max(30_000).nullable(),
    score: scoreSchema.nullable(),
    status: pronunciationWordStatusSchema,
    feedback: z.string().min(1).max(500).nullable(),
  })
  .strict()
  .superRefine((word, context) => {
    if ((word.startMs === null) !== (word.endMs === null)) {
      context.addIssue({
        code: "custom",
        path: ["startMs"],
        message: "startMs and endMs must both be null or both be present",
      });
    }
    if (
      word.startMs !== null &&
      word.endMs !== null &&
      word.endMs < word.startMs
    ) {
      context.addIssue({
        code: "custom",
        path: ["endMs"],
        message: "endMs must not precede startMs",
      });
    }
    if (word.status === "inserted" && word.targetPosition !== null) {
      context.addIssue({
        code: "custom",
        path: ["targetPosition"],
        message: "inserted words cannot claim a target position",
      });
    }
    if (word.status !== "inserted" && word.targetPosition === null) {
      context.addIssue({
        code: "custom",
        path: ["targetPosition"],
        message: "target words require a stable target position",
      });
    }
    if (
      word.status === "omitted" &&
      (word.startMs !== null || word.endMs !== null || word.score !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "omitted words cannot have fabricated timestamps or a score",
      });
    }
  });

export const pronunciationLearningItemChangeSchema = z
  .object({
    targetPosition: z.number().int().min(0).max(29),
    word: z.string().min(1).max(100),
    previousReviewState: z.enum(["NEW", "LEARNING", "REVIEW", "MASTERED"]),
    nextReviewState: z.enum(["NEW", "LEARNING", "REVIEW", "MASTERED"]),
    nextReviewAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const pronunciationLearningUpdateSchema = z
  .object({
    status: z.enum([
      "PROPOSED",
      "SAVED",
      "NOT_ELIGIBLE",
      "FAILED",
      "COMPENSATED",
    ]),
    changedItems: z.array(pronunciationLearningItemChangeSchema).max(30),
    message: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((update, context) => {
    if (update.status === "NOT_ELIGIBLE" && update.changedItems.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["changedItems"],
        message: "not-eligible results cannot claim learning changes",
      });
    }
  });

export const pronunciationResultVersionsSchema = z
  .object({
    providerAdapter: versionSchema,
    providerApi: versionSchema,
    normalization: versionSchema,
    alignment: versionSchema,
    assessmentRule: versionSchema,
    confidencePolicy: versionSchema,
    learningMapping: versionSchema,
    scheduler: versionSchema,
    budget: versionSchema,
    price: versionSchema,
  })
  .strict();

export const pronunciationResultSchema = z
  .object({
    schemaVersion: z.literal(PRONUNCIATION_RESULT_SCHEMA_VERSION),
    assessmentId: z.string().min(1).max(128),
    referenceText: z.string().min(1).max(200),
    recognizedText: z.string().max(500),
    scores: pronunciationScoresSchema,
    confidence: z.number().min(0).max(1),
    confidenceTier: pronunciationConfidenceTierSchema.exclude(["REJECTED"]),
    words: z.array(pronunciationWordAssessmentSchema).max(90),
    summary: z.string().min(1).max(1000),
    suggestions: z.array(z.string().min(1).max(500)).max(5),
    nextAction: pronunciationNextActionSchema,
    provider: z.string().min(1).max(64),
    modelVersion: versionSchema,
    learningUpdate: pronunciationLearningUpdateSchema,
    audio: z
      .object({
        available: z.boolean(),
        expiresAt: isoDateTimeSchema.nullable(),
      })
      .strict(),
    versions: pronunciationResultVersionsSchema,
    traceId: z.string().min(1).max(128),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.confidence < 0.6 ||
      (result.confidenceTier === "RELIABLE" && result.confidence < 0.8)
    ) {
      context.addIssue({
        code: "custom",
        path: ["confidenceTier"],
        message: "confidence tier contradicts the confidence value",
      });
    }
  });

export type PronunciationScores = z.infer<typeof pronunciationScoresSchema>;
export type PronunciationWordAssessment = z.infer<
  typeof pronunciationWordAssessmentSchema
>;
export type PronunciationLearningUpdate = z.infer<
  typeof pronunciationLearningUpdateSchema
>;
export type PronunciationResultVersions = z.infer<
  typeof pronunciationResultVersionsSchema
>;
export type PronunciationResult = z.infer<typeof pronunciationResultSchema>;
