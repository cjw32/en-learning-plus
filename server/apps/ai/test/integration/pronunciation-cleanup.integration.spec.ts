import { createHmac } from 'node:crypto';
import {
  PrismaPronunciationCleanupRepository,
  PronunciationCleanupProcessor,
} from '../../src/pronunciation/queue/pronunciation-cleanup.processor';

describe('PronunciationCleanupProcessor clustered recovery', () => {
  it('does not double-purge a durably claimed job', async () => {
    let available = true;
    const repository = {
      claimDue: jest.fn(async () => {
        if (!available) return [];
        available = false;
        return [
          {
            tombstoneId: 'delete_1',
            objectKey: 'pronunciation/canonical/1',
            purgeDeadline: new Date(),
          },
        ];
      }),
      complete: jest.fn(async () => undefined),
      retry: jest.fn(),
    };
    const storage = { purge: jest.fn(async () => undefined) };
    await Promise.all([
      new PronunciationCleanupProcessor(repository, storage).processDue(
        new Date(),
      ),
      new PronunciationCleanupProcessor(repository, storage).processDue(
        new Date(),
      ),
    ]);
    expect(storage.purge).toHaveBeenCalledTimes(1);
    expect(repository.complete).toHaveBeenCalledTimes(1);
  });

  it('releases a failed claim for retry without reporting completion', async () => {
    const repository = {
      claimDue: jest.fn(async () => [
        {
          tombstoneId: 'delete_2',
          objectKey: 'pronunciation/canonical/2',
          purgeDeadline: new Date(),
        },
      ]),
      complete: jest.fn(),
      retry: jest.fn(async () => undefined),
    };
    await new PronunciationCleanupProcessor(repository, {
      purge: jest.fn(async () => Promise.reject(new Error('transient'))),
    }).processDue(new Date());
    expect(repository.retry).toHaveBeenCalledWith('delete_2', 'PURGE_RETRY');
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('does not purge compensation failures and reclaims stale purge work', async () => {
    const tombstones = {
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(),
    };
    const audio = {
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(),
    };
    const database = {
      pronunciationDeletionTombstone: tombstones,
      pronunciationAssessment: { findMany: jest.fn(async () => []) },
      pronunciationAudioAsset: audio,
    };
    const repository = new PrismaPronunciationCleanupRepository(
      {
        $transaction: jest.fn(async (operation) => operation(database)),
      } as never,
      'test-pepper',
    );
    const now = new Date('2026-09-10T00:10:00.000Z');

    await repository.claimDue(now);

    expect(tombstones.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            { status: 'FAILED', failureCode: 'PURGE_RETRY', claimedAt: null },
            {
              status: 'PURGING',
              claimedAt: { lt: new Date('2026-09-10T00:05:00.000Z') },
            },
          ]),
        },
      }),
    );
    expect(
      JSON.stringify(tombstones.findMany.mock.calls[0]?.[0]),
    ).not.toContain('COMPENSATION_RETRY');
    expect(audio.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              status: 'PURGING',
              accessRevokedAt: {
                lte: new Date('2026-09-10T00:05:00.000Z'),
              },
            },
          ]),
        }),
      }),
    );
  });

  it('deletes hidden assessment detail only after object purge succeeds', async () => {
    const pepper = 'test-pepper';
    const assessmentId = 'assessment-private-1';
    const resource = createHmac('sha256', pepper)
      .update(`assessment\0${assessmentId}`)
      .digest('hex');
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const tombstoneUpdate = jest.fn(async () => ({ count: 1 }));
    const database = {
      pronunciationDeletionTombstone: {
        findUnique: jest.fn(async () => ({
          resourceHash: resource,
          scope: 'PRONUNCIATION_ASSESSMENT',
          status: 'PURGING',
        })),
        updateMany: tombstoneUpdate,
      },
      pronunciationAssessment: {
        findMany: jest.fn(async () => [
          {
            id: assessmentId,
            hiddenAt: new Date('2026-09-10T00:00:00.000Z'),
            audioAsset: { id: 'audio-1' },
          },
        ]),
        deleteMany,
      },
      pronunciationAudioAsset: { updateMany: jest.fn() },
    };
    const repository = new PrismaPronunciationCleanupRepository(
      {
        $transaction: jest.fn(async (operation) => operation(database)),
      } as never,
      pepper,
    );

    await repository.complete('delete_1', new Date('2026-09-10T00:30:00.000Z'));

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: assessmentId, hiddenAt: { not: null } },
    });
    expect(tombstoneUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delete_1', status: 'PURGING' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it('returns failed normal-expiry purges to a safely revoked retry state', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const repository = new PrismaPronunciationCleanupRepository(
      { pronunciationAudioAsset: { updateMany } } as never,
      'test-pepper',
    );

    await repository.retry('audio:audio-1', 'PURGE_RETRY');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'audio-1', status: 'PURGING' },
      data: { status: 'REVOKED' },
    });
  });
});
