import {
  InMemoryKnowledgeReleaseRepository,
  KnowledgeReleaseService,
} from '@libs/learning';

describe('knowledge release state machine', () => {
  it('never activates a partial release and retains the old active release', async () => {
    const repository = new InMemoryKnowledgeReleaseRepository();
    const service = new KnowledgeReleaseService(repository);
    repository.seed([
      {
        id: 'release-v1',
        scopeKey: 'word:harbor',
        contentVersion: 'content.v1',
        expectedChunkCount: 2,
        readyEmbeddingCount: 2,
        status: 'READY',
      },
      {
        id: 'release-v2',
        scopeKey: 'word:harbor',
        contentVersion: 'content.v2',
        expectedChunkCount: 2,
        readyEmbeddingCount: 1,
        status: 'BUILDING',
      },
    ]);

    await service.activate('release-v1');
    await expect(service.markReady('release-v2')).rejects.toThrow(
      'KNOWLEDGE_RELEASE_INCOMPLETE',
    );
    expect(repository.snapshot()).toEqual([
      expect.objectContaining({ id: 'release-v1', status: 'ACTIVE' }),
      expect.objectContaining({ id: 'release-v2', status: 'BUILDING' }),
    ]);
  });

  it('atomically activates one complete release and supersedes the prior version', async () => {
    const repository = new InMemoryKnowledgeReleaseRepository();
    const service = new KnowledgeReleaseService(repository);
    repository.seed([
      {
        id: 'release-v1',
        scopeKey: 'word:harbor',
        contentVersion: 'content.v1',
        expectedChunkCount: 1,
        readyEmbeddingCount: 1,
        status: 'ACTIVE',
      },
      {
        id: 'release-v2',
        scopeKey: 'word:harbor',
        contentVersion: 'content.v2',
        expectedChunkCount: 1,
        readyEmbeddingCount: 1,
        status: 'BUILDING',
      },
    ]);

    await service.markReady('release-v2');
    await service.activate('release-v2');
    expect(repository.snapshot()).toEqual([
      expect.objectContaining({ id: 'release-v1', status: 'SUPERSEDED' }),
      expect.objectContaining({ id: 'release-v2', status: 'ACTIVE' }),
    ]);
  });
});
