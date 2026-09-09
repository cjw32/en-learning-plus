const RAG_ENABLEMENT_FLAGS = [
  'RAG_ENABLED',
  'RAG_SHADOW_ENABLED',
  'RAG_INGESTION_ENABLED',
  'RAG_PRIVATE_CONTENT_ENABLED',
  'RAG_EMBEDDING_PROVIDER_APPROVED',
] as const;

export type RagTestEnvironment = Readonly<{
  databaseUrl: string;
  embeddingMode: 'fake';
  enablementFlags: Readonly<Record<(typeof RAG_ENABLEMENT_FLAGS)[number], false>>;
}>;

function isExplicitTestDatabase(databaseUrl: string): boolean {
  return (
    /(?:localhost|127\.0\.0\.1|[_-]test(?:[_-]|$)|\/test(?:\?|$))/i.test(
      databaseUrl,
    ) && !/(?:prod|production)/i.test(databaseUrl)
  );
}

export function resolveRagTestEnvironment(
  environment: NodeJS.ProcessEnv,
): RagTestEnvironment {
  const databaseUrl = environment.RAG_TEST_DATABASE_URL?.trim();
  if (!databaseUrl || !isExplicitTestDatabase(databaseUrl)) {
    throw new Error('RAG_TEST_DATABASE_URL must identify an explicit test database');
  }

  if (environment.RAG_TEST_EMBEDDING_MODE?.trim().toLowerCase() !== 'fake') {
    throw new Error('RAG tests require the deterministic fake embedding mode');
  }

  const enablementFlags = Object.fromEntries(
    RAG_ENABLEMENT_FLAGS.map((flag) => {
      if (environment[flag]?.trim().toLowerCase() === 'true') {
        throw new Error(`${flag} must remain disabled in the default RAG test environment`);
      }
      return [flag, false];
    }),
  ) as Record<(typeof RAG_ENABLEMENT_FLAGS)[number], false>;

  return Object.freeze({
    databaseUrl,
    embeddingMode: 'fake' as const,
    enablementFlags: Object.freeze(enablementFlags),
  });
}
