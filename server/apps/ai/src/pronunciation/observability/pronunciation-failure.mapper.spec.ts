import { z } from '@en/common/coach/zod';
import { PronunciationIdempotencyConflictError } from '../application/pronunciation.repository';
import {
  mapPronunciationFailure,
  PronunciationFailureError,
} from './pronunciation-failure.mapper';

describe('mapPronunciationFailure', () => {
  it.each([
    ['AUTH_REQUIRED', 401, 'AUTH', false],
    ['RESOURCE_NOT_FOUND', 404, 'TARGET', false],
    ['AUDIO_TOO_LARGE', 413, 'UPLOAD', true],
    ['AUDIO_INVALID', 400, 'AUDIO', true],
    ['RATE_LIMITED', 429, 'GOVERNANCE', true],
    ['PROVIDER_TIMEOUT', 504, 'PROVIDER', true],
    ['LEARNING_WRITE_FAILED', 503, 'LEARNING', true],
  ] as const)(
    'maps %s to a stable public envelope',
    (code, statusCode, category, retryable) => {
      expect(
        mapPronunciationFailure(new PronunciationFailureError(code), {
          assessmentId: 'assessment_1',
          traceId: 'trace_1',
        }),
      ).toEqual({
        code,
        statusCode,
        category,
        retryable,
        retryAfterSeconds: null,
        assessmentId: 'assessment_1',
        traceId: 'trace_1',
        message: expect.any(String),
      });
    },
  );

  it('maps schema and idempotency failures without exposing internals', () => {
    const schemaFailure = mapPronunciationFailure(
      z.string().parse.bind(z.string(), 123),
    );
    expect(schemaFailure.code).toBe('INTERNAL_ERROR');

    let zodFailure: unknown;
    try {
      z.string().parse(123);
    } catch (error) {
      zodFailure = error;
    }
    expect(mapPronunciationFailure(zodFailure).code).toBe('VALIDATION_FAILED');
    expect(
      mapPronunciationFailure(new PronunciationIdempotencyConflictError()).code,
    ).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('does not leak raw messages, stacks, endpoints or credentials', () => {
    const unsafe = Object.assign(
      new Error('Bearer secret-token at https://internal.example/object-key'),
      { stack: 'sensitive stack', code: 'NOT_ALLOWLISTED' },
    );
    const serialized = JSON.stringify(mapPronunciationFailure(unsafe));

    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('internal.example');
    expect(serialized).not.toContain('object-key');
    expect(serialized).not.toContain('sensitive stack');
    expect(serialized).toContain('INTERNAL_ERROR');
  });

  it('bounds Retry-After and only emits it for retryable failures', () => {
    expect(
      mapPronunciationFailure(
        new PronunciationFailureError('RATE_LIMITED', 999_999),
      ).retryAfterSeconds,
    ).toBe(86_400);
    expect(
      mapPronunciationFailure(
        new PronunciationFailureError('VALIDATION_FAILED', 10),
      ).retryAfterSeconds,
    ).toBeNull();
  });
});
