import {
  COACH_RESULT_SCHEMA_VERSION,
  coachResultSchema,
  type CoachResult,
} from '@en/common/coach';
import {
  coachAnswerModelOutputSchema,
  type CoachAnswerModelOutput,
} from './coach-model.gateway';
import { assembleLearningUpdate } from './coach-result.assembler';

export type CoachRecommendation = Readonly<{
  nextAction: 'review' | 'practice' | 'continue';
  nextActionReason: string;
}>;

export function validateFinalResult(
  raw: unknown,
  facts: { saveAttemptResult?: unknown } = {},
): CoachResult | undefined {
  const parsed = coachResultSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  if ('saveAttemptResult' in facts) {
    if (parsed.data.responseType !== 'grading') return undefined;
    const expected = assembleLearningUpdate(facts.saveAttemptResult);
    if (
      JSON.stringify(parsed.data.learningUpdate) !== JSON.stringify(expected)
    ) {
      return undefined;
    }
  }
  return parsed.data;
}

export function parseModelAnswer(
  raw: unknown,
): CoachAnswerModelOutput | undefined {
  const result = coachAnswerModelOutputSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

export function repairModelAnswer(
  raw: unknown,
): CoachAnswerModelOutput | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  return parseModelAnswer({
    correction: record.correction,
    explanation: record.explanation,
    examples: record.examples,
    errorTypes: record.errorTypes,
    citations: record.citations,
  });
}

export function citationsAreSupported(
  answer: CoachAnswerModelOutput,
  supportedSourceIds: ReadonlySet<string>,
): boolean {
  return answer.citations.every((citation) =>
    supportedSourceIds.has(citation.sourceId),
  );
}

export function buildCoachAnswerResult(input: {
  responseType: 'answer' | 'correction';
  answer: CoachAnswerModelOutput;
  recommendation: CoachRecommendation;
  traceId: string;
}): CoachResult | undefined {
  return validateFinalResult({
    schemaVersion: COACH_RESULT_SCHEMA_VERSION,
    responseType: input.responseType,
    correction: input.answer.correction,
    explanation: input.answer.explanation,
    examples: input.answer.examples,
    errorTypes: input.answer.errorTypes,
    score: null,
    nextAction: input.recommendation.nextAction,
    citations: input.answer.citations,
    nextActionReason: input.recommendation.nextActionReason,
    traceId: input.traceId,
  });
}

export function buildSafeDegradedResult(traceId: string): CoachResult {
  return coachResultSchema.parse({
    schemaVersion: COACH_RESULT_SCHEMA_VERSION,
    responseType: 'degraded',
    correction: '',
    explanation: 'AI Coach 暂时无法生成可靠结果，请稍后安全重试。',
    examples: [],
    errorTypes: [],
    score: null,
    nextAction: 'continue',
    citations: [],
    nextActionReason: '本次没有更新学习记录，可以稍后重新提交原请求。',
    traceId,
  });
}
