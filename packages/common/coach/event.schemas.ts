import { z } from 'zod';
import { coachResultSchema } from './result.schemas';

export const COACH_SSE_SCHEMA_VERSION = 'coach.sse.v1' as const;

export const coachRequestStatusSchema = z.enum([
  'CREATED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
  'TIMED_OUT',
  'BUDGET_EXCEEDED',
  'FAILED',
]);

export const coachPublicErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'TOKEN_INVALID',
  'FORBIDDEN',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_FAILED',
  'SCHEMA_INVALID',
  'MATERIAL_NOT_AVAILABLE',
  'MODEL_UNAVAILABLE',
  'TOOL_TIMEOUT',
  'REQUEST_TIMEOUT',
  'BUDGET_EXCEEDED',
  'RATE_LIMITED',
  'IDEMPOTENCY_CONFLICT',
  'STATE_CONFLICT',
  'CANCELLED',
  'INTERNAL_ERROR',
]);

const saveStatusSchema = z.enum([
  'NOT_STARTED',
  'NOT_SAVED',
  'SAVED_ONCE',
  'NOT_APPLICABLE',
]);
const envelope = {
  schemaVersion: z.literal(COACH_SSE_SCHEMA_VERSION),
  eventId: z.string().min(1).max(100),
  requestId: z.string().min(10).max(64),
  sequence: z.number().int().min(0),
  timestamp: z.iso.datetime({ offset: true }),
};
const event = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ ...envelope, type: z.literal(type), payload }).strict();

export const coachConnectedEventSchema = event(
  'connected',
  z
    .object({
      status: coachRequestStatusSchema,
      replayedThrough: z.number().int().min(0).nullable(),
    })
    .strict(),
);
export const coachStatusEventSchema = event(
  'status',
  z
    .object({
      step: z.enum([
        'validating',
        'understanding',
        'personalizing',
        'finding_materials',
        'generating',
        'grading',
        'saving',
        'recommending',
        'finalizing',
      ]),
      label: z.string().min(1).max(200),
    })
    .strict(),
);
export const coachToolStatusEventSchema = event(
  'tool_status',
  z
    .object({
      tool: z.enum([
        'get_learner_profile',
        'get_due_words',
        'search_learning_materials',
        'create_exercise',
        'grade_answer',
        'save_attempt',
      ]),
      state: z.enum(['started', 'succeeded', 'failed', 'skipped']),
      label: z.string().min(1).max(200),
      retryable: z.boolean().nullable(),
    })
    .strict(),
);
export const coachContentDeltaEventSchema = event(
  'content_delta',
  z
    .object({
      channel: z.enum(['explanation', 'correction', 'example', 'progress']),
      delta: z.string().min(1).max(4000),
    })
    .strict(),
);
export const coachResultEventSchema = event(
  'result',
  z.object({ result: coachResultSchema }).strict(),
);
export const coachCompletedEventSchema = event(
  'completed',
  z
    .object({
      status: z.literal('COMPLETED'),
      resultEventId: z.string().min(1).max(100),
      learningSaveStatus: z.enum([
        'saved',
        'replayed',
        'not_saved',
        'not_applicable',
      ]),
    })
    .strict(),
);
export const coachCancelledEventSchema = event(
  'cancelled',
  z
    .object({
      status: z.literal('CANCELLED'),
      saveStatus: saveStatusSchema,
      message: z.string().min(1).max(500),
    })
    .strict(),
);
export const coachErrorEventSchema = event(
  'error',
  z
    .object({
      code: coachPublicErrorCodeSchema,
      message: z.string().min(1).max(500),
      retryable: z.boolean(),
      retryAfterSeconds: z.number().int().min(0).nullable(),
      saveStatus: saveStatusSchema,
    })
    .strict(),
);
export const coachHeartbeatEventSchema = event(
  'heartbeat',
  z.object({}).strict(),
);

export const coachSseEventSchema = z.discriminatedUnion('type', [
  coachConnectedEventSchema,
  coachStatusEventSchema,
  coachToolStatusEventSchema,
  coachContentDeltaEventSchema,
  coachResultEventSchema,
  coachCompletedEventSchema,
  coachCancelledEventSchema,
  coachErrorEventSchema,
  coachHeartbeatEventSchema,
]);

export type CoachSseEvent = z.infer<typeof coachSseEventSchema>;
export type CoachRequestStatus = z.infer<typeof coachRequestStatusSchema>;
