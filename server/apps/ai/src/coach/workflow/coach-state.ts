import { z } from '@en/common/coach/zod';

export const coachWorkflowNodeSchema = z.enum([
  'classify_intent',
  'get_learner_profile',
  'get_due_words',
  'search_learning_materials',
  'generate_answer',
  'create_exercise',
  'grade_answer',
  'save_attempt',
  'recommend',
  'validate_result',
  'finalize',
]);

export const coachIntentSchema = z.enum([
  'ANSWER',
  'CORRECTION',
  'CREATE_EXERCISE',
  'GRADE_ANSWER',
  'REVIEW_RECOMMENDATION',
  'UNKNOWN',
]);

export const coachStateSchema = z
  .object({
    requestId: z.string().min(10).max(64),
    conversationId: z.string().min(1).max(64),
    inputType: z.enum(['MESSAGE', 'EXERCISE_SUBMISSION', 'RECOMMENDATION']),
    currentNode: coachWorkflowNodeSchema.nullable(),
    intent: coachIntentSchema.nullable(),
    profileLoaded: z.boolean(),
    dueWordsLoaded: z.boolean(),
    materialSourceIds: z.array(z.string().min(1).max(128)).max(50),
    exerciseId: z.string().max(64).nullable(),
    submissionId: z.string().max(64).nullable(),
    gradingValidated: z.boolean(),
    attemptSaved: z.boolean(),
    schemaRetryCount: z.number().int().min(0).max(1),
    toolCallCount: z.number().int().min(0),
    cancelled: z.boolean(),
  })
  .strict();

export type CoachWorkflowNode = z.infer<typeof coachWorkflowNodeSchema>;
export type CoachWorkflowState = z.infer<typeof coachStateSchema>;
