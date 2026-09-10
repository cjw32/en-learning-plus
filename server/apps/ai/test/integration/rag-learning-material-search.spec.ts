import { searchLearningMaterialsV2OutputSchema } from '@en/common/coach';
import { InMemoryCitationPersistence } from '@libs/learning';
import { FakeEmbeddingGateway } from '../../src/knowledge/embedding/fake-embedding.gateway';
import {
  RagLearningMaterialSearchService,
  versionOrdinalForConflict,
} from '../../src/knowledge/retrieval/rag-learning-material-search.service';

const config = {
  enabled: true,
  shadowEnabled: false,
  ingestionEnabled: false,
  privateContentEnabled: false,
  embeddingProviderApproved: true,
  embeddingEndpoint: 'https://provider.invalid/embeddings',
  embeddingModel: 'deterministic-sha256',
  embeddingDimensions: 8,
  embeddingVersion: 'embedding.fake.8d.v1',
  sourceRightsSnapshotVersion: 'rights.synthetic.v1',
  chunkingVersion: 'chunking.v1',
  retrievalConfigVersion: 'retrieval.exact.v1',
  indexVersion: 'exact-cosine.v1',
  resultSchemaVersion: 'coach.result.v2',
  priceVersion: 'rag-price.pending.v1',
  topK: 2,
  minimumRelevance: 0.65,
  contextTokenBudget: 1200,
  timeoutMs: 1500,
  maxRetries: 0,
  testBudgetMicros: 1000,
} as const;

describe('RAG learning material runtime orchestration', () => {
  it('orders only explicit versions and never infers recency from opaque hashes', () => {
    expect(versionOrdinalForConflict('content.v2.3.4')).toBe(2_003_004);
    expect(versionOrdinalForConflict('content.sha256.abc123')).toBe(0);
    expect(versionOrdinalForConflict('content.sha256.xyz999')).toBe(0);
  });

  it('runs embedding → permission-first exact search → ranking → server citation issue', async () => {
    const vectors = {
      searchExact: jest.fn((request) =>
        Promise.resolve([
          {
            chunkId: 'chunk_runtime_000001',
            documentId: 'document_runtime_000001',
            releaseId: 'release_runtime_000001',
            source: 'synthetic-runtime',
            sourceId: 'synthetic:runtime:one',
            title: 'Synthetic runtime source',
            category: 'WORD_MEANING' as const,
            level: 'B1',
            courseId: null,
            wordId: 'word_runtime_001',
            visibility: 'public' as const,
            accessScope: 'PUBLIC' as const,
            contentVersion: 'content.runtime.v1',
            embeddingVersion: request.embeddingVersion,
            content:
              'A synthetic runtime definition with sufficient learning meaning.',
            factKey: 'word_runtime_001:meaning',
            factValueHash: 'fact_runtime_v1',
            authorityRank: 10,
            rank: 1,
            relevanceScore: 0.94,
          },
        ]),
      ),
    };
    const service = new RagLearningMaterialSearchService(
      config,
      new FakeEmbeddingGateway({
        dimensions: 8,
        embeddingVersion: 'embedding.fake.8d.v1',
      }),
      vectors,
      new InMemoryCitationPersistence(),
    );
    const output = await service.search(
      'synthetic_runtime_subject',
      {
        schemaVersion: 'coach.tool.v2',
        query: 'Define the synthetic runtime word.',
        filters: {
          categories: ['WORD_MEANING'],
          sources: ['synthetic-runtime'],
          courseIds: [],
          wordIds: ['word_runtime_001'],
          accessScopes: ['PUBLIC'],
        },
        topK: 2,
        minimumRelevance: 0.65,
      },
      { requestId: 'request_runtime_000001' },
    );

    expect(searchLearningMaterialsV2OutputSchema.parse(output)).toEqual(output);
    expect(output).toMatchObject({
      ok: true,
      retrievalStatus: 'success',
      results: [{ chunkId: 'chunk_runtime_000001', rank: 1 }],
      citations: [{ usage: 'answer_evidence' }],
    });
    expect(vectors.searchExact).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: 'synthetic_runtime_subject',
        topK: 2,
        candidateLimit: 8,
        filters: expect.objectContaining({ accessScopes: ['PUBLIC'] }),
      }),
    );
    expect(
      JSON.stringify(vectors.searchExact.mock.calls[0]?.[0]),
    ).not.toContain('userId');
  });

  it('fails closed before embedding when the internal request identity is absent', async () => {
    const embedding = new FakeEmbeddingGateway({
      dimensions: 8,
      embeddingVersion: 'embedding.fake.8d.v1',
    });
    const embed = jest.spyOn(embedding, 'embed');
    const service = new RagLearningMaterialSearchService(
      config,
      embedding,
      { searchExact: jest.fn() },
      new InMemoryCitationPersistence(),
    );
    const output = await service.search('synthetic_runtime_subject', {
      schemaVersion: 'coach.tool.v2',
      query: 'Synthetic query',
      filters: {
        categories: ['WORD_MEANING'],
        sources: [],
        courseIds: [],
        wordIds: [],
        accessScopes: ['PUBLIC'],
      },
      topK: 1,
    });
    expect(output).toMatchObject({ ok: false, retrievalStatus: 'failed' });
    expect(embed).not.toHaveBeenCalled();
  });
});
