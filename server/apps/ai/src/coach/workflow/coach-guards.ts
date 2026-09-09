import {
  CoachWorkflowNode,
  CoachWorkflowState,
  coachStateSchema,
} from './coach-state';

export class CoachWorkflowGuardError extends Error {
  readonly code = 'STATE_CONFLICT';
}

export function assertCoachNodeCanStart(
  stateInput: unknown,
  node: CoachWorkflowNode,
): CoachWorkflowState {
  const state = coachStateSchema.parse(stateInput);
  if (state.cancelled) {
    throw new CoachWorkflowGuardError('Cancelled request cannot start a node');
  }
  if (node !== 'classify_intent' && state.intent === null) {
    throw new CoachWorkflowGuardError('Intent must be validated first');
  }
  if (
    [
      'get_due_words',
      'search_learning_materials',
      'generate_answer',
      'create_exercise',
      'recommend',
    ].includes(node) &&
    !state.profileLoaded
  ) {
    throw new CoachWorkflowGuardError('Learner profile must be loaded first');
  }
  if (node === 'grade_answer' && state.inputType !== 'EXERCISE_SUBMISSION') {
    throw new CoachWorkflowGuardError('Only submissions can be graded');
  }
  if (node === 'save_attempt' && !state.gradingValidated) {
    throw new CoachWorkflowGuardError('A valid grade is required before save');
  }
  if (
    node === 'create_exercise' &&
    state.intent !== 'CREATE_EXERCISE'
  ) {
    throw new CoachWorkflowGuardError('Exercise intent is required');
  }
  if (node === 'finalize' && state.currentNode !== 'validate_result') {
    throw new CoachWorkflowGuardError('Result validation must precede finalize');
  }
  return state;
}
