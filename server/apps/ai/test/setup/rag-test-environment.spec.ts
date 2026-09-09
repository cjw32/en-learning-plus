import { resolveRagTestEnvironment } from './rag-test-environment';

describe('RAG test environment', () => {
  const safeEnvironment = {
    RAG_TEST_DATABASE_URL:
      'postgresql://test_user:test_password@127.0.0.1/rag_test',
    RAG_TEST_EMBEDDING_MODE: 'fake',
  } satisfies NodeJS.ProcessEnv;

  it('accepts an explicit test database with fake embeddings and disabled flags', () => {
    expect(resolveRagTestEnvironment(safeEnvironment)).toMatchObject({
      databaseUrl: safeEnvironment.RAG_TEST_DATABASE_URL,
      embeddingMode: 'fake',
      enablementFlags: {
        RAG_ENABLED: false,
        RAG_SHADOW_ENABLED: false,
        RAG_INGESTION_ENABLED: false,
        RAG_PRIVATE_CONTENT_ENABLED: false,
        RAG_EMBEDDING_PROVIDER_APPROVED: false,
      },
    });
  });

  it.each([
    {},
    { ...safeEnvironment, RAG_TEST_DATABASE_URL: 'postgresql://db/prod' },
    { ...safeEnvironment, RAG_TEST_EMBEDDING_MODE: 'live' },
    { ...safeEnvironment, RAG_EMBEDDING_PROVIDER_APPROVED: 'true' },
    { ...safeEnvironment, RAG_ENABLED: 'true' },
  ])('fails closed for unsafe configuration %#', (environment) => {
    expect(() => resolveRagTestEnvironment(environment)).toThrow();
  });
});
