export const RAG_KNOWLEDGE_VERSIONS = Object.freeze({
  contentPolicy: 'knowledge-content.v1',
  sourceRightsSnapshot: 'source-rights.pending.v1',
  chunking: 'knowledge-chunking.v1',
  embedding: 'embedding.unapproved.v1',
  fakeEmbedding: 'embedding.fake.8d.v1',
  retrievalConfig: 'retrieval.exact-cosine.v1',
  index: 'exact-cosine.v1',
  toolSchema: 'coach.tool.v2',
  resultSchema: 'coach.result.v2',
  storageSchema: 'coach.result.storage.v2',
  evaluationDataset: 'rag-eval.synthetic.v1',
  evaluationRubric: 'rag-quality.v1',
  price: 'rag-price.pending.v1',
} as const);

export type RagKnowledgeVersionKey = keyof typeof RAG_KNOWLEDGE_VERSIONS;

export function assertRagKnowledgeVersions(): void {
  for (const [name, value] of Object.entries(RAG_KNOWLEDGE_VERSIONS)) {
    if (
      !value.trim() ||
      /placeholder|replace-me|todo|tbd|unknown/i.test(value)
    ) {
      throw new Error(`RAG version ${name} is empty or a placeholder`);
    }
  }
}
