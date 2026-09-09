import { resolveRagRuntimeConfig } from '../../src/coach/governance/coach-config.schema';

describe('RAG runtime configuration', () => {
  const approved = {
    COACH_ENABLED: 'true',
    RAG_ENABLED: 'true',
    RAG_EMBEDDING_PROVIDER_APPROVED: 'true',
    RAG_EMBEDDING_ENDPOINT: 'https://embedding.invalid/v1/embeddings',
    RAG_EMBEDDING_MODEL: 'approved-test-model',
    RAG_EMBEDDING_DIMENSIONS: '8',
    RAG_EMBEDDING_VERSION: 'embedding.test.8d.v1',
    RAG_SOURCE_RIGHTS_SNAPSHOT_VERSION: 'rights.test.v1',
    RAG_CHUNKING_VERSION: 'chunking.v1',
    RAG_RETRIEVAL_CONFIG_VERSION: 'retrieval.exact.v1',
    RAG_INDEX_VERSION: 'exact-cosine.v1',
    RAG_RESULT_SCHEMA_VERSION: 'coach.result.v2',
    RAG_PRICE_VERSION: 'price.test.v1',
    RAG_TOP_K: '8',
    RAG_MINIMUM_RELEVANCE: '0.65',
    RAG_CONTEXT_TOKEN_BUDGET: '1200',
    RAG_TIMEOUT_MS: '1500',
    RAG_MAX_RETRIES: '2',
    RAG_TEST_BUDGET_MICROS: '50000',
  } satisfies NodeJS.ProcessEnv;

  it('keeps every RAG capability disabled when configuration is absent', () => {
    expect(resolveRagRuntimeConfig({})).toMatchObject({
      enabled: false,
      shadowEnabled: false,
      ingestionEnabled: false,
      privateContentEnabled: false,
      embeddingProviderApproved: false,
    });
  });

  it('accepts a fully versioned approved read configuration', () => {
    expect(resolveRagRuntimeConfig(approved)).toMatchObject({
      enabled: true,
      embeddingProviderApproved: true,
      embeddingDimensions: 8,
      topK: 8,
      minimumRelevance: 0.65,
      contextTokenBudget: 1200,
      timeoutMs: 1500,
      maxRetries: 2,
      testBudgetMicros: 50000,
    });
  });

  it.each([
    [
      'provider approval',
      { ...approved, RAG_EMBEDDING_PROVIDER_APPROVED: 'false' },
    ],
    ['dimensions', { ...approved, RAG_EMBEDDING_DIMENSIONS: '0' }],
    ['top K', { ...approved, RAG_TOP_K: '21' }],
    ['minimum relevance', { ...approved, RAG_MINIMUM_RELEVANCE: '-0.1' }],
    ['test budget', { ...approved, RAG_TEST_BUDGET_MICROS: '0' }],
    ['price version', { ...approved, RAG_PRICE_VERSION: 'placeholder' }],
  ])('fails closed for invalid %s', (_name, environment) => {
    expect(() => resolveRagRuntimeConfig(environment)).toThrow();
  });

  it('does not allow private content without ingestion and explicit private approval', () => {
    expect(() =>
      resolveRagRuntimeConfig({
        ...approved,
        RAG_PRIVATE_CONTENT_ENABLED: 'true',
      }),
    ).toThrow('RAG_PRIVATE_CONTENT_ENABLED');
  });
});
