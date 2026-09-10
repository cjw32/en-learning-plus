import { KnowledgeRetrievalResult } from '../domain/knowledge.types';

export class RetrievalRankingService {
  rank(
    candidates: readonly KnowledgeRetrievalResult[],
    topK: number,
  ): readonly KnowledgeRetrievalResult[] {
    if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
      throw new Error('RETRIEVAL_TOP_K_INVALID');
    }
    const sorted = [...candidates].sort(
      (left, right) =>
        right.relevanceScore - left.relevanceScore ||
        (right.authorityRank ?? 0) - (left.authorityRank ?? 0) ||
        left.chunkId.localeCompare(right.chunkId),
    );
    const deduplicated: KnowledgeRetrievalResult[] = [];
    const seenEvidence = new Set<string>();
    for (const candidate of sorted) {
      const key = [
        candidate.source,
        candidate.sourceId,
        candidate.content.normalize('NFKC').replace(/\s+/gu, ' ').trim(),
      ].join('\0');
      if (seenEvidence.has(key)) continue;
      seenEvidence.add(key);
      deduplicated.push(candidate);
    }

    const firstBySource: KnowledgeRetrievalResult[] = [];
    const remaining: KnowledgeRetrievalResult[] = [];
    const seenSources = new Set<string>();
    for (const candidate of deduplicated) {
      if (seenSources.has(candidate.source)) remaining.push(candidate);
      else {
        seenSources.add(candidate.source);
        firstBySource.push(candidate);
      }
    }
    const diversified = [...firstBySource, ...remaining].slice(0, topK);
    return Object.freeze(
      diversified.map((candidate, index) =>
        Object.freeze({ ...candidate, rank: index + 1 }),
      ),
    );
  }
}
