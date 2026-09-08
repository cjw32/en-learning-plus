import { createHash } from 'node:crypto';
import { ANSWER_PROMPT_SYSTEM_INSTRUCTION } from './answer.prompt';
import { CLASSIFY_INTENT_PROMPT_INSTRUCTION } from './classify-intent.prompt';
import { CORRECTION_PROMPT_INSTRUCTION } from './correction.prompt';
import { CREATE_EXERCISE_PROMPT_INSTRUCTION } from './create-exercise.prompt';
import { GRADE_ANSWER_PROMPT_INSTRUCTION } from './grade-answer.prompt';

export const COACH_WORKFLOW_PROMPT_VERSION = 'coach.workflow.v1';

const PROMPT_MANIFEST = [
  COACH_WORKFLOW_PROMPT_VERSION,
  CLASSIFY_INTENT_PROMPT_INSTRUCTION,
  ANSWER_PROMPT_SYSTEM_INSTRUCTION,
  CORRECTION_PROMPT_INSTRUCTION,
  CREATE_EXERCISE_PROMPT_INSTRUCTION,
  GRADE_ANSWER_PROMPT_INSTRUCTION,
].join('\n---\n');

export const COACH_WORKFLOW_PROMPT_HASH = createHash('sha256')
  .update(PROMPT_MANIFEST)
  .digest('hex');
