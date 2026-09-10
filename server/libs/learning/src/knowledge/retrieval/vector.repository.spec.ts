import {
  PrismaKnowledgeVectorRepository,
  serializeKnowledgeVector,
} from './vector.repository';

describe('knowledge vector repository foundation', () => {
  it('serializes only finite non-zero vectors', () => {
    expect(serializeKnowledgeVector([1, 0.5, -0.25])).toBe('[1,0.5,-0.25]');
    expect(() => serializeKnowledgeVector([0, 0])).toThrow(
      'EMBEDDING_RESPONSE_INVALID',
    );
    expect(() => serializeKnowledgeVector([Number.NaN])).toThrow(
      'EMBEDDING_RESPONSE_INVALID',
    );
  });

  it('uses a tagged Prisma statement for vector writes', async () => {
    const executeRaw = jest.fn(async () => 1);
    const repository = new PrismaKnowledgeVectorRepository({
      $executeRaw: executeRaw,
      $queryRaw: jest.fn(),
    } as never);

    await repository.storeReadyEmbedding({
      embeddingId: 'embedding_test_001',
      chunkId: 'chunk_test_001',
      provider: 'fake',
      model: 'deterministic',
      dimensions: 2,
      embeddingVersion: 'embedding.fake.2d.v1',
      inputHash: 'hash_test_001',
      vector: [1, 0],
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(Array.isArray(executeRaw.mock.calls[0]?.[0]?.values)).toBe(true);
  });
});
