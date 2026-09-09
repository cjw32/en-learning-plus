import {
  buildAnswerPrompt,
  type CoachAnswerPromptInput,
} from './answer.prompt';

export const CORRECTION_PROMPT_INSTRUCTION =
  'Task mode: correct the learner text. Preserve intended meaning, explain at the supplied level, classify only supported error types, and provide concise examples.';

export function buildCorrectionPrompt(input: CoachAnswerPromptInput): string {
  return [
    CORRECTION_PROMPT_INSTRUCTION,
    buildAnswerPrompt(input),
  ].join('\n');
}
