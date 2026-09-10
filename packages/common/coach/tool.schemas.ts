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
export const COACH_RAG_TOOL_SCHEMA_VERSION = 'coach.tool.v2' as const;

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

export const ragKnowledgeCategorySchema = z.enum([
  'WORD_MEANING',
  'WORD_TRANSLATION',
  'WORD_PRONUNCIATION',
  'WORD_FORM',
  'WORD_USAGE',
  'COLLOCATION',
  'EXAMPLE_SENTENCE',
  'GRAMMAR_RULE',
  'GRAMMAR_EXCEPTION',
  'COURSE_LESSON',
  'EXERCISE_KNOWLEDGE',
  'USER_ERROR',
  'LEARNING_SUMMARY',
]);
export const ragAccessScopeSchema = z.enum([
  'PUBLIC',
  'OWNED_COURSE',
  'PRIVATE_OWNER',
]);

const ragSchemaVersion = z.literal(COACH_RAG_TOOL_SCHEMA_VERSION);
const boundedUniqueStrings = (maximum: number, itemMaximum: number) =>
  z
    .array(z.string().min(1).max(itemMaximum))
    .max(maximum)
    .refine(unique, 'items must be unique');

export const searchLearningMaterialsV2FiltersSchema = z
  .object({
    levels: z
      .array(cefrLevelSchema)
      .max(6)
      .refine(unique, 'levels must be unique')
      .optional(),
    categories: z
      .array(ragKnowledgeCategorySchema)
      .min(1)
      .max(13)
      .refine(unique, 'categories must be unique'),
    sources: boundedUniqueStrings(20, 128),
    courseIds: boundedUniqueStrings(20, 64),
    wordIds: boundedUniqueStrings(50, 64),
    accessScopes: z
      .array(ragAccessScopeSchema)
      .max(3)
      .refine(unique, 'accessScopes must be unique')
      .optional(),
  })
  .strict();

export const searchLearningMaterialsV2InputSchema = z
  .object({
    schemaVersion: ragSchemaVersion,
    query: z.string().trim().min(1).max(1000),
    filters: searchLearningMaterialsV2FiltersSchema,
    topK: z.number().int().min(1).max(20),
    minimumRelevance: z.number().min(0).max(1).optional(),
  })
  .strict();

export const ragAppliedFiltersSchema = z
  .object({
    levels: z.array(cefrLevelSchema).refine(unique),
    levelFilterApplied: z.boolean(),
    categories: z.array(ragKnowledgeCategorySchema).min(1).refine(unique),
    sources: boundedUniqueStrings(20, 128),
    courseIds: boundedUniqueStrings(20, 64),
    wordIds: boundedUniqueStrings(50, 64),
    accessScopes: z.array(ragAccessScopeSchema).min(1).max(3).refine(unique),
    privateOwnerEnforced: z.literal(true),
    topK: z.number().int().min(1).max(20),
    minimumRelevance: z.number().min(0).max(1),
    sourceRightsSnapshotVersion: z.string().min(1).max(128),
    contentVersionPolicy: z.string().min(1).max(128),
    chunkingVersion: z.string().min(1).max(128),
    embeddingVersion: z.string().min(1).max(256),
    retrievalConfigVersion: z.string().min(1).max(128),
    indexVersion: z.string().min(1).max(128),
  })
  .strict();

export const ragRetrievalResultSchema = z
  .object({
    resultId: z.string().min(10).max(64),
    chunkId: z.string().min(10).max(64),
    documentId: z.string().min(10).max(64),
    citationId: z.string().regex(/^cit_[A-Za-z0-9_-]{10,48}$/),
    source: z.string().min(1).max(128),
    sourceId: z.string().min(1).max(300),
    title: z.string().min(1).max(300),
    category: ragKnowledgeCategorySchema,
    excerpt: z.string().min(1).max(2000),
    level: cefrLevelSchema.nullable(),
    courseId: z.string().max(64).nullable(),
    wordId: z.string().max(64).nullable(),
    accessScope: ragAccessScopeSchema,
    rank: z.number().int().min(1).max(20),
    relevanceScore: z.number().min(0).max(1),
    contentVersion: z.string().min(1).max(128),
    embeddingVersion: z.string().min(1).max(256),
    status: z.literal('valid'),
  })
  .strict();

