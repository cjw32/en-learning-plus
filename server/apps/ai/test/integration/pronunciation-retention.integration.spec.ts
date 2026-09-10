import { beforeEach } from '@jest/globals';
import { PronunciationAudioAccessService } from '../../src/pronunciation/api/pronunciation-audio.controller';
import { PronunciationCleanupProcessor } from '../../src/pronunciation/queue/pronunciation-cleanup.processor';

describe('pronunciation retention and revocation', () => {
  const clock = { now: new Date('2026-09-10T00:00:00.000Z') };

  beforeEach(() => {
    clock.now = new Date('2026-09-10T00:00:00.000Z');
  });

  it('revokes access immediately and rejects expired 24-hour audio', async () => {
    const row = {
      subjectId: 'user-a',
      objectKey: 'pronunciation/canonical/opaque',
      mediaType: 'audio/wav',
      byteSize: 4,
      expiresAt: new Date('2026-09-11T00:00:00.000Z'),
      accessRevokedAt: null as Date | null,
    };
    const service = new PronunciationAudioAccessService(
      { findOwnedReadableAudio: jest.fn(async () => row) } as never,
      { read: jest.fn(async () => Uint8Array.from([1, 2, 3, 4])) } as never,
      () => clock.now,
    );

    await expect(
      service.open('user-a', 'assessment_1', null),
    ).resolves.toMatchObject({
      statusCode: 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
    row.accessRevokedAt = clock.now;
    await expect(
      service.open('user-a', 'assessment_1', null),
    ).resolves.toBeNull();
    row.accessRevokedAt = null;
    clock.now = new Date('2026-09-11T00:00:00.000Z');
    await expect(
      service.open('user-a', 'assessment_1', null),
    ).resolves.toBeNull();
  });

  it('serves one bounded byte range with private no-store headers', async () => {
    const service = new PronunciationAudioAccessService(
      {
        findOwnedReadableAudio: jest.fn(async () => ({
          subjectId: 'user-a',
          objectKey: 'pronunciation/canonical/range',
          mediaType: 'audio/wav',
          byteSize: 5,
          expiresAt: new Date('2026-09-10T01:00:00.000Z'),
          accessRevokedAt: null,
        })),
      } as never,
      { read: jest.fn(async () => Uint8Array.from([0, 1, 2, 3, 4])) } as never,
      () => clock.now,
    );

    await expect(
      service.open('user-a', 'assessment_1', 'bytes=1-3'),
    ).resolves.toEqual({
      statusCode: 206,
      bytes: Uint8Array.from([1, 2, 3]),
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': '3',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'Content-Range': 'bytes 1-3/5',
      },
    });
  });

  it('allows only one clustered purge claim and completes inside one hour', async () => {
    const jobs = [
      {
        tombstoneId: 'delete_1',
        objectKey: 'pronunciation/canonical/opaque',
        purgeDeadline: new Date('2026-09-10T01:00:00.000Z'),
      },
    ];
    let claimed = false;
    const repository = {
      claimDue: jest.fn(async () => {
        if (claimed) return [];
        claimed = true;
        return jobs;
      }),
      complete: jest.fn(async () => undefined),
      retry: jest.fn(async () => undefined),
    };
    const storage = { purge: jest.fn(async () => undefined) };
    const first = new PronunciationCleanupProcessor(repository, storage);
    const second = new PronunciationCleanupProcessor(repository, storage);

    await Promise.all([
      first.processDue(clock.now),
      second.processDue(clock.now),
    ]);

    expect(storage.purge).toHaveBeenCalledTimes(1);
    expect(repository.complete).toHaveBeenCalledWith('delete_1', clock.now);
    expect(clock.now.getTime()).toBeLessThanOrEqual(
      jobs[0].purgeDeadline.getTime(),
    );
  });

  it('leaves a transient purge failure retryable', async () => {
    const repository = {
      claimDue: jest.fn(async () => [
        {
          tombstoneId: 'delete_2',
          objectKey: 'pronunciation/canonical/retry',
          purgeDeadline: new Date('2026-09-10T01:00:00.000Z'),
        },
      ]),
      complete: jest.fn(),
      retry: jest.fn(async () => undefined),
    };
    const storage = {
      purge: jest.fn(async () => Promise.reject(new Error('temporary'))),
    };
    const processor = new PronunciationCleanupProcessor(repository, storage);

    await processor.processDue(clock.now);

    expect(repository.retry).toHaveBeenCalledWith('delete_2', 'PURGE_RETRY');
    expect(repository.complete).not.toHaveBeenCalled();
  });
});
