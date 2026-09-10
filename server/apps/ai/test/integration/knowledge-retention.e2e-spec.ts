import {
  InMemoryKnowledgeInvalidationRepository,
  KnowledgeInvalidationService,
} from '@libs/learning';

describe('knowledge invalidation and retention lifecycle', () => {
  it.each([
    ['REVOKED', 'ACCESS_REVOKED'],
    ['EXPIRED', 'SOURCE_INVALID'],
    ['DELETED', 'SOURCE_DELETED'],
  ] as const)(
    'immediately hides %s sources, redacts citations, and clears affected replay',
    async (sourceStatus, citationStatus) => {
      const repository = new InMemoryKnowledgeInvalidationRepository();
      repository.seed({
        sourceId: 'source-lifecycle',
        releaseIds: ['release-lifecycle'],
        documentIds: ['document-lifecycle'],
        chunkIds: ['chunk-lifecycle'],
        citations: [
          {
            id: 'cit_lifecycle_000001',
            requestId: 'request-lifecycle',
            excerpt: 'LIFECYCLE_PRIVATE_CANARY',
          },
        ],
      });
      const replay = { purgeRequests: jest.fn().mockResolvedValue(undefined) };
      const service = new KnowledgeInvalidationService(repository, replay);
      await service.invalidateSource('source-lifecycle', sourceStatus);

      const snapshot = repository.snapshot();
      expect(snapshot.releases[0]?.status).toBe('INVALID');
      expect(snapshot.documents[0]?.status).toBe('INVALID');
      expect(snapshot.chunks[0]?.status).toBe('INVALID');
      expect(snapshot.citations[0]).toMatchObject({
        status: citationStatus,
        excerpt: null,
        sourceId: null,
      });
      expect(replay.purgeRequests).toHaveBeenCalledWith(['request-lifecycle']);
      expect(JSON.stringify(snapshot)).not.toContain(
        'LIFECYCLE_PRIVATE_CANARY',
      );
    },
  );

  it('purges only invalid data whose approved retention deadline has elapsed', async () => {
    const repository = new InMemoryKnowledgeInvalidationRepository();
    repository.seed({
      sourceId: 'source-retention',
      releaseIds: ['release-retention'],
      documentIds: ['document-retention'],
      chunkIds: ['chunk-retention'],
      citations: [],
    });
    const service = new KnowledgeInvalidationService(repository, {
      purgeRequests: jest.fn(),
    });
    const hiddenAt = new Date('2026-09-09T00:00:00.000Z');
    await service.invalidateSource('source-retention', 'DELETED', hiddenAt);
    await service.purgeDue(
      new Date('2026-09-09T23:59:59.999Z'),
      24 * 60 * 60 * 1000,
    );
    expect(repository.snapshot().documents).toHaveLength(1);
    await service.purgeDue(
      new Date('2026-09-10T00:00:00.000Z'),
      24 * 60 * 60 * 1000,
    );
    expect(repository.snapshot().documents).toHaveLength(0);
    expect(repository.snapshot().chunks).toHaveLength(0);
  });
});
