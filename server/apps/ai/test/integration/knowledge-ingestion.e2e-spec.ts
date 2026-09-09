import {
  InMemoryKnowledgeSourceRightsRepository,
  KnowledgeContentValidator,
  SourceRightsService,
} from '@libs/learning';
import {
  InMemoryKnowledgeIngestionPersistence,
  KnowledgeIngestionService,
} from '@libs/learning/knowledge/ingestion/knowledge-ingestion.service';
import { PublicLearningChunker } from '@libs/learning/knowledge/ingestion/chunkers/public-learning.chunker';
import { FakeEmbeddingGateway } from '../../src/knowledge/embedding/fake-embedding.gateway';

describe('knowledge ingestion publication boundary', () => {
  const now = new Date('2026-09-08T00:00:00.000Z');

  function createService(embedding = new FakeEmbeddingGateway({
    dimensions: 8,
    embeddingVersion: 'embedding.fake.8d.v1',
  })) {
    const persistence = new InMemoryKnowledgeIngestionPersistence();
    const rights = new SourceRightsService(
      new InMemoryKnowledgeSourceRightsRepository([
        {
          sourceKey: 'synthetic-word-source',
          name: 'Synthetic word source',
          sourceType: 'WORD_BOOK',
          rightsVersion: 'rights.test.v1',
          status: 'ACTIVE',
          allowEmbedding: true,
          allowExcerptDisplay: true,
          allowEvaluation: true,
          verifiedAt: now,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2027-01-01T00:00:00.000Z'),
          fieldPolicies: [
            {
              recordType: 'WordBook',
              fieldName: 'definition',
              allowEmbedding: true,
              allowExcerptDisplay: true,
              allowEvaluation: true,
              contentCategory: 'WORD_MEANING',
              policyVersion: 'field-policy.v1',
            },
          ],
        },
      ]),
    );
    return {
      persistence,
      service: new KnowledgeIngestionService({
        rights,
        validator: new KnowledgeContentValidator({
          minimumMeaningfulLength: 12,
          maximumLength: 2000,
        }),
        chunker: new PublicLearningChunker({ chunkingVersion: 'chunking.v1' }),
        embedding,
        persistence,
      }),
    };
  }

  const input = {
    sourceKey: 'synthetic-word-source',
    recordType: 'WordBook',
    recordId: 'word_test_harbor',
    sourceId: 'word:word_test_harbor',
    title: 'harbor',
    wordId: 'word_test_harbor',
    level: 'B1',
    sourceUpdatedAt: now,
    fields: [
      {
        fieldName: 'definition',
        key: 'sense:noun:01',
        category: 'WORD_MEANING' as const,
        content: 'Harbor is a sheltered place for boats.',
      },
    ],
    versions: {
      contentVersion: 'content.test.v1',
      rightsVersion: 'rights.test.v1',
      chunkingVersion: 'chunking.v1',
      embeddingVersion: 'embedding.fake.8d.v1',
      retrievalConfigVersion: 'retrieval.exact.v1',
      indexVersion: 'exact-cosine.v1',
    },
    embeddingDimensions: 8,
    at: now,
  };

  it('publishes only a complete rights-checked document/chunk/embedding set', async () => {
    const { service, persistence } = createService();
    const release = await service.ingestPublicWord(input);

    expect(release.status).toBe('ACTIVE');
    expect(release.expectedChunkCount).toBe(1);
    expect(release.readyEmbeddingCount).toBe(1);
    expect(persistence.searchableChunks()).toHaveLength(1);
    expect(persistence.searchableChunks()[0]).toMatchObject({
      status: 'ACTIVE',
      content: 'Harbor is a sheltered place for boats.',
    });
  });

  it('keeps a partial embedding failure out of the searchable release', async () => {
    const failingEmbedding = {
      embed: jest.fn(async () => ({
        vectors: [],
        provider: 'fake',
        model: 'broken-fake',
        dimensions: 8,
        embeddingVersion: 'embedding.fake.8d.v1',
        usage: { inputTokens: 1, totalTokens: 1, estimated: true },
      })),
    };
    const { service, persistence } = createService(failingEmbedding as never);

    await expect(service.ingestPublicWord(input)).rejects.toThrow();
    expect(persistence.searchableChunks()).toEqual([]);
    expect(persistence.snapshot().releases.every((item) => item.status !== 'ACTIVE')).toBe(true);
  });
});
