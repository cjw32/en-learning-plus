import { KnowledgeRetrievalResult } from '../domain/knowledge.types';

export type RagContextBuildResult = Readonly<{
  serialized: string;
  includedResults: readonly KnowledgeRetrievalResult[];
  omittedCount: number;
  tokenCount: number;
  tokenCountMode: 'model' | 'fallback';
}>;

export class RagContextBuilder {
  constructor(
    private readonly config: Readonly<{
      countTokens: (text: string) => number;
      fallbackMode: boolean;
    }>,
  ) {}

  build(input: {
    results: readonly KnowledgeRetrievalResult[];
    tokenBudget: number;
  }): RagContextBuildResult {
    if (!Number.isInteger(input.tokenBudget) || input.tokenBudget < 1) {
      throw new Error('RAG_CONTEXT_TOKEN_BUDGET_INVALID');
    }
    const included: KnowledgeRetrievalResult[] = [];
    let serialized = this.serialize(included);
    let tokenCount = this.count(serialized);
    for (const result of input.results) {
      const candidate = [...included, result];
      const candidateSerialized = this.serialize(candidate);
      const candidateTokens = this.count(candidateSerialized);
      if (candidateTokens > input.tokenBudget) continue;
      included.push(result);
      serialized = candidateSerialized;
      tokenCount = candidateTokens;
    }
    if (tokenCount > input.tokenBudget) {
      throw new Error('RAG_CONTEXT_WRAPPER_EXCEEDS_BUDGET');
    }

    return Object.freeze({
      serialized,
      includedResults: Object.freeze([...included]),
      omittedCount: input.results.length - included.length,
      tokenCount,
      tokenCountMode: this.config.fallbackMode ? 'fallback' : 'model',
    });
  }

  private count(text: string): number {
    const count = this.config.countTokens(text);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('RAG_TOKEN_COUNT_INVALID');
    }
    return count;
  }

  private serialize(results: readonly KnowledgeRetrievalResult[]): string {
    const payload = results.map((result) => ({
      chunkId: result.chunkId,
      source: result.source,
      sourceId: result.sourceId,
      title: result.title,
      category: result.category,
      level: result.level,
      courseId: result.courseId,
      wordId: result.wordId,
      contentVersion: result.contentVersion,
      rank: result.rank,
      relevanceScore: result.relevanceScore,
      content: result.content,
    }));
    return `<UNTRUSTED_KNOWLEDGE_JSON>${JSON.stringify(payload)}</UNTRUSTED_KNOWLEDGE_JSON>`;
  }
}