export const ragToolCitationSchema = z
  .object({
    citationId: z.string().regex(/^cit_[A-Za-z0-9_-]{10,48}$/),
    source: z.string().min(1).max(128),
    sourceId: z.string().min(1).max(300),
    title: z.string().min(1).max(300),
    excerpt: z.string().min(1).max(2000),
    category: ragKnowledgeCategorySchema,
    wordId: z.string().max(64).nullable(),
    courseId: z.string().max(64).nullable(),
    accessScope: ragAccessScopeSchema,
    status: z.literal('active'),
    usage: z.enum(['answer_evidence', 'conflict_context']),
  })
  .strict();

export const ragConflictSchema = z
  .object({
    conflictId: z.string().min(10).max(64),
    topic: z.string().min(1).max(300),
    citationIds: z
      .array(z.string().regex(/^cit_[A-Za-z0-9_-]{10,48}$/))
      .min(2)
      .max(10)
      .refine(unique),
    resolution: z.enum([
      'resolved_by_version',
      'resolved_by_authority',
      'unresolved',
    ]),
  })
  .strict();

const ragSuccessfulOutputSchema = z
  .object({
    schemaVersion: ragSchemaVersion,
    ok: z.literal(true),
    query: z.string().min(1).max(1000),
    appliedFilters: ragAppliedFiltersSchema,
    results: z.array(ragRetrievalResultSchema).max(20),
    citations: z.array(ragToolCitationSchema).max(20),
    conflicts: z.array(ragConflictSchema).max(20),
    retrievalStatus: z.enum(['success', 'insufficient']),
  })
  .strict()
  .superRefine((output, context) => {
    if (
      output.retrievalStatus === 'success' &&
      (output.results.length === 0 || output.citations.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'successful retrieval requires results and citations',
      });
    }
    if (output.retrievalStatus === 'insufficient' && output.results.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'insufficient retrieval cannot contain results',
      });
    }
    output.results.forEach((result, index) => {
      if (result.rank !== index + 1 || result.rank > output.appliedFilters.topK) {
        context.addIssue({
          code: 'custom',
          path: ['results', index, 'rank'],
          message: 'result ranks must be sequential and within applied topK',
        });
      }
    });
  });

export const ragRetrievalFailureCodeSchema = z.enum([
  'RAG_DISABLED',
  'EMBEDDING_UNAVAILABLE',
  'TOOL_TIMEOUT',
  'CONFIGURATION_UNAPPROVED',
  'SCHEMA_INVALID',
  'CANCELLED',
  'INTERNAL_ERROR',
]);

const ragFailedOutputSchema = z
  .object({
    schemaVersion: ragSchemaVersion,
    ok: z.literal(false),
    query: z.string().min(1).max(1000),
    appliedFilters: ragAppliedFiltersSchema,
    results: z.array(z.never()).max(0),
    citations: z.array(z.never()).max(0),
    conflicts: z.array(z.never()).max(0),
    retrievalStatus: z.literal('failed'),
    failure: z
      .object({
        code: ragRetrievalFailureCodeSchema,
        message: z.string().min(1).max(500),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const searchLearningMaterialsV2OutputSchema = z.union([
  ragSuccessfulOutputSchema,
  ragFailedOutputSchema,
]);

export const searchLearningMaterialsV2ContractSchema = z
  .object({
    input: searchLearningMaterialsV2InputSchema,
    output: searchLearningMaterialsV2OutputSchema,
  })
  .strict();

export const searchLearningMaterialsV2ContractJsonSchema = z.toJSONSchema(
  searchLearningMaterialsV2ContractSchema,
  { target: 'draft-2020-12', io: 'input' },
);

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
export type SearchLearningMaterialsV2Input = z.infer<
  typeof searchLearningMaterialsV2InputSchema
>;
export type SearchLearningMaterialsV2Output = z.infer<
  typeof searchLearningMaterialsV2OutputSchema
>;
export type CreateExerciseInput = z.infer<typeof createExerciseInputSchema>;
export type CreateExerciseOutput = z.infer<typeof createExerciseOutputSchema>;
export type GradeAnswerInput = z.infer<typeof gradeAnswerInputSchema>;
export type GradeAnswerOutput = z.infer<typeof gradeAnswerOutputSchema>;
export type SaveAttemptInput = z.infer<typeof saveAttemptInputSchema>;
export type SaveAttemptOutput = z.infer<typeof saveAttemptOutputSchema>;
