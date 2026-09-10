import {
  pronunciationAssessmentPageResponseSchema,
  pronunciationAssessmentResponseSchema,
  pronunciationAssessmentResourceSchema,
  pronunciationErrorResponseSchema,
  type CreatePronunciationAssessment,
  type PronunciationAssessmentPageResponse,
  type PronunciationAssessmentResource,
  type PronunciationResult,
} from "@en/common/pronunciation";

export type {
  CreatePronunciationAssessment,
  PronunciationAssessmentPageResponse,
  PronunciationAssessmentResource,
  PronunciationResult,
};

export type PronunciationAssessmentResponse = Readonly<{
  code: number;
  data: PronunciationAssessmentResource;
}>;

export type PronunciationErrorResponse = Readonly<{
  code: number;
  error: {
    code: string;
    category: string;
    message: string;
    retryable: boolean;
    retryAfterSeconds: number | null;
    assessmentId: string | null;
    traceId: string | null;
  };
}>;

export function parsePronunciationAssessmentResponse(
  value: unknown,
): PronunciationAssessmentResponse {
  return pronunciationAssessmentResponseSchema.parse(value);
}

export function parsePronunciationAssessmentPageResponse(
  value: unknown,
): PronunciationAssessmentPageResponse {
  return pronunciationAssessmentPageResponseSchema.parse(value);
}

export function parsePronunciationAssessmentResource(
  value: unknown,
): PronunciationAssessmentResource {
  return pronunciationAssessmentResourceSchema.parse(value);
}

export function parsePronunciationErrorResponse(
  value: unknown,
): PronunciationErrorResponse {
  return pronunciationErrorResponseSchema.parse(value);
}
