import {
  InMemoryKnowledgeIngestionPersistence,
  InMemoryKnowledgeOutboxPersistence,
  KnowledgeOutboxRepository,
} from '@libs/learning';

const release = {
  id: 'release-idempotent',
  scopeKey: 'word:idempotent',
  contentVersion: 'content.v1',
  rightsVersion: 'rights.v1',
  chunkingVersion: 'chunking.v1',
  embeddingVersion: 'embedding.fake.2d.v1',
  retrievalConfigVersion: 'retrieval.v1',
  indexVersion: 'index.v1',
  expectedChunkCount: 1,
  readyEmbeddingCount: 0,
  status: 'BUILDING' as const,
};
const chunk = {
  id: 'chunk-idempotent',
  documentId: 'document-idempotent',
  chunkKey: 'definition',
  ordinal: 0,
  content: 'A stable synthetic definition.',
  contentHash: 'content-hash-v1',
  chunkingVersion: 'chunking.v1',
  source: 'synthetic-source',
  sourceId: 'word:idempotent',
  title: 'idempotent',
  category: 'WORD_MEANING' as const,
  level: 'A2',
  courseId: null,
  wordId: null,
  visibility: 'public' as const,
  contentVersion: 'content.v1',
  factKey: 'word:idempotent:definition',
  factValueHash: 'fact-hash-v1',
  authorityRank: 1,
  status: 'STAGED' as const,
};

describe('knowledge ingestion idempotency', () => {
  it('does not duplicate release, document, chunk, or embedding effects', async () => {
    const persistence = new InMemoryKnowledgeIngestionPersistence();
    const stage = {
      release,
      document: { id: 'document-idempotent', releaseId: release.id },
      chunks: [chunk],
    };
    const activation = {
      releaseId: release.id,
      embeddings: [
        {
          chunkId: chunk.id,
          vector: [1, 0],
          provider: 'fake',
          model: 'deterministic',
          dimensions: 2,
          embeddingVersion: release.embeddingVersion,
        },
      ],
    };
    await persistence.stage(stage);
    await persistence.stage(stage);
    await persistence.activate(activation);
    await persistence.activate(activation);

    const snapshot = persistence.snapshot();
    expect(snapshot.releases).toHaveLength(1);
    expect(snapshot.documents).toHaveLength(1);
    expect(snapshot.chunks).toHaveLength(1);
    expect(snapshot.embeddings).toHaveLength(1);
  });

  it('deduplicates any number of equivalent outbox operations', async () => {
    const persistence = new InMemoryKnowledgeOutboxPersistence();
    const outbox = new KnowledgeOutboxRepository(persistence);
    const command = {
      operation: 'UPSERT' as const,
      knowledgeSourceId: 'source-idempotent',
      sourceRecordType: 'WordBook',
      sourceRecordId: 'word-idempotent',
      contentVersion: 'content.v1',
      pipelineVersion: 'pipeline.v1',
      ownerUserId: null,
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await outbox.enqueue(command);
    }
    expect(persistence.snapshot()).toHaveLength(1);
  });
});
