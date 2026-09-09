import type { CoachExecutionContext } from '@libs/shared';
import type { CoachAnswerModelOutput } from './coach-model.gateway';
import {
  groundedCoachAnswerModelOutputSchema,
  type GroundedCoachAnswerModelOutput,
} from './coach-model.gateway';
import {
  parseModelAnswer,
  repairModelAnswer,
  validateGroundedClaims,
} from './final-result.validator';

export type CoachRagEvidence = Readonly<{
  citations: readonly Readonly<{
    citationId: string;
    source: string;
    title: string;
    category: string;
    excerpt: string;
    accessScope: 'PUBLIC' | 'OWNED_COURSE' | 'PRIVATE_OWNER';
    wordId: string | null;
    courseId: string | null;
    status: 'active';
    usage: 'answer_evidence' | 'conflict_context';
  }>[];
}>;

export type CoachAnswerWorkflowInput = Readonly<{
  requestId: string;
  conversationId: string;
  message: string;
  traceId: string;
}>;

export type CoachMaterialResult = Readonly<{
  materials: readonly Readonly<{
    citation: Readonly<{ sourceId: string }> & Record<string, unknown>;
    summary: string;
  }>[];
  unavailableTypes: readonly string[];
  ragEvidence?: CoachRagEvidence;
}>;

export async function generateValidatedAnswer(input: {
  generate: () => Promise<unknown>;
}): Promise<CoachAnswerModelOutput | undefined> {
  let raw: unknown;
  try {
    raw = await input.generate();
  } catch {
    return undefined;
  }
  const first = parseModelAnswer(raw);
  if (first) return first;

  try {
    raw = await input.generate();
  } catch {
    return undefined;
  }
  return parseModelAnswer(raw) ?? repairModelAnswer(raw);
}

export async function generateValidatedGroundedAnswer(input: {
  generate: () => Promise<unknown>;
  evidence: CoachRagEvidence;
}): Promise<GroundedCoachAnswerModelOutput | undefined> {
  const answerEvidence = input.evidence.citations.filter(
    (citation) => citation.usage === 'answer_evidence',
  );
  const issuedCitationIds = new Set(
    answerEvidence.map((citation) => citation.citationId),
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: unknown;
    try {
      raw = await input.generate();
    } catch {
      continue;
    }
    const parsed = groundedCoachAnswerModelOutputSchema.safeParse(raw);
    if (
      parsed.success &&
      validateGroundedClaims(
        {
          ...parsed.data,
          citations: answerEvidence.map((citation) => ({
            citationId: citation.citationId,
            status: citation.status,
          })),
        },
        issuedCitationIds,
      )
    ) {
      return parsed.data;
    }
  }
  return undefined;
}

export function ownedSourceIds(materials: CoachMaterialResult) {
  return new Set(materials.materials.map((item) => item.citation.sourceId));
}

export type CoachAnswerNodeContext = Readonly<{
  executionContext: CoachExecutionContext;
  input: CoachAnswerWorkflowInput;
}>;
