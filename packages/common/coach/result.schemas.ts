import { z } from 'zod';

export const COACH_RESULT_SCHEMA_VERSION = 'coach.result.v1' as const;

export const cefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
export const exerciseDifficultySchema = z.enum([
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
  'UNKNOWN',
]);
export const exerciseTypeSchema = z.enum([
  'MULTIPLE_CHOICE',
  'FILL_BLANK',
  'TRANSLATION',
  'SITUATIONAL_DIALOGUE',
]);
export const errorTypeSchema = z.enum([
  'VOCABULARY',
  'SPELLING',
  'GRAMMAR',
  'TENSE',
  'ARTICLE',
  'PREPOSITION',
  'COLLOCATION',
  'WORD_ORDER',
  'EXPRESSION',
  'COMPREHENSION',
  'OTHER',
]);
export const learningTargetTypeSchema = z.enum(['WORD', 'ERROR_TYPE']);
export const learningReviewStateSchema = z.enum([
  'NEW',
  'LEARNING',
  'REVIEW',
  'MASTERED',
]);
export const nextLearningReviewStateSchema = z.enum([
  'LEARNING',
  'REVIEW',
  'MASTERED',
]);

const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const citationSchema = z
  .object({
    sourceId: z.string().min(1).max(128),
    materialType: z.enum(['word', 'course', 'grammar']),
    title: z.string().min(1).max(300),
    locator: z.string().max(500).nullable(),
    supports: z.string().min(1).max(1000),
  })
  .strict();

export const exerciseChoiceSchema = z
  .object({
    id: z.string().min(1).max(32),
    text: z.string().min(1).max(1000),
  })
  .strict();

export const exerciseItemForLearnerSchema = z
  .object({
    id: z.string().min(10).max(64),
    position: z.number().int().min(1),
    prompt: z.string().min(1).max(4000),
    choices: z.array(exerciseChoiceSchema).min(2).max(8).nullable(),
    maxScore: z.number().int().min(1).max(100),
    citations: z.array(citationSchema).max(10),
  })
  .strict();

export const exerciseForLearnerSchema = z
  .object({
    id: z.string().min(10).max(64),
    type: exerciseTypeSchema,
    cefrDifficulty: exerciseDifficultySchema,
    instructions: z.string().min(1).max(2000),
    personalizationReason: z.string().min(1).max(2000),
    items: z.array(exerciseItemForLearnerSchema).min(1).max(20),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const learningItemChangeSchema = z
  .object({
    targetType: learningTargetTypeSchema,
    targetKey: z.string().min(1).max(128),
    label: z.string().min(1).max(300),
    previousState: learningReviewStateSchema,
    nextState: nextLearningReviewStateSchema,
    quality: z.number().int().min(0).max(5),
    nextReviewAt: isoDateTimeSchema,
    reason: z.string().min(1).max(1000),
  })
  .strict();

export const learningUpdateSchema = z
  .object({
    status: z.enum(['saved', 'replayed', 'not_saved']),
    attemptId: z.string().min(10).max(64).nullable(),
    changes: z.array(learningItemChangeSchema).max(100),
    savedAt: isoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const isSaved = value.status === 'saved' || value.status === 'replayed';
    if (isSaved && (value.attemptId === null || value.savedAt === null)) {
      context.addIssue({
        code: 'custom',
        message: 'saved/replayed learning updates require attemptId and savedAt',
      });
    }
    if (value.status === 'not_saved' && value.savedAt !== null) {
      context.addIssue({
        code: 'custom',
        message: 'not_saved learning updates cannot have savedAt',
      });
    }
    if (
      value.status === 'not_saved' &&
      (value.attemptId !== null || value.changes.length > 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'not_saved learning updates cannot imply persisted changes',
      });
    }
  });

export const gradingItemResultSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    isCorrect: z.boolean(),
    score: z.number().int().min(0).max(100),
    correction: z.string().max(4000),
    explanation: z.string().min(1).max(4000),
    errorTypes: z.array(errorTypeSchema).max(11),
  })
  .strict();

const uniqueStrings = <T extends z.ZodType<string>>(schema: T, max: number) =>
  z
    .array(schema)
    .max(max)
    .refine((items) => new Set(items).size === items.length, {
      message: 'items must be unique',
    });

export const coachResponseTypeSchema = z.enum([
  'answer',
  'correction',
  'exercise',
  'grading',
  'recommendation',
  'degraded',
]);

export const coachResultSchema = z
  .object({
    schemaVersion: z.literal(COACH_RESULT_SCHEMA_VERSION),
    responseType: coachResponseTypeSchema,
    correction: z.string().max(4000),
    explanation: z.string().min(1).max(12000),
    examples: uniqueStrings(z.string().min(1).max(2000), 8),
    errorTypes: uniqueStrings(errorTypeSchema, 11),
    score: z.number().int().min(0).max(100).nullable(),
    nextAction: z.enum(['review', 'practice', 'continue']),
    citations: z.array(citationSchema).max(20),
    nextActionReason: z.string().min(1).max(2000),
    traceId: z.string().min(10).max(64).regex(/^[A-Za-z0-9_-]+$/),
    exercise: exerciseForLearnerSchema.optional(),
    gradingItems: z.array(gradingItemResultSchema).min(1).max(50).optional(),
    learningUpdate: learningUpdateSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.responseType === 'exercise') {
      if (!value.exercise) {
        context.addIssue({
          code: 'custom',
          path: ['exercise'],
          message: 'exercise response requires exercise',
        });
      }
      if (value.score !== null || value.nextAction !== 'practice') {
        context.addIssue({
          code: 'custom',
          message: 'exercise response requires null score and practice action',
        });
      }
    }
    if (value.responseType === 'grading') {
      if (value.score === null || !value.learningUpdate || !value.gradingItems) {
        context.addIssue({
          code: 'custom',
          message:
            'grading response requires score, gradingItems and learningUpdate',
        });
      }
    } else if (value.score !== null) {
      context.addIssue({
        code: 'custom',
        path: ['score'],
        message: 'only grading responses may include a score',
      });
    }
    if (value.responseType !== 'exercise' && value.exercise) {
      context.addIssue({
        code: 'custom',
        path: ['exercise'],
        message: 'exercise is only valid for exercise responses',
      });
    }
    if (value.responseType !== 'grading' && value.learningUpdate) {
      context.addIssue({
        code: 'custom',
        path: ['learningUpdate'],
        message: 'learningUpdate is only valid for grading responses',
      });
    }
    if (value.responseType !== 'grading' && value.gradingItems) {
      context.addIssue({
        code: 'custom',
        path: ['gradingItems'],
        message: 'gradingItems is only valid for grading responses',
      });
    }
  });

export const coachResultJsonSchema = z.toJSONSchema(coachResultSchema, {
  target: 'draft-2020-12',
  io: 'input',
});

export type CefrLevel = z.infer<typeof cefrLevelSchema>;
export type ExerciseType = z.infer<typeof exerciseTypeSchema>;
export type ErrorType = z.infer<typeof errorTypeSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type CoachResult = z.infer<typeof coachResultSchema>;
