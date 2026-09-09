import {
  COACH_RESULT_SCHEMA_VERSION,
  coachResultSchema,
  gradeAnswerOutputSchema,
  type CoachResult,
  type GradeAnswerOutput,
} from '@en/common/coach';
import type { CoachRecommendation } from './final-result.validator';
import { validateFinalResult } from './final-result.validator';
import { assembleLearningUpdate } from './coach-result.assembler';

type ValidGrade = Extract<GradeAnswerOutput, { ok: true }>;

export function parseValidatedGrade(raw: unknown): ValidGrade | undefined {
  const parsed = gradeAnswerOutputSchema.safeParse(raw);
  return parsed.success && parsed.data.ok ? parsed.data : undefined;
}

function publicCitation(
  citation: ValidGrade['citations'][number],
) {
  return {
    sourceId: citation.sourceId,
    materialType: citation.materialType,
    title: citation.title,
    locator: citation.locator,
    supports: citation.supports,
  };
}

export function buildGradingResult(input: {
  grade: ValidGrade;
  saveResult: unknown;
  recommendation: CoachRecommendation;
  traceId: string;
}): CoachResult | undefined {
  return validateFinalResult({
    schemaVersion: COACH_RESULT_SCHEMA_VERSION,
    responseType: 'grading',
    correction: input.grade.correction,
    explanation: input.grade.explanation,
    examples: input.grade.examples,
    errorTypes: input.grade.errorTypes,
    score: input.grade.score,
    nextAction: input.recommendation.nextAction,
    citations: input.grade.citations.map(publicCitation),
    nextActionReason: input.recommendation.nextActionReason,
    traceId: input.traceId,
    gradingItems: input.grade.items.map((item) => ({
      itemId: item.itemId,
      isCorrect: item.isCorrect,
      score: item.score,
      correction: item.correction,
      explanation: item.explanation,
      errorTypes: item.errorTypes,
    })),
    learningUpdate: assembleLearningUpdate(input.saveResult),
  }, {
    saveAttemptResult: input.saveResult,
  });
}
