import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  pronunciationAssessmentPageResponseSchema,
  pronunciationAssessmentResponseSchema,
  pronunciationErrorResponseSchema,
  pronunciationDeletionResponseSchema,
} from '@en/common/pronunciation';

const openApi = readFileSync(
  resolve(
    process.cwd(),
    '../specs/003-pronunciation-assessment/contracts/pronunciation-api.openapi.yaml',
  ),
  'utf8',
);

const assessment = {
  assessmentId: 'assessment_1',
  status: 'AUDIO_READY',
  exerciseType: 'WORD',
  locale: 'en-US',
  referenceText: 'hello',
  retryOfAssessmentId: null,
  result: null,
  diagnostic: null,
  learningWriteStatus: 'NOT_ELIGIBLE',
  audio: {
    status: 'READY',
    available: true,
    expiresAt: '2026-09-11T00:00:00.000Z',
  },
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:01.000Z',
  traceId: 'trace_1',
};

describe('pronunciation public API contract', () => {
  it.each([
    ['create', '/pronunciation/assessments:', 'post:', 201],
    ['upload', '/pronunciation/assessments/{assessmentId}/audio:', 'put:', 200],
    [
      'submit',
      '/pronunciation/assessments/{assessmentId}/submit:',
      'post:',
      202,
    ],
    ['retry', '/pronunciation/assessments/{assessmentId}/retry:', 'post:', 201],
    ['get', '/pronunciation/assessments/{assessmentId}:', 'get:', 200],
    ['list', '/pronunciation/assessments:', 'get:', 200],
    [
      'delete full',
      '/pronunciation/assessments/{assessmentId}:',
      'delete:',
      202,
    ],
    [
      'delete audio',
      '/pronunciation/assessments/{assessmentId}/audio:',
      'delete:',
      202,
    ],
    ['deletion status', '/pronunciation/deletions/{deletionId}:', 'get:', 200],
  ])('declares the %s lifecycle operation', (_name, path, method, status) => {
    const pathStart = openApi.indexOf(`  ${path}`);
    expect(pathStart).toBeGreaterThan(-1);
    const nextPath = openApi.indexOf('\n  /pronunciation/', pathStart + 3);
    const operation = openApi.slice(
      pathStart,
      nextPath === -1 ? openApi.length : nextPath,
    );
    expect(operation).toContain(`    ${method}`);
    expect(operation).toMatch(new RegExp(`["']${status}["']:`));
  });

  it.each([201, 200, 202])(
    'accepts strict assessment envelopes for HTTP %i',
    (code) => {
      expect(
        pronunciationAssessmentResponseSchema.parse({ code, data: assessment }),
      ).toEqual({ code, data: assessment });
      expect(
        pronunciationAssessmentResponseSchema.safeParse({
          code,
          data: { ...assessment, objectKey: 'private/audio.webm' },
        }).success,
      ).toBe(false);
    },
  );

  it('accepts a strict owned page and bounded cursor', () => {
    expect(
      pronunciationAssessmentPageResponseSchema.parse({
        code: 200,
        data: { items: [assessment], nextCursor: 'cursor_1' },
      }).data.items,
    ).toHaveLength(1);
    expect(
      pronunciationAssessmentPageResponseSchema.safeParse({
        code: 200,
        data: { items: [], nextCursor: 'x'.repeat(513) },
      }).success,
    ).toBe(false);
  });

  it('accepts only stable HTTP-safe error envelopes', () => {
    const error = {
      code: 429,
      error: {
        code: 'RATE_LIMITED',
        category: 'GOVERNANCE',
        message: '请求过于频繁，请稍后重试。',
        retryable: true,
        retryAfterSeconds: 60,
        assessmentId: 'assessment_1',
        traceId: 'trace_1',
      },
    };
    expect(pronunciationErrorResponseSchema.parse(error)).toEqual(error);
    expect(
      pronunciationErrorResponseSchema.safeParse({
        ...error,
        error: { ...error.error, stack: 'internal stack' },
      }).success,
    ).toBe(false);
  });

  it('accepts only an opaque deletion status without resource identity', () => {
    const response = {
      code: 202,
      data: {
        deletionId: 'delete_00000000001',
        scope: 'PRONUNCIATION_AUDIO',
        status: 'ACCEPTED',
        accessRevokedAt: '2026-09-10T00:00:00.000Z',
        purgeDeadline: '2026-09-10T01:00:00.000Z',
        completedAt: null,
      },
    } as const;
    expect(pronunciationDeletionResponseSchema.parse(response)).toEqual(
      response,
    );
    expect(
      pronunciationDeletionResponseSchema.safeParse({
        ...response,
        data: { ...response.data, assessmentId: 'assessment-secret' },
      }).success,
    ).toBe(false);
  });
});
