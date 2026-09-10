import {
  COACH_RESULT_SCHEMA_VERSION,
  COACH_RESULT_V2_SCHEMA_VERSION,
  coachResultSchema,
  publicCoachResultV2Schema,
  type CoachResult,
  type PublicCoachResultV2,
} from '@en/common/coach';
import {
  coachAnswerModelOutputSchema,
  type CoachAnswerModelOutput,
  type GroundedCoachAnswerModelOutput,
} from './coach-model.gateway';
import type { CoachRagEvidence } from './answer.nodes';
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

type GroundedClaim = Readonly<{
  claimId: string;
  resultPath: string;
  text: string;
  citationIds: readonly string[];
}>;

type GroundedAnswer = Readonly<{
  explanation: string;
  examples: readonly string[];
  citations: readonly Readonly<{ citationId: string; status: string }>[];
  groundedClaims: readonly GroundedClaim[];
  knowledgeStatus?: string;
  [key: string]: unknown;
}>;

function valueAtGroundedPath(
  answer: GroundedAnswer,
  path: string,
): string | null {
  if (path === '/explanation') return answer.explanation;
  const example = /^\/examples\/([0-7])$/.exec(path);
  if (example) return answer.examples[Number(example[1])] ?? null;
  return null;
}

export function validateGroundedClaims(
  answer: GroundedAnswer,
  issuedCitationIds: ReadonlySet<string>,
): boolean {
  if (answer.groundedClaims.length === 0) return false;
  const active = new Set(
    answer.citations
      .filter(
        (citation) =>
          citation.status === 'active' &&
          issuedCitationIds.has(citation.citationId),
      )
      .map((citation) => citation.citationId),
  );
  if (active.size !== answer.citations.length) return false;
  return answer.groundedClaims.every((claim) => {
    const value = valueAtGroundedPath(answer, claim.resultPath);
    return (
      /^claim_[A-Za-z0-9_-]{8,48}$/.test(claim.claimId) &&
      Boolean(value && claim.text && value.includes(claim.text)) &&
      claim.citationIds.length >= 1 &&
      claim.citationIds.length <= 5 &&
      new Set(claim.citationIds).size === claim.citationIds.length &&
      claim.citationIds.every((citationId) => active.has(citationId))
    );
  });
}

export function repairGroundedClaims<T extends GroundedAnswer>(
  answer: T,
  issuedCitationIds: ReadonlySet<string>,
): T & {
  citations: readonly GroundedAnswer['citations'][number][];
  groundedClaims: readonly GroundedClaim[];
  knowledgeStatus: string;
} {
  const citations = answer.citations.filter(
    (citation) =>
      citation.status === 'active' &&
      issuedCitationIds.has(citation.citationId),
  );
  const active = new Set(citations.map((citation) => citation.citationId));
  const groundedClaims = answer.groundedClaims.filter((claim) => {
    const value = valueAtGroundedPath(answer, claim.resultPath);
    return (
      Boolean(value && claim.text && value.includes(claim.text)) &&
      claim.citationIds.length > 0 &&
      claim.citationIds.every((citationId) => active.has(citationId))
    );
  });
  const usedIds = new Set(groundedClaims.flatMap((claim) => claim.citationIds));
  const usedCitations = citations.filter((citation) =>
    usedIds.has(citation.citationId),
  );
  return {
    ...answer,
    citations: usedCitations,
    groundedClaims,
    knowledgeStatus:
      groundedClaims.length > 0 && usedCitations.length > 0
        ? 'grounded'
        : 'insufficient',
  };
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

function citationLocator(
  citation: CoachRagEvidence['citations'][number],
): { kind: 'word' | 'course'; id: string } | null {
  if (citation.wordId && /^[A-Za-z0-9_-]+$/.test(citation.wordId)) {
    return { kind: 'word', id: citation.wordId };
  }
  if (citation.courseId && /^[A-Za-z0-9_-]+$/.test(citation.courseId)) {
    return { kind: 'course', id: citation.courseId };
  }
  return null;
}

export function buildCoachGroundedAnswerResult(input: {
  responseType: 'answer' | 'correction';
  answer: GroundedCoachAnswerModelOutput;
  evidence: CoachRagEvidence;
  recommendation: CoachRecommendation;
  traceId: string;
}): PublicCoachResultV2 | undefined {
  const used = new Set(
    input.answer.groundedClaims.flatMap((claim) => claim.citationIds),
  );
  const citations = input.evidence.citations
    .filter(
      (citation) =>
        citation.status === 'active' &&
        citation.usage === 'answer_evidence' &&
        used.has(citation.citationId),
    )
    .map((citation) => ({
      citationId: citation.citationId,
      status: citation.status,
      source: citation.source,
      title: citation.title,
      category: citation.category,
      excerpt: citation.excerpt,
      accessScope: citation.accessScope,
      locator: citationLocator(citation),
    }));
  const parsed = publicCoachResultV2Schema.safeParse({
    schemaVersion: COACH_RESULT_V2_SCHEMA_VERSION,
    responseType: input.responseType,
    correction: input.answer.correction,
    explanation: input.answer.explanation,
    examples: input.answer.examples,
    errorTypes: input.answer.errorTypes,
    score: null,
    nextAction: input.recommendation.nextAction,
    nextActionReason: input.recommendation.nextActionReason,
    traceId: input.traceId,
    knowledgeStatus: 'grounded',
    groundedClaims: input.answer.groundedClaims,
    citations,
  });
  return parsed.success ? parsed.data : undefined;
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

export function upgradeCoachResultToV2(
  result: CoachResult,
): PublicCoachResultV2 {
  const {
    schemaVersion: _schemaVersion,
    citations: _citations,
    ...stable
  } = result;
  return publicCoachResultV2Schema.parse({
    ...stable,
    schemaVersion: COACH_RESULT_V2_SCHEMA_VERSION,
    knowledgeStatus:
      result.responseType === 'degraded' ? 'failed' : 'not_applicable',
    groundedClaims: [],
    citations: [],
  });
}
