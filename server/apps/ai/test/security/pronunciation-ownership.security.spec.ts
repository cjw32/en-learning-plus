import { PronunciationAudioAccessService } from '../../src/pronunciation/api/pronunciation-audio.controller';
import { PronunciationRetryService } from '../../src/pronunciation/application/pronunciation-retry.service';
import { PronunciationCancellationService } from '../../src/pronunciation/governance/pronunciation-cancellation.service';
import { PronunciationDeletionService } from '../../src/pronunciation/privacy/pronunciation-deletion.service';

describe('pronunciation two-subject ownership boundary', () => {
  const now = new Date('2026-09-10T00:00:00.000Z');

  it('makes cross-owner and random audio reads indistinguishable', async () => {
    const storage = { read: jest.fn(async () => Uint8Array.from([1, 2, 3])) };
    const repository = {
      findOwnedReadableAudio: jest.fn(async (subjectId: string, id: string) =>
        subjectId === 'user-a' && id === 'assessment-owned'
          ? {
              subjectId: 'user-a',
              objectKey: 'pronunciation/canonical/opaque',
              mediaType: 'audio/wav',
              byteSize: 3,
              expiresAt: new Date('2026-09-10T01:00:00.000Z'),
              accessRevokedAt: null,
            }
          : null,
      ),
    };
    const service = new PronunciationAudioAccessService(
      repository as never,
      storage as never,
      () => now,
    );

    const crossOwner = await service.open('user-b', 'assessment-owned', null);
    const random = await service.open('user-b', 'assessment-random', null);

    expect(crossOwner).toBeNull();
    expect(random).toBeNull();
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('returns no successful cross-owner delete and never leaks the target', async () => {
    const repository = {
      request: jest.fn(async () => null),
      findStatus: jest.fn(async () => null),
    };
    const storage = { revoke: jest.fn() };
    const service = new PronunciationDeletionService(
      repository as never,
      storage as never,
      { compensate: jest.fn() } as never,
      () => now,
      'test-pepper',
    );
    const input = {
      subjectId: 'user-b',
      assessmentId: 'assessment-owned',
      scope: 'PRONUNCIATION_ASSESSMENT' as const,
      idempotencyKey: 'delete-key-00000001',
    };

    const crossOwner = await service.request(input);
    const random = await service.request({
      ...input,
      assessmentId: 'assessment-random',
    });

    expect(crossOwner).toEqual(random);
    expect(crossOwner).toBeNull();
    expect(storage.revoke).not.toHaveBeenCalled();
  });

  it('makes cross-owner and random retry attempts indistinguishable', async () => {
    const repository = {
      findOwnedWithTarget: jest.fn(async () => null),
      createIdempotent: jest.fn(),
    };
    const service = new PronunciationRetryService(
      repository as never,
      { captureEnabled: true } as never,
      () => 'new-id',
      () => now,
    );
    const failures: unknown[] = [];
    for (const assessmentId of ['assessment-owned', 'assessment-random']) {
      try {
        await service.retry({
          subjectId: 'user-b',
          assessmentId,
          idempotencyKey: `retry-${assessmentId}-00001`,
        });
      } catch (error) {
        failures.push(error);
      }
    }
    expect(failures).toHaveLength(2);
    expect(failures.map((error: any) => error.code)).toEqual([
      'RESOURCE_NOT_FOUND',
      'RESOURCE_NOT_FOUND',
    ]);
    expect(repository.createIdempotent).not.toHaveBeenCalled();
  });

  it('makes cross-owner and random cancellation attempts indistinguishable', async () => {
    const repository = {
      findOwned: jest.fn(async () => null),
      markCancellationRequested: jest.fn(),
    };
    const signals = { set: jest.fn(), has: jest.fn() };
    const service = new PronunciationCancellationService(
      repository as never,
      signals as never,
      () => now,
    );
    const failures: unknown[] = [];
    for (const assessmentId of ['assessment-owned', 'assessment-random']) {
      try {
        await service.cancel({
          subjectId: 'user-b',
          assessmentId,
          idempotencyKey: `cancel-${assessmentId}-0001`,
        });
      } catch (error) {
        failures.push(error);
      }
    }
    expect(failures).toHaveLength(2);
    expect(failures.map((error: any) => error.code)).toEqual([
      'RESOURCE_NOT_FOUND',
      'RESOURCE_NOT_FOUND',
    ]);
    expect(repository.markCancellationRequested).not.toHaveBeenCalled();
    expect(signals.set).not.toHaveBeenCalled();
  });
});
