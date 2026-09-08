import { z } from 'zod';
import {
  cefrLevelSchema,
  citationSchema,
  errorTypeSchema,
  exerciseDifficultySchema,
  exerciseTypeSchema,
  learningItemChangeSchema,
  learningTargetTypeSchema,
} from './result.schemas';

export const COACH_TOOL_SCHEMA_VERSION = 'coach.tool.v1' as const;

const schemaVersion = z.literal(COACH_TOOL_SCHEMA_VERSION);
const isoDateTime = z.iso.datetime({ offset: true });
const unique = <T>(items: T[]) => new Set(items).size === items.length;

export const toolFailureCodeSchema = z.enum([
  'FORBIDDEN',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_FAILED',
  'DATA_NOT_AVAILABLE',
  'SCHEMA_INVALID',
  'TOOL_TIMEOUT',
  'BUDGET_EXCEEDED',
  'IDEMPOTENCY_CONFLICT',
  'STATE_CONFLICT',
  'CANCELLED',
  'INTERNAL_ERROR',
]);

export const toolFailureSchema = z
  .object({
    schemaVersion,
    ok: z.literal(false),
    code: toolFailureCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict();

export const toolCitationSchema = citationSchema.extend({
  accessScope: z.enum(['PUBLIC', 'OWNED_COURSE']),
});

export const profileDimensionSchema = z.enum([
  'LEVEL',
  'GOAL',
  'LEARNED_WORDS',
  'WEAK_ITEMS',
  'ERROR_TYPES',
  'RECENT_PERFORMANCE',
  'ACTIVE_COURSE',
]);

export const getLearnerProfileInputSchema = z
  .object({
    schemaVersion,
    dimensions: z
      .array(profileDimensionSchema)
      .min(1)
      .max(7)
      .refine(unique, 'dimensions must be unique'),
    perDimensionLimit: z.number().int().min(1).max(50),
  })
  .strict();

export const weakItemSchema = z
  .object({
    targetType: learningTargetTypeSchema,
    targetKey: z.string(),
    label: z.string().max(300),
    reviewState: z.enum(['LEARNING', 'REVIEW', 'MASTERED']),
    lastQuality: z.number().int().min(0).max(5).nullable(),
    dueAt: isoDateTime.nullable(),
  })
  .strict();

export const getLearnerProfileSuccessSchema = z
  .object({
    schemaVersion,
    ok: z.literal(true),
    snapshotAt: isoDateTime,
    timezone: z.string().min(1).max(64),
    level: z
      .object({
        cefr: cefrLevelSchema,
        source: z.literal('USER_DECLARED'),
      })
      .strict()
      .nullable(),
    goal: z
      .object({
        type: z.enum(['GENERAL', 'EXAM', 'BUSINESS', 'TRAVEL', 'CUSTOM']),
        text: z.string().max(500).nullable(),
      })
      .strict()
      .nullable(),
    activeCourse: z
      .object({
        id: z.string(),
        name: z.string().max(300),
        value: z.string().max(50),
      })
      .strict()
      .nullable(),
    learnedWordSummary: z
      .object({
        legacyCompletedCount: z.number().int().min(0),
        coachEngagedCount: z.number().int().min(0),
        recentWords: z
          .array(
            z
              .object({
                wordId: z.string(),
                word: z.string(),
                state: z.enum([
                  'LEGACY_COMPLETED',
                  'LEARNING',
                  'REVIEW',
                  'MASTERED',
                ]),
              })
              .strict(),
          )
          .max(50),
      })
      .strict(),
    weakItems: z.array(weakItemSchema).max(50),
    errorTypes: z
      .array(
        z
          .object({
            type: errorTypeSchema,
            count: z.number().int().min(1),
            lastSeenAt: isoDateTime,
          })
          .strict(),
      )
      .max(11),
    recentPerformance: z
      .object({
        attemptCount: z.number().int().min(0),
        averageScore: z.number().int().min(0).max(100).nullable(),
        windowStart: isoDateTime,
      })
      .strict(),
    signals: z
      .array(
        z
          .object({
            dimension: profileDimensionSchema,
            status: z.enum([
              'AVAILABLE',
              'MISSING',
              'STALE',
              'NOT_APPLICABLE',
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(7),
  })
  .strict();

export const getLearnerProfileOutputSchema = z.union([
  getLearnerProfileSuccessSchema,
  toolFailureSchema,
]);

export const getDueWordsInputSchema = z
  .object({
    schemaVersion,
    learningDate: z.iso.date(),
    timezone: z.string().min(1).max(64),
    limit: z.number().int().min(1).max(100),
    courseId: z.string().max(64).optional(),
  })
  .strict();

export const dueWordSchema = z
  .object({
    wordId: z.string(),
    word: z.string(),
    definition: z.string().max(4000).nullable(),
    translation: z.string().max(4000).nullable(),
    reviewState: z.enum(['LEARNING', 'REVIEW', 'MASTERED']),
    dueAt: isoDateTime,
    priority: z.number().int().min(1),
    reason: z.string().max(1000),
    citation: toolCitationSchema,
  })
  .strict();

export const getDueWordsOutputSchema = z.union([
  z
    .object({
      schemaVersion,
      ok: z.literal(true),
      asOf: isoDateTime,
      words: z.array(dueWordSchema).max(100),
      totalDue: z.number().int().min(0),
      truncated: z.boolean(),
    })
    .strict(),
  toolFailureSchema,
]);

export const materialTypeSchema = z.enum(['word', 'course', 'grammar']);

export const searchLearningMaterialsInputSchema = z
  .object({
    schemaVersion,
    query: z.string().min(1).max(1000),
    materialTypes: z
      .array(materialTypeSchema)
      .min(1)
      .max(3)
      .refine(unique, 'materialTypes must be unique'),
    cefrLevel: cefrLevelSchema.nullable().optional(),
    courseId: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(50),
  })
  .strict();

export const searchLearningMaterialsOutputSchema = z.union([
  z
    .object({
      schemaVersion,
      ok: z.literal(true),
      query: z.string(),
      materials: z
        .array(
          z
            .object({
              citation: toolCitationSchema,
              summary: z.string().min(1).max(4000),
              freshness: isoDateTime,
            })
            .strict(),
        )
        .max(50),
      unavailableTypes: z
        .array(materialTypeSchema)
        .max(3)
        .refine(unique, 'unavailableTypes must be unique'),
    })
    .strict(),
  toolFailureSchema,
]);

export const exerciseTargetRefSchema = z
  .object({
    targetType: learningTargetTypeSchema,
    targetKey: z.string().min(1).max(128),
  })
  .strict();

export const createExerciseInputSchema = z
  .object({
    schemaVersion,
    types: z
      .array(exerciseTypeSchema)
      .min(1)
      .max(4)
      .refine(unique, 'types must be unique'),
    count: z.number().int().min(1).max(20),
    difficulty: exerciseDifficultySchema,
    targetRefs: z.array(exerciseTargetRefSchema).min(1).max(50),
    materialSourceIds: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(50)
      .refine(unique, 'materialSourceIds must be unique'),
    scenario: z.string().max(1000).optional(),
    idempotencyKey: z.string().min(16).max(128),
  })
  .strict();

export const publicExerciseItemSchema = z
  .object({
    itemId: z.string(),
    position: z.number().int().min(1),
    prompt: z.string().min(1).max(4000),
    choices: z
      .array(
        z
          .object({
            id: z.string().max(32),
            text: z.string().max(1000),
          })
          .strict(),
      )
      .max(8)
      .nullable(),
    maxScore: z.number().int().min(1).max(100),
    citations: z.array(toolCitationSchema).max(10),
  })
  .strict();

export const createExerciseOutputSchema = z.union([
  z
    .object({
      schemaVersion,
      ok: z.literal(true),
      exerciseId: z.string(),
      type: exerciseTypeSchema,
      difficulty: exerciseDifficultySchema,
      instructions: z.string().min(1).max(2000),
      personalizationReason: z.string().min(1).max(2000),
      items: z.array(publicExerciseItemSchema).min(1).max(20),
      citations: z.array(toolCitationSchema).max(20),
      expiresAt: isoDateTime,
    })
    .strict(),
  toolFailureSchema,
]);

export const exerciseAnswerSchema = z
  .object({
    itemId: z.string(),
    answer: z.union([
      z.string().max(4000),
      z.array(z.string().max(1000)).max(20),
    ]),
  })
  .strict();

export const gradeAnswerInputSchema = z
  .object({
    schemaVersion,
    exerciseId: z.string().min(10).max(64),
    answers: z.array(exerciseAnswerSchema).min(1).max(50),
    idempotencyKey: z.string().min(16).max(128),
  })
  .strict();

export const gradeAnswerOutputSchema = z.union([
  z
    .object({
      schemaVersion,
      ok: z.literal(true),
      submissionId: z.string(),
      answerVersion: z.string(),
      gradingHash: z.string(),
      score: z.number().int().min(0).max(100),
      correction: z.string().max(4000),
      explanation: z.string().min(1).max(12000),
      examples: z.array(z.string().max(2000)).max(8),
      errorTypes: z
        .array(errorTypeSchema)
        .max(11)
        .refine(unique, 'errorTypes must be unique'),
      items: z
        .array(
          z
            .object({
              itemId: z.string(),
              isCorrect: z.boolean(),
              score: z.number().int().min(0).max(100),
              correction: z.string().max(4000),
              explanation: z.string().max(4000),
              errorTypes: z.array(errorTypeSchema).max(11),
              targetQualities: z
                .array(
                  z
                    .object({
                      targetType: learningTargetTypeSchema,
                      targetKey: z.string(),
                      quality: z.number().int().min(0).max(5),
                    })
                    .strict(),
                )
                .min(1)
                .max(50),
            })
            .strict(),
        )
        .min(1)
        .max(50),
      citations: z.array(toolCitationSchema).max(20),
    })
    .strict(),
  toolFailureSchema,
]);

export const saveAttemptInputSchema = z
  .object({
    schemaVersion,
    submissionId: z.string().min(10).max(64),
    gradingHash: z.string().min(32).max(128),
    idempotencyKey: z.string().min(16).max(128),
  })
  .strict();

export const saveAttemptOutputSchema = z.union([
  z
    .object({
      schemaVersion,
      ok: z.literal(true),
      status: z.enum(['saved', 'replayed']),
      attemptId: z.string(),
      score: z.number().int().min(0).max(100),
      changes: z.array(learningItemChangeSchema).max(100),
      savedAt: isoDateTime,
    })
    .strict(),
  toolFailureSchema,
]);

export const coachToolSchemas = {
  get_learner_profile: {
    input: getLearnerProfileInputSchema,
    output: getLearnerProfileOutputSchema,
  },
  get_due_words: {
    input: getDueWordsInputSchema,
    output: getDueWordsOutputSchema,
  },
  search_learning_materials: {
    input: searchLearningMaterialsInputSchema,
    output: searchLearningMaterialsOutputSchema,
  },
  create_exercise: {
    input: createExerciseInputSchema,
    output: createExerciseOutputSchema,
  },
  grade_answer: {
    input: gradeAnswerInputSchema,
    output: gradeAnswerOutputSchema,
  },
  save_attempt: {
    input: saveAttemptInputSchema,
    output: saveAttemptOutputSchema,
  },
} as const;

export const coachToolContractsSchema = z
  .object({
    get_learner_profile: z
      .object(coachToolSchemas.get_learner_profile)
      .strict(),
    get_due_words: z.object(coachToolSchemas.get_due_words).strict(),
    search_learning_materials: z
      .object(coachToolSchemas.search_learning_materials)
      .strict(),
    create_exercise: z.object(coachToolSchemas.create_exercise).strict(),
    grade_answer: z.object(coachToolSchemas.grade_answer).strict(),
    save_attempt: z.object(coachToolSchemas.save_attempt).strict(),
  })
  .strict();

export const coachToolContractsJsonSchema = z.toJSONSchema(
  coachToolContractsSchema,
  { target: 'draft-2020-12', io: 'input' },
);

export type CoachToolName = keyof typeof coachToolSchemas;
export type GetLearnerProfileInput = z.infer<
  typeof getLearnerProfileInputSchema
>;
export type GetLearnerProfileOutput = z.infer<
  typeof getLearnerProfileOutputSchema
>;
export type GetDueWordsInput = z.infer<typeof getDueWordsInputSchema>;
export type GetDueWordsOutput = z.infer<typeof getDueWordsOutputSchema>;
export type SearchLearningMaterialsInput = z.infer<
  typeof searchLearningMaterialsInputSchema
>;
export type SearchLearningMaterialsOutput = z.infer<
  typeof searchLearningMaterialsOutputSchema
>;
export type CreateExerciseInput = z.infer<typeof createExerciseInputSchema>;
export type CreateExerciseOutput = z.infer<typeof createExerciseOutputSchema>;
export type GradeAnswerInput = z.infer<typeof gradeAnswerInputSchema>;
export type GradeAnswerOutput = z.infer<typeof gradeAnswerOutputSchema>;
export type SaveAttemptInput = z.infer<typeof saveAttemptInputSchema>;
export type SaveAttemptOutput = z.infer<typeof saveAttemptOutputSchema>;
