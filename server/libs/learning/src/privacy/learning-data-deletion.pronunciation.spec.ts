import { LearningDataDeletionService } from './learning-data-deletion.service';

describe('LearningDataDeletionService pronunciation coverage', () => {
  it('explicitly revokes database, MinIO, cache, links and trace identity on hide', async () => {
    const order: string[] = [];
    const repository = {
      hideImmediately: jest.fn(async () => order.push('database-hide')),
      purgeOwnedData: jest.fn(),
    };
    const pronunciation = {
      revokeAudioAccess: jest.fn(async () => order.push('minio-revoke')),
      purgeCaches: jest.fn(async () => order.push('cache-purge')),
      revokeTemporaryLinks: jest.fn(async () => order.push('link-revoke')),
      unlinkTraceSubject: jest.fn(async () => order.push('trace-unlink')),
      purgeAudioObjects: jest.fn(),
    };
    const service = new LearningDataDeletionService(repository, pronunciation);

    await service.hideImmediately('user-a', new Date('2026-09-10T00:00:00Z'));

    expect(order).toEqual([
      'database-hide',
      'minio-revoke',
      'cache-purge',
      'link-revoke',
      'trace-unlink',
    ]);
  });

  it('purges audio objects before removing assessment rows', async () => {
    const order: string[] = [];
    const service = new LearningDataDeletionService(
      {
        hideImmediately: jest.fn(),
        purgeOwnedData: jest.fn(async () => order.push('database-purge')),
      },
      {
        revokeAudioAccess: jest.fn(),
        purgeCaches: jest.fn(),
        revokeTemporaryLinks: jest.fn(),
        unlinkTraceSubject: jest.fn(),
        purgeAudioObjects: jest.fn(async () => order.push('object-purge')),
      },
    );

    await service.purgeOwnedData('user-a');

    expect(order).toEqual(['object-purge', 'database-purge']);
  });
});
