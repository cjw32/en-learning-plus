import {
  InMemoryKnowledgeReleaseRepository,
  KnowledgeReleaseService,
} from '@libs/learning';

describe('knowledge re-embedding release switch', () => {
  it('keeps the old release active through failed update/re-embedding attempts', async () => {
    const repository = new InMemoryKnowledgeReleaseRepository();
    const service = new KnowledgeReleaseService(repository);
    repository.seed([
      {
        id: 'release-old',
        scopeKey: 'course:lesson-1',
        contentVersion: 'content.v1',
        expectedChunkCount: 2,
        readyEmbeddingCount: 2,
        status: 'ACTIVE',
      },
      {
        id: 'release-failed-update',
        scopeKey: 'course:lesson-1',
        contentVersion: 'content.v2',
        expectedChunkCount: 2,
        readyEmbeddingCount: 1,
        status: 'BUILDING',
      },
    ]);
    await service.invalidate('release-failed-update');
    expect(repository.activeForScope('course:lesson-1')).toMatchObject({
      id: 'release-old',
      contentVersion: 'content.v1',
    });
  });

  it('switches only after the new compatible set is complete', async () => {
    const repository = new InMemoryKnowledgeReleaseRepository();
    const service = new KnowledgeReleaseService(repository);
    repository.seed([
      {
        id: 'release-old',
        scopeKey: 'course:lesson-1',
        contentVersion: 'content.v1',
        expectedChunkCount: 2,
        readyEmbeddingCount: 2,
        status: 'ACTIVE',
      },
      {
        id: 'release-reembedded',
        scopeKey: 'course:lesson-1',
        contentVersion: 'content.v2',
        expectedChunkCount: 2,
        readyEmbeddingCount: 2,
        status: 'BUILDING',
      },
    ]);
    await service.markReady('release-reembedded');
    await service.activate('release-reembedded');
    expect(repository.activeForScope('course:lesson-1')).toMatchObject({
      id: 'release-reembedded',
      contentVersion: 'content.v2',
    });
    expect(repository.snapshot()).toEqual([
      expect.objectContaining({ id: 'release-old', status: 'SUPERSEDED' }),
      expect.objectContaining({ id: 'release-reembedded', status: 'ACTIVE' }),
    ]);
  });
});
