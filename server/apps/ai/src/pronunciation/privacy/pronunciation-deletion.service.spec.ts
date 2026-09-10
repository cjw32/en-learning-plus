import {
  PrismaPronunciationDeletionRepository,
  PronunciationDeletionService,
} from './pronunciation-deletion.service';

describe('PronunciationDeletionService', () => {
  it('is idempotent and sends only irreversible hashes to the tombstone repository', async () => {
    const saved = {
      deletionId: 'delete_00001',
      status: 'ACCEPTED' as const,
      hiddenAt: new Date('2026-09-10T00:00:00.000Z'),
      purgeDeadline: new Date('2026-09-10T01:00:00.000Z'),
      objectKey: 'pronunciation/canonical/opaque',
      deletedAttemptId: null,
    };
    const repository = {
      request: jest.fn(async () => saved),
      findStatus: jest.fn(),
      markFailed: jest.fn(),
    };
    const storage = { revoke: jest.fn(async () => undefined) };
    const service = new PronunciationDeletionService(
      repository as never,
      storage as never,
      { compensate: jest.fn() } as never,
      () => new Date('2026-09-10T00:00:00.000Z'),
      'test-pepper',
    );
    const input = {
      subjectId: 'user-a',
      assessmentId: 'assessment_00001',
      scope: 'PRONUNCIATION_AUDIO' as const,
      idempotencyKey: 'delete-key-00000001',
    };

    const first = await service.request(input);
    const replay = await service.request(input);

    expect(first).toEqual(replay);
    expect(repository.request).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: 'assessment_00001',
        subjectId: 'user-a',
        subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        resourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        idempotencyKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(first)).not.toMatch(
      /user-a|assessment_00001|objectKey|canonical/,
    );
    expect(storage.revoke).toHaveBeenCalledTimes(2);
  });

  it('hides a full assessment before compensation and keeps failure retryable', async () => {
    const repository = {
      request: jest.fn(async () => ({
        deletionId: 'delete_00002',
        status: 'COMPENSATING' as const,
        hiddenAt: new Date('2026-09-10T00:00:00.000Z'),
        purgeDeadline: new Date('2026-09-10T01:00:00.000Z'),
        objectKey: 'pronunciation/canonical/opaque',
        deletedAttemptId: 'attempt_00001',
      })),
      findStatus: jest.fn(),
      markFailed: jest.fn(async () => undefined),
    };
    const compensation = {
      compensate: jest.fn(async () => Promise.reject(new Error('retry'))),
    };
    const service = new PronunciationDeletionService(
      repository as never,
      { revoke: jest.fn(async () => undefined) } as never,
      compensation as never,
      () => new Date('2026-09-10T00:00:00.000Z'),
      'test-pepper',
    );

    const result = await service.request({
      subjectId: 'user-a',
      assessmentId: 'assessment_00001',
      scope: 'PRONUNCIATION_ASSESSMENT',
      idempotencyKey: 'delete-key-00000002',
    });

    expect(result).toMatchObject({ status: 'FAILED' });
    expect(repository.request.mock.invocationCallOrder[0]).toBeLessThan(
      compensation.compensate.mock.invocationCallOrder[0],
    );
    expect(repository.markFailed).toHaveBeenCalledWith(
      'delete_00002',
      'COMPENSATION_RETRY',
    );
  });

  it('returns a compensated deletion to the purge queue', async () => {
    const repository = {
      request: jest.fn(async () => ({
        deletionId: 'delete_00003',
        scope: 'PRONUNCIATION_ASSESSMENT' as const,
        status: 'COMPENSATING' as const,
        hiddenAt: new Date('2026-09-10T00:00:00.000Z'),
        purgeDeadline: new Date('2026-09-10T01:00:00.000Z'),
        objectKey: 'pronunciation/canonical/opaque',
        deletedAttemptId: 'attempt_00001',
        failureCode: null,
      })),
      findStatus: jest.fn(),
      markFailed: jest.fn(),
    };
    const compensation = {
      compensate: jest.fn(async () => ({ status: 'COMPENSATED' })),
    };
    const service = new PronunciationDeletionService(
      repository as never,
      { revoke: jest.fn(async () => undefined) } as never,
      compensation as never,
      () => new Date('2026-09-10T00:00:00.000Z'),
      'test-pepper',
    );

    await expect(
      service.request({
        subjectId: 'user-a',
        assessmentId: 'assessment_00001',
        scope: 'PRONUNCIATION_ASSESSMENT',
        idempotencyKey: 'delete-key-00000003',
      }),
    ).resolves.toMatchObject({ status: 'ACCEPTED' });
    expect(compensation.compensate).toHaveBeenCalledTimes(1);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('rejects reuse of one idempotency key across deletion scopes', async () => {
    const database = {
      pronunciationAssessment: {
        findFirst: jest.fn(async () => ({
          id: 'assessment_00001',
          hiddenAt: null,
          audioAsset: null,
          learningAttempt: null,
        })),
      },
      pronunciationDeletionTombstone: {
        findUnique: jest.fn(async () => ({
          resourceHash: 'same-resource',
          scope: 'PRONUNCIATION_AUDIO',
        })),
      },
    };
    const repository = new PrismaPronunciationDeletionRepository({
      $transaction: jest.fn(async (operation) => operation(database)),
    } as never);

    await expect(
      repository.request({
        subjectId: 'user-a',
        assessmentId: 'assessment_00001',
        scope: 'PRONUNCIATION_ASSESSMENT',
        subjectHash: 'subject-hash',
        resourceHash: 'same-resource',
        idempotencyKeyHash: 'same-key',
        requestedAt: new Date('2026-09-10T00:00:00.000Z'),
        purgeDeadline: new Date('2026-09-10T01:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
