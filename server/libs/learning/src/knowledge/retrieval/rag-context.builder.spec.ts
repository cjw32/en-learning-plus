import { RagContextBuilder } from './rag-context.builder';

describe('RAG context builder', () => {
  it('never exceeds the serialized token budget', () => {
    const builder = new RagContextBuilder({
      countTokens: (text) => Math.ceil(text.length / 10),
      fallbackMode: true,
    });
    const result = builder.build({
      tokenBudget: 30,
      results: [
        {
          chunkId: 'chunk_test_001',
          documentId: 'document_test_001',
          releaseId: 'release_test_001',
          source: 'source-test',
          sourceId: 'word:test',
          title: 'test',
          category: 'WORD_MEANING',
          level: 'A1',
          courseId: null,
          wordId: null,
          visibility: 'public',
          accessScope: 'PUBLIC',
          contentVersion: 'content.v1',
          embeddingVersion: 'embedding.v1',
          content: 'This deliberately long content may be omitted by the budget.',
          factKey: null,
          factValueHash: null,
          authorityRank: null,
          rank: 1,
          relevanceScore: 0.8,
        },
      ],
    });
    expect(result.tokenCount).toBeLessThanOrEqual(30);
    expect(result.tokenCountMode).toBe('fallback');
    expect(result.serialized).toMatch(/^<UNTRUSTED_KNOWLEDGE_JSON>/);
  });
});
