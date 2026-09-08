import {
  COACH_RESULT_SCHEMA_VERSION,
  coachResultSchema,
  createExerciseOutputSchema,
  type CoachResult,
  type CreateExerciseOutput,
} from '@en/common/coach';
import type { CoachRecommendation } from './final-result.validator';

function publicCitation(citation: {
  sourceId: string;
  materialType: 'word' | 'course' | 'grammar';
  title: string;
  locator: string | null;
  supports: string;
}) {
  return {
    sourceId: citation.sourceId,
    materialType: citation.materialType,
    title: citation.title,
    locator: citation.locator,
    supports: citation.supports,
  };
}

export function buildExerciseResult(input: {
  rawExercise: unknown;
  recommendation: CoachRecommendation;
  traceId: string;
}): CoachResult | undefined {
  const parsed = createExerciseOutputSchema.safeParse(input.rawExercise);
  if (!parsed.success || !parsed.data.ok) return undefined;
  const exercise: Extract<CreateExerciseOutput, { ok: true }> = parsed.data;
  const result = coachResultSchema.safeParse({
    schemaVersion: COACH_RESULT_SCHEMA_VERSION,
    responseType: 'exercise',
    correction: '',
    explanation: exercise.instructions,
    examples: [],
    errorTypes: [],
    score: null,
    nextAction: input.recommendation.nextAction,
    citations: exercise.citations.map(publicCitation),
    nextActionReason: input.recommendation.nextActionReason,
    traceId: input.traceId,
    exercise: {
      id: exercise.exerciseId,
      type: exercise.type,
      cefrDifficulty: exercise.difficulty,
      instructions: exercise.instructions,
      personalizationReason: exercise.personalizationReason,
      items: exercise.items.map((item) => ({
        id: item.itemId,
        position: item.position,
        prompt: item.prompt,
        choices: item.choices,
        maxScore: item.maxScore,
        citations: item.citations.map(publicCitation),
      })),
      expiresAt: exercise.expiresAt,
    },
  });
  return result.success ? result.data : undefined;
}
