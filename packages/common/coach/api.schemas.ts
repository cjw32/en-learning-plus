import { z } from 'zod';
import {
  coachPublicErrorCodeSchema,
  coachRequestStatusSchema,
} from './event.schemas';
import {
  cefrLevelSchema,
  anyPublicCoachResultSchema,
  exerciseTypeSchema,
} from './result.schemas';
import { exerciseAnswerSchema } from './tool.schemas';

export const COACH_API_SCHEMA_VERSION = 'coach.v1' as const;

const isoDateTime = z.iso.datetime({ offset: true });
export const idempotencyKeySchema = z.string().min(16).max(128);

export const coachProfileSchema = z
  .object({
    cefrLevel: cefrLevelSchema.nullable(),
    levelSource: z.literal('USER_DECLARED').nullable(),
    goalType: z
      .enum(['GENERAL', 'EXAM', 'BUSINESS', 'TRAVEL', 'CUSTOM'])
      .nullable(),
    goalText: z.string().max(500).nullable(),
    activeCourseId: z.string().nullable(),
    timezone: z.string().min(1).max(64),
    updatedAt: isoDateTime,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.cefrLevel === null) !== (value.levelSource === null)) {
      context.addIssue({
        code: 'custom',
        message: 'cefrLevel and levelSource must be present together',
      });
    }
  });

export const coachProfileUpdateSchema = z
  .object({
    cefrLevel: cefrLevelSchema.nullable().optional(),
    goalType: z
      .enum(['GENERAL', 'EXAM', 'BUSINESS', 'TRAVEL', 'CUSTOM'])
      .nullable()
      .optional(),
    goalText: z.string().max(500).nullable().optional(),
    activeCourseId: z.string().nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one profile field is required',
  });

export const exercisePreferencesSchema = z
  .object({
    types: z
      .array(exerciseTypeSchema)
      .min(1)
      .max(4)
      .refine((items) => new Set(items).size === items.length, {
        message: 'types must be unique',
      })
      .optional(),
    count: z.number().int().min(1).max(20).optional(),
    topic: z.string().max(500).optional(),
  })
  .strict();

export const coachMessageRequestSchema = z
  .object({
    type: z.literal('MESSAGE'),
    message: z.string().trim().min(1).max(8000),
    intentHint: z
      .enum(['ANSWER', 'CORRECTION', 'CREATE_EXERCISE'])
      .optional(),
    exercisePreferences: exercisePreferencesSchema.optional(),
  })
  .strict();

export const coachExerciseSubmissionRequestSchema = z
  .object({
    type: z.literal('EXERCISE_SUBMISSION'),
    exerciseId: z.string().min(10).max(64),
    answers: z.array(exerciseAnswerSchema).min(1).max(50),
  })
  .strict();

export const coachRecommendationRequestSchema = z
  .object({
    type: z.literal('RECOMMENDATION'),
    assessmentId: z.string().min(10).max(64).optional(),
  })
  .strict();

export const createCoachRequestSchema = z.discriminatedUnion('type', [
  coachMessageRequestSchema,
  coachExerciseSubmissionRequestSchema,
  coachRecommendationRequestSchema,
]);

export const createCoachConversationSchema = z
  .object({ title: z.string().trim().min(1).max(120).optional() })
  .strict();

export const coachConversationSchema = z
  .object({
    id: z.string(),
    title: z.string().max(120).nullable(),
    status: z.enum(['ACTIVE', 'DELETING', 'DELETED', 'EXPIRED']),
    lastActivityAt: isoDateTime,
    expiresAt: isoDateTime,
    createdAt: isoDateTime,
  })
  .strict();

export const coachMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['USER', 'COACH']),
    content: z.string().nullable(),
    structuredResult: anyPublicCoachResultSchema.nullable(),
    createdAt: isoDateTime,
  })
  .strict();

export const coachRequestAcceptedSchema = z
  .object({
    requestId: z.string(),
    conversationId: z.string(),
    status: z.enum(['CREATED', 'QUEUED']),
    streamUrl: z.string().min(1).max(500),
    traceId: z.string().min(10).max(64),
  })
  .strict();

export const coachRequestSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    inputType: z.enum(['MESSAGE', 'EXERCISE_SUBMISSION', 'RECOMMENDATION']),
    retryOfRequestId: z.string().nullable(),
    intent: z
      .enum([
        'ANSWER',
        'CORRECTION',
        'CREATE_EXERCISE',
        'GRADE_ANSWER',
        'REVIEW_RECOMMENDATION',
        'UNKNOWN',
      ])
      .nullable(),
    status: coachRequestStatusSchema,
    finalResult: anyPublicCoachResultSchema.nullable(),
    error: z
      .object({
        code: coachPublicErrorCodeSchema,
        message: z.string().min(1).max(500),
        retryable: z.boolean(),
      })
      .strict()
      .nullable(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    traceId: z.string().min(10).max(64),
    startedAt: isoDateTime.nullable(),
    finishedAt: isoDateTime.nullable(),
  })
  .strict();

export const coachFeedbackInputSchema = z
  .object({
    rating: z.enum(['UP', 'DOWN']),
    category: z
      .enum(['INCORRECT', 'TOO_HARD', 'TOO_EASY', 'IRRELEVANT', 'UNSAFE', 'OTHER'])
      .nullable()
      .optional(),
    comment: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const deleteCoachDataSchema = z
  .object({ confirmation: z.literal('DELETE_COACH_DATA') })
  .strict();

export type CoachProfile = z.infer<typeof coachProfileSchema>;
export type CoachProfileUpdate = z.infer<typeof coachProfileUpdateSchema>;
export type CreateCoachRequest = z.infer<typeof createCoachRequestSchema>;
export type CoachRequest = z.infer<typeof coachRequestSchema>;
export type CoachFeedbackInput = z.infer<typeof coachFeedbackInputSchema>;
