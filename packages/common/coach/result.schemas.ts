import { z } from 'zod';

export const COACH_RESULT_SCHEMA_VERSION = 'coach.result.v1' as const;
export const COACH_RESULT_V2_SCHEMA_VERSION = 'coach.result.v2' as const;

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

export const knowledgeCategorySchema = z.enum([
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

export const knowledgeAccessScopeSchema = z.enum([
  'PUBLIC',
  'OWNED_COURSE',
  'PRIVATE_OWNER',
]);

export const citationIdSchema = z
  .string()
  .regex(/^cit_[A-Za-z0-9_-]{10,48}$/);

export const citationLocatorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('word'),
      id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('course'),
      id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('grammar'),
      id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('exercise'),
      id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    })
    .strict(),
]);

export const activeCoachCitationV2Schema = z
  .object({
    citationId: citationIdSchema,
    status: z.literal('active'),
    source: z.string().min(1).max(128),
    title: z.string().min(1).max(300),
    category: knowledgeCategorySchema,
    excerpt: z.string().min(1).max(2000),
    accessScope: knowledgeAccessScopeSchema,
    locator: citationLocatorSchema.nullable(),
  })
  .strict();

export const unavailableCoachCitationV2Schema = z
  .object({
    citationId: citationIdSchema,
    status: z.literal('unavailable'),
    reason: z.literal('SOURCE_UNAVAILABLE'),
  })
  .strict();

export const publicCoachCitationV2Schema = z.discriminatedUnion('status', [
  activeCoachCitationV2Schema,
  unavailableCoachCitationV2Schema,
]);

const groundedClaimPath =
  /^\/(?:correction|explanation|examples\/[0-7]|gradingItems\/[0-9]+\/(?:correction|explanation)|exercise\/items\/[0-9]+\/prompt)$/;

export const groundedClaimSchema = z
  .object({
    claimId: z.string().regex(/^claim_[A-Za-z0-9_-]{8,48}$/),
    resultPath: z.string().regex(groundedClaimPath),
    text: z.string().min(1).max(4000),
    citationIds: uniqueStrings(citationIdSchema, 5).min(1),
  })
  .strict();

const coachResultV2BaseShape = {
  schemaVersion: z.literal(COACH_RESULT_V2_SCHEMA_VERSION),
  responseType: coachResponseTypeSchema,
  correction: z.string().max(4000),
  explanation: z.string().min(1).max(12000),
  examples: uniqueStrings(z.string().min(1).max(2000), 8),
  errorTypes: uniqueStrings(errorTypeSchema, 11),
  score: z.number().int().min(0).max(100).nullable(),
  nextAction: z.enum(['review', 'practice', 'continue']),
  nextActionReason: z.string().min(1).max(2000),
  traceId: z.string().min(10).max(64).regex(/^[A-Za-z0-9_-]+$/),
  knowledgeStatus: z.enum([
    'grounded',
    'insufficient',
    'failed',
    'not_applicable',
  ]),
  groundedClaims: z.array(groundedClaimSchema).max(40),
  exercise: exerciseForLearnerSchema.optional(),
  gradingItems: z.array(gradingItemResultSchema).min(1).max(50).optional(),
  learningUpdate: learningUpdateSchema.optional(),
} as const;

type V2ValidationValue = {
  responseType: z.infer<typeof coachResponseTypeSchema>;
  score: number | null;
  nextAction: 'review' | 'practice' | 'continue';
  knowledgeStatus: 'grounded' | 'insufficient' | 'failed' | 'not_applicable';
  groundedClaims: z.infer<typeof groundedClaimSchema>[];
  exercise?: unknown;
  gradingItems?: unknown;
  learningUpdate?: unknown;
};

function validateCoachResultV2(
  value: V2ValidationValue,
  context: z.RefinementCtx,
  availableCitationIds: readonly string[],
): void {
  if (new Set(availableCitationIds).size !== availableCitationIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['citations'],
      message: 'citation IDs must be unique',
    });
  }
  const available = new Set(availableCitationIds);
  for (const [index, claim] of value.groundedClaims.entries()) {
    if (!claim.citationIds.every((citationId) => available.has(citationId))) {
      context.addIssue({
        code: 'custom',
        path: ['groundedClaims', index, 'citationIds'],
        message: 'grounded claims must reference citations in this result',
      });
    }
  }
  if (
    value.knowledgeStatus === 'grounded' &&
    (availableCitationIds.length === 0 || value.groundedClaims.length === 0)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'grounded results require citations and grounded claims',
    });
  }
  if (
    value.knowledgeStatus !== 'grounded' &&
    value.groundedClaims.length > 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['groundedClaims'],
      message: 'non-grounded results cannot include grounded claims',
    });
  }
  if (value.responseType === 'exercise') {
    if (!value.exercise || value.score !== null || value.nextAction !== 'practice') {
      context.addIssue({
        code: 'custom',
        message: 'exercise response requires exercise, null score and practice action',
      });
    }
  } else if (value.exercise) {
    context.addIssue({
      code: 'custom',
      path: ['exercise'],
      message: 'exercise is only valid for exercise responses',
    });
  }
  if (value.responseType === 'grading') {
    if (value.score === null || !value.learningUpdate || !value.gradingItems) {
      context.addIssue({
        code: 'custom',
        message: 'grading response requires score, gradingItems and learningUpdate',
      });
    }
  } else if (value.score !== null || value.learningUpdate || value.gradingItems) {
    context.addIssue({
      code: 'custom',
      message: 'non-grading responses cannot include grading-only fields',
    });
  }
}

export const storedCoachResultV2Schema = z
  .object({
    ...coachResultV2BaseShape,
    citationIds: uniqueStrings(citationIdSchema, 20),
  })
  .strict()
  .superRefine((value, context) =>
    validateCoachResultV2(value, context, value.citationIds),
  );

export const publicCoachResultV2Schema = z
  .object({
    ...coachResultV2BaseShape,
    citations: z.array(publicCoachCitationV2Schema).max(20),
  })
  .strict()
  .superRefine((value, context) =>
    validateCoachResultV2(
      value,
      context,
      value.citations.map((citation) => citation.citationId),
    ),
  );

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

export const storedCoachResultV2JsonSchema = z.toJSONSchema(
  storedCoachResultV2Schema,
  { target: 'draft-2020-12', io: 'input' },
);

export const publicCoachResultV2JsonSchema = z.toJSONSchema(
  publicCoachResultV2Schema,
  { target: 'draft-2020-12', io: 'input' },
);

export const anyPublicCoachResultSchema = z.union([
  coachResultSchema,
  publicCoachResultV2Schema,
]);

export type CefrLevel = z.infer<typeof cefrLevelSchema>;
export type ExerciseType = z.infer<typeof exerciseTypeSchema>;
export type ErrorType = z.infer<typeof errorTypeSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type CoachResult = z.infer<typeof coachResultSchema>;
export type CitationLocator = z.infer<typeof citationLocatorSchema>;
export type PublicCoachCitationV2 = z.infer<
  typeof publicCoachCitationV2Schema
>;
export type GroundedClaim = z.infer<typeof groundedClaimSchema>;
export type StoredCoachResultV2 = z.infer<typeof storedCoachResultV2Schema>;
export type PublicCoachResultV2 = z.infer<typeof publicCoachResultV2Schema>;
export type AnyPublicCoachResult = z.infer<typeof anyPublicCoachResultSchema>;
