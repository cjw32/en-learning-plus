import type { LearningDataCleanupPort } from './learning-data-cleanup.port';
import { LearningDataDeletionService } from './learning-data-deletion.service';

describe('LearningDataDeletionService cleanup collaborator registry', () => {
  it('calls a registered collaborator exactly once in each established deletion phase', async () => {
    const order: string[] = [];
    const repository = {
      hideImmediately: jest.fn(async () => order.push('database-hide')),
      purgeOwnedData: jest.fn(async () => order.push('database-purge')),
    };
    const cleanup: LearningDataCleanupPort = {
      cleanupKey: 'mcp',
      hideImmediately: jest.fn(async () => order.push('mcp-hide')),
      purgeOwnedData: jest.fn(async () => order.push('mcp-purge')),
    };
    const service = new LearningDataDeletionService(repository, [cleanup]);

    await service.hideImmediately(
      'user-a',
      new Date('2026-09-11T08:00:00.000Z'),
    );
    await service.purgeOwnedData('user-a');

    expect(cleanup.hideImmediately).toHaveBeenCalledTimes(1);
    expect(cleanup.purgeOwnedData).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      'database-hide',
      'mcp-hide',
      'mcp-purge',
      'database-purge',
    ]);
  });

  it('deduplicates idempotent registration by collaborator key', async () => {
    const repository = {
      hideImmediately: jest.fn(async () => undefined),
      purgeOwnedData: jest.fn(async () => undefined),
    };
    const cleanup: LearningDataCleanupPort = {
      cleanupKey: 'mcp',
      hideImmediately: jest.fn(async () => undefined),
      purgeOwnedData: jest.fn(async () => undefined),
    };
    const service = new LearningDataDeletionService(repository);
    service.registerCleanup(cleanup);
    service.registerCleanup(cleanup);

    await service.hideImmediately('user-a', new Date());

    expect(cleanup.hideImmediately).toHaveBeenCalledTimes(1);
  });

  it('rejects two different collaborators claiming the same registry key', () => {
    const repository = {
      hideImmediately: jest.fn(async () => undefined),
      purgeOwnedData: jest.fn(async () => undefined),
    };
    const first: LearningDataCleanupPort = {
      cleanupKey: 'mcp',
      hideImmediately: jest.fn(),
      purgeOwnedData: jest.fn(),
    };
    const second: LearningDataCleanupPort = {
      cleanupKey: 'mcp',
      hideImmediately: jest.fn(),
      purgeOwnedData: jest.fn(),
    };
    const service = new LearningDataDeletionService(repository, [first]);

    expect(() => service.registerCleanup(second)).toThrow(
      'Duplicate learning-data cleanup key: mcp',
    );
  });
});
