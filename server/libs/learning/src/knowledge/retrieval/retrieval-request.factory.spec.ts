import { RetrievalRequestFactory } from './retrieval-request.factory';

const factory = new RetrievalRequestFactory({
  allowedAccessScopes: ['PUBLIC', 'OWNED_COURSE'],
  defaultMinimumRelevance: 0.65,
  contextTokenBudget: 1200,
  sourceRightsSnapshotVersion: 'rights.test.v1',
  contentVersionPolicy: 'content.sha256.v1',
  chunkingVersion: 'chunking.v1',
  embeddingVersion: 'embedding.fake.8d.v1',
  embeddingDimensions: 8,
  retrievalConfigVersion: 'retrieval.exact.v1',
  indexVersion: 'exact-cosine.v1',
});

describe('retrieval request factory', () => {
  it('normalizes the query and records an absent level without guessing one', () => {
    const result = factory.create({
      requestId: 'request_test_001',
      subjectId: 'user_test_001',
      untrustedInput: {
        schemaVersion: 'coach.tool.v2',
        query: '  harbor   meaning ',
        filters: {
          categories: ['WORD_MEANING'],
          sources: [],
          courseIds: [],
          wordIds: [],
        },
        topK: 8,
      },
    });
    expect(result.internal.query).toBe('harbor meaning');
    expect(result.appliedFilters).toMatchObject({
      levels: [],
      levelFilterApplied: false,
      minimumRelevance: 0.65,
    });
    expect(JSON.stringify(result.appliedFilters)).not.toContain('user_test_001');
  });

  it('intersects requested scopes and never widens to private content', () => {
    const result = factory.create({
      requestId: 'request_test_001',
      subjectId: 'user_test_001',
      untrustedInput: {
        schemaVersion: 'coach.tool.v2',
        query: 'course topic',
        filters: {
          levels: ['B1'],
          categories: ['COURSE_LESSON'],
          sources: [],
          courseIds: [],
          wordIds: [],
          accessScopes: ['OWNED_COURSE', 'PRIVATE_OWNER'],
        },
        topK: 5,
      },
    });
    expect(result.internal.enforcedAccessScopes).toEqual(['OWNED_COURSE']);
    expect(result.appliedFilters.levelFilterApplied).toBe(true);
  });
});
