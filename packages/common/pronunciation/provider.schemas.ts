import { z } from "zod";
import type { PronunciationLocale } from "./api.schemas";

export const PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION =
  "pronunciation-provider-result.v1" as const;

export const pronunciationProviderOutcomeSchema = z.enum([
  "SUCCESS",
  "UNRECOGNIZABLE",
  "TIMEOUT",
  "RATE_LIMITED",
  "CANCELLED",
  "SERVICE_ERROR",
  "INVALID_RESPONSE",
]);

export const pronunciationProviderErrorTypeSchema = z.enum([
  "NONE",
  "MISPRONUNCIATION",
  "OMISSION",
  "INSERTION",
  "UNKNOWN",
]);

const versionSchema = z.string().trim().min(1).max(128);
const scoreSchema = z.number().min(0).max(100);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

const providerBaseShape = {
  schemaVersion: z.literal(PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION),
  provider: z.string().trim().min(1).max(64),
  modelVersion: versionSchema,
  adapterVersion: versionSchema,
  apiContractVersion: versionSchema,
  capabilityVersion: versionSchema,
  providerAccepted: z.boolean().nullable(),
  providerRequestId: z.string().min(1).max(256).nullable(),
  latencyMs: z.number().int().min(0).max(30_000),
  billableDurationMs: z.number().int().min(0).max(30_000),
  cost: z.number().min(0),
  currency: currencySchema,
  priceVersion: versionSchema,
} as const;

export const pronunciationProviderWordSchema = z
  .object({
    sequence: z.number().int().min(0).max(89),
    lexicalForm: z.string().min(1).max(100),
    offsetMs: z.number().int().min(0).max(30_000).nullable(),
    durationMs: z.number().int().min(0).max(30_000).nullable(),
    score: scoreSchema.nullable(),
    errorType: pronunciationProviderErrorTypeSchema,
  })
  .strict()
  .superRefine((word, context) => {
    if ((word.offsetMs === null) !== (word.durationMs === null)) {
      context.addIssue({
        code: "custom",
        path: ["offsetMs"],
        message: "offset and duration must both be null or both be present",
      });
    }
    if (
      word.offsetMs !== null &&
      word.durationMs !== null &&
      word.offsetMs + word.durationMs > 30_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "word timestamp exceeds the short-audio limit",
      });
    }
  });

export const pronunciationProviderSuccessSchema = z
  .object({
    ...providerBaseShape,
    providerAccepted: z.literal(true),
    outcome: z.literal("SUCCESS"),
    recognizedText: z.string().max(500),
    recognitionConfidence: z.number().min(0).max(1),
    scores: z
      .object({
        overall: scoreSchema,
        accuracy: scoreSchema,
        completeness: scoreSchema,
        fluency: scoreSchema,
        prosody: scoreSchema.nullable(),
      })
      .strict(),
    words: z.array(pronunciationProviderWordSchema).max(90),
  })
  .strict();

export const pronunciationProviderFailureSchema = z
  .object({
    ...providerBaseShape,
    outcome: pronunciationProviderOutcomeSchema.exclude(["SUCCESS"]),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(86_400).nullable(),
  })
  .strict();

export const pronunciationProviderResultSchema = z.union([
  pronunciationProviderSuccessSchema,
  pronunciationProviderFailureSchema,
]);

export type PronunciationProviderAssessmentInput = Readonly<{
  assessmentId: string;
  referenceText: string;
  locale: PronunciationLocale;
  canonicalAudio: Uint8Array;
  applicationConnectionId: string;
  deadlineAt: Date;
}>;

export type PronunciationProviderWord = z.infer<
  typeof pronunciationProviderWordSchema
>;
export type PronunciationProviderSuccess = z.infer<
  typeof pronunciationProviderSuccessSchema
>;
export type PronunciationProviderFailure = z.infer<
  typeof pronunciationProviderFailureSchema
>;
export type PronunciationProviderResult = z.infer<
  typeof pronunciationProviderResultSchema
>;
