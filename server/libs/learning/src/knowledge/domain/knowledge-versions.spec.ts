import {
  assertRagKnowledgeVersions,
  RAG_KNOWLEDGE_VERSIONS,
} from './knowledge-versions';

describe('RAG knowledge versions', () => {
  it('defines explicit immutable versions for every governed component', () => {
    expect(assertRagKnowledgeVersions).not.toThrow();
    expect(RAG_KNOWLEDGE_VERSIONS).toMatchObject({
      contentPolicy: expect.any(String),
      sourceRightsSnapshot: expect.any(String),
      chunking: expect.any(String),
      embedding: expect.any(String),
      retrievalConfig: expect.any(String),
      index: 'exact-cosine.v1',
      toolSchema: 'coach.tool.v2',
      resultSchema: 'coach.result.v2',
      evaluationDataset: expect.any(String),
      price: expect.any(String),
    });
    expect(Object.isFrozen(RAG_KNOWLEDGE_VERSIONS)).toBe(true);
  });

  it('keeps unapproved external versions explicit and fail-closed', () => {
    expect(RAG_KNOWLEDGE_VERSIONS.embedding).toContain('unapproved');
    expect(RAG_KNOWLEDGE_VERSIONS.price).toContain('pending');
  });
});
