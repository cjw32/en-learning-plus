import type { CoachExecutionContext } from '@libs/shared';
import type { CoachAnswerModelOutput } from './coach-model.gateway';
import { parseModelAnswer, repairModelAnswer } from './final-result.validator';

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

export function ownedSourceIds(materials: CoachMaterialResult) {
  return new Set(materials.materials.map((item) => item.citation.sourceId));
}

export type CoachAnswerNodeContext = Readonly<{
  executionContext: CoachExecutionContext;
  input: CoachAnswerWorkflowInput;
}>;
