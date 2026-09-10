/* eslint-disable @typescript-eslint/no-unsafe-argument -- Synchronous typed test doubles preserve async ports, and Jest assertions intentionally inspect mock methods. */

import type { PronunciationRuntimeConfig } from '../governance/pronunciation-config.schema';
import {
  PronunciationIdempotencyConflictError,
  type OwnedPronunciationAssessment,
  type PronunciationRepository,
} from './pronunciation.repository';
import {
  PronunciationRetryError,
  PronunciationRetryService,
} from './pronunciation-retry.service';

const now = new Date('2026-09-10T00:00:00.000Z');
const original: OwnedPronunciationAssessment = {
  assessment: {
    id: 'assessment-original',
    subjectId: 'subject-1',
    clientIdempotencyKey: 'original-key-00001',
    requestBodyHash: 'original-hash',
    status: 'TIMED_OUT',
    exerciseType: 'WORD',
    deadlineAt: new Date('2026-09-09T00:00:30.000Z'),
    cancelRequestedAt: null,
    createdAt: new Date('2026-09-09T00:00:00.000Z'),
    updatedAt: new Date('2026-09-09T00:00:30.000Z'),
  },
  target: {
    sourceType: 'MANUAL',
    languageTag: 'en-US',
    referenceText: 'hello',
    normalizedTokens: ['hello'],
    targetHash: 'target-hash',
    wordId: null,
    courseId: null,
    knowledgeCitationId: null,
    coachRequestId: null,
    exerciseId: null,
    itemId: null,
    sourceRecordType: null,
    sourceRecordId: null,
    sourceVersion: null,
    sourceContentHash: null,
    sourceRightsVersion: null,
    authorizedAt: new Date('2026-09-09T00:00:00.000Z'),
    expiresAt: null,
  },
  audio: null,
  retryOfAssessmentId: null,
};

function harness() {
  const rows = new Map([[original.assessment.id, original]]);
  const keys = new Map<string, { hash: string; id: string }>();
  const repository = {
    findOwnedWithTarget: jest.fn(
      async (subjectId: string, assessmentId: string) => {
        const row = rows.get(assessmentId);
        return row?.assessment.subjectId === subjectId ? row : null;
      },
    ),
    createIdempotent: jest.fn(async (input: any) => {
      const key = `${input.subjectId}:${input.clientIdempotencyKey}`;
      const existing = keys.get(key);
      if (existing) {
        if (existing.hash !== input.requestBodyHash) {
          throw new PronunciationIdempotencyConflictError();
        }
        return {
          disposition: 'REPLAYED',
          assessment: rows.get(existing.id)!.assessment,
        };
      }
      const assessment = {
        id: input.id,
        subjectId: input.subjectId,
        clientIdempotencyKey: input.clientIdempotencyKey,
        requestBodyHash: input.requestBodyHash,
        status: 'CREATED' as const,
        exerciseType: input.exerciseType,
        deadlineAt: input.deadlineAt,
        cancelRequestedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(input.id, {
        assessment,
        target: input.target,
        audio: null,
        retryOfAssessmentId: input.retryOfAssessmentId,
      });
      keys.set(key, { hash: input.requestBodyHash, id: input.id });
      return { disposition: 'CREATED', assessment };
    }),
  } as unknown as PronunciationRepository;
  let sequence = 0;
  const config = { captureEnabled: true } as PronunciationRuntimeConfig;
  const service = new PronunciationRetryService(
    repository,
    config,
    () => `assessment-retry-${++sequence}`,
    () => now,
  );
  return { service, repository: repository as any, rows };
}

describe('PronunciationRetryService', () => {
  it('creates a fresh linked assessment and never overwrites prior history', async () => {
    const { service, repository, rows } = harness();
    const before = JSON.stringify(rows.get('assessment-original'));
    const result = await service.retry({
      subjectId: 'subject-1',
      assessmentId: 'assessment-original',
      idempotencyKey: 'retry-key-00000001',
    });
    expect(result).toMatchObject({
      assessment: {
        id: 'assessment-retry-1',
        status: 'CREATED',
        deadlineAt: new Date('2026-09-10T00:00:30.000Z'),
      },
      retryOfAssessmentId: 'assessment-original',
      target: original.target,
      audio: null,
    });
    expect(JSON.stringify(rows.get('assessment-original'))).toBe(before);
    expect(repository.createIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({ retryOfAssessmentId: 'assessment-original' }),
    );
  });

  it('replays the same retry key and conflicts if it is reused for another lineage', async () => {
    const { service, rows } = harness();
    const first = await service.retry({
      subjectId: 'subject-1',
      assessmentId: 'assessment-original',
      idempotencyKey: 'retry-key-00000001',
    });
    await expect(
      service.retry({
        subjectId: 'subject-1',
        assessmentId: 'assessment-original',
        idempotencyKey: 'retry-key-00000001',
      }),
    ).resolves.toEqual(first);
    rows.set('assessment-other', {
      ...original,
      assessment: { ...original.assessment, id: 'assessment-other' },
    });
    await expect(
      service.retry({
        subjectId: 'subject-1',
        assessmentId: 'assessment-other',
        idempotencyKey: 'retry-key-00000001',
      }),
    ).rejects.toBeInstanceOf(PronunciationIdempotencyConflictError);
  });

  it('uses indistinguishable not-found behavior and rejects active lineage roots', async () => {
    const { service, rows } = harness();
    await expect(
      service.retry({
        subjectId: 'subject-2',
        assessmentId: 'assessment-original',
        idempotencyKey: 'retry-key-00000001',
      }),
    ).rejects.toEqual(new PronunciationRetryError('RESOURCE_NOT_FOUND'));
    await expect(
      service.retry({
        subjectId: 'subject-2',
        assessmentId: 'random-id',
        idempotencyKey: 'retry-key-00000002',
      }),
    ).rejects.toEqual(new PronunciationRetryError('RESOURCE_NOT_FOUND'));
    rows.set('assessment-active', {
      ...original,
      assessment: {
        ...original.assessment,
        id: 'assessment-active',
        status: 'PROCESSING',
      },
    });
    await expect(
      service.retry({
        subjectId: 'subject-1',
        assessmentId: 'assessment-active',
        idempotencyKey: 'retry-key-00000003',
      }),
    ).rejects.toEqual(new PronunciationRetryError('STATE_CONFLICT'));
  });
});
