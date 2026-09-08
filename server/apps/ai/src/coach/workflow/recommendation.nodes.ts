import { z } from '@en/common/coach/zod';
import { buildExplainNextActionPrompt } from '../prompts/explain-next-action.prompt';
import {
  deterministicNextActionReason,
  type NextActionDecision,
} from './next-action.policy';

const explanationSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();

export type ExplainedNextAction = Readonly<{
  nextAction: NextActionDecision['nextAction'];
  nextActionReason: string;
  evidenceCodes: NextActionDecision['evidenceCodes'];
  explanationSource: 'model' | 'deterministic_fallback';
}>;

export async function explainFixedNextAction(input: {
  decision: NextActionDecision;
  generate(
    prompt: ReturnType<typeof buildExplainNextActionPrompt>,
  ): Promise<unknown>;
}): Promise<ExplainedNextAction> {
  try {
    const parsed = explanationSchema.safeParse(
      await input.generate(buildExplainNextActionPrompt(input.decision)),
    );
    if (parsed.success) {
      return Object.freeze({
        nextAction: input.decision.nextAction,
        nextActionReason: parsed.data.reason,
        evidenceCodes: input.decision.evidenceCodes,
        explanationSource: 'model' as const,
      });
    }
  } catch {
    // The deterministic branch below is the user-safe authority.
  }
  return Object.freeze({
    nextAction: input.decision.nextAction,
    nextActionReason: deterministicNextActionReason(input.decision),
    evidenceCodes: input.decision.evidenceCodes,
    explanationSource: 'deterministic_fallback' as const,
  });
}
