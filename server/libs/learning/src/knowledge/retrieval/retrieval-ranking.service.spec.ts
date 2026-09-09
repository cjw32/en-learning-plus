import { KnowledgeRetrievalResult } from '../domain/knowledge.types';
import { RetrievalRankingService } from './retrieval-ranking.service';

function candidate(
  chunkId: string,
  source: string,
  relevanceScore: number,
  content = 'Same normalized evidence.',
): KnowledgeRetrievalResult {
  return {
    chunkId,
    documentId: `document_${chunkId}`,
    releaseId: `release_${chunkId}`,
    source,
    sourceId: `${source}:record`,
    title: source,
    category: 'WORD_MEANING',
    level: 'B1',
    courseId: null,
    wordId: null,
    visibility: 'public',
    accessScope: 'PUBLIC',
    contentVersion: 'content.v1',
    embeddingVersion: 'embedding.fake.8d.v1',
    content,
    factKey: null,
    factValueHash: null,
    authorityRank: null,
    rank: 99,
    relevanceScore,
  };
}

describe('retrieval ranking service', () => {
  it('deduplicates equivalent chunks within one source and reranks', () => {
    const result = new RetrievalRankingService().rank(
      [
        candidate('chunk_a1', 'source-a', 0.9),
        candidate('chunk_a2', 'source-a', 0.8),
      ],
      2,
    );
    expect(result.map((item) => item.chunkId)).toEqual(['chunk_a1']);
    expect(result.map((item) => item.rank)).toEqual([1]);
  });

  it('preserves equivalent evidence from independent sources', () => {
    const result = new RetrievalRankingService().rank(
      [
        candidate('chunk_a1', 'source-a', 0.9),
        candidate('chunk_b1', 'source-b', 0.8),
      ],
      2,
    );
    expect(result.map((item) => item.source)).toEqual(['source-a', 'source-b']);
    expect(result.map((item) => item.rank)).toEqual([1, 2]);
  });
});
