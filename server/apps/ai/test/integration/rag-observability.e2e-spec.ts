import {
  CoachTraceQueryService,
  InMemoryCoachTraceRepository,
} from '../../src/coach/observability/coach-trace-query.service';
import { CoachTraceService } from '../../src/coach/observability/coach-trace.service';
import type {
  RetrievalTraceMetadata,
  RetrievalTraceStatus,
} from '../../src/coach/observability/rag-trace.types';

const retrievalMetadata = (
  status: RetrievalTraceStatus,
): RetrievalTraceMetadata => ({
  metadataVersion: 'rag-trace.v1',
  queryHash: 'a'.repeat(64),
  appliedFilters: {
    levels: ['B1'],
    categories: ['WORD_MEANING'],
    sources: ['project-owned'],
    courseIds: [],
    wordIds: ['word_opaque_001'],
    accessScopes: ['PUBLIC'],
  },
  topK: 3,
  minimumRelevance: 0.7,
  versions: {
    sourceRightsSnapshotVersion: 'rights.snapshot.v1',
    contentVersion: 'content.v1',
    chunkingVersion: 'chunking.v1',
    embeddingVersion: 'embedding.fake.8d.v1',
    retrievalConfigVersion: 'retrieval.exact.v1',
    indexVersion: 'exact-cosine.v1',
  },
  counts: {
    rawRecall: 5,
    accessEligible: 4,
    relevanceEligible: 3,
    deduplicated: 2,
    contextSelected: status === 'success' ? 1 : 0,
  },
  rankings:
    status === 'success'
      ? [
          {
            citationId: 'cit_observe_000001',
            sourceIdHash: 'b'.repeat(64),
            sourceCategory: 'WORD_BOOK',
            rank: 1,
            relevanceScore: 0.91,
            decision: 'used',
          },
          {
            citationId: 'cit_observe_000002',
            sourceIdHash: 'c'.repeat(64),
            sourceCategory: 'GRAMMAR',
            rank: 2,
            relevanceScore: 0.79,
            decision: 'unused',
          },
        ]
      : [],
  conflictCount: 0,
  deduplicatedCount: 1,
  retrievalDurationMs: 23,
  contextTokens: status === 'success' ? 48 : 0,
  tokenCountMode: 'model',
  usedCitationIds: status === 'success' ? ['cit_observe_000001'] : [],
  unusedCitationIds: status === 'success' ? ['cit_observe_000002'] : [],
  claimCitations:
    status === 'success'
      ? [{ claimPath: 'answer.claims.0', citationIds: ['cit_observe_000001'] }]
      : [],
  status,
  failureCode:
    status === 'failed'
      ? 'EMBEDDING_UNAVAILABLE'
      : status === 'insufficient'
        ? 'RETRIEVAL_INSUFFICIENT'
        : null,
});

describe('RAG request observability', () => {
  it.each<RetrievalTraceStatus>(['success', 'insufficient', 'failed'])(
    'links a complete %s retrieval to the existing Coach trace',
    async (status) => {
      const traceId = `trace_rag_${status}`;
      const requestId = `request_rag_${status}`;
      const repository = new InMemoryCoachTraceRepository();
      const trace = new CoachTraceService(traceId, `subject_hash_${status}`);
      trace.configureRun({
        requestId,
        promptVersion: 'coach-rag-answer.v1',
        promptHash: 'prompt_hash_rag_v1',
        modelProvider: 'mock',
        modelName: 'deterministic',
        modelVersion: 'mock-rag-v1',
        resultSchemaVersion: 'coach.result.v2',
        budgetVersion: 'rag-budget.pending.v1',
        startedAtMs: 1_000,
      });
      trace.startStep('search_learning_materials', 1_010);
      trace.recordRetrieval(retrievalMetadata(status));
      trace.finishStep(
        'search_learning_materials',
        status === 'failed' ? 'FAILED' : 'SUCCEEDED',
        1_033,
      );
      trace.recordModelStart(status === 'success' ? 120 : 0);
      trace.recordModelEnd(
        status === 'success' ? 32 : 0,
        status === 'success' ? 9 : 0,
      );
      trace.finishRun({
        terminalStatus: status === 'failed' ? 'FAILED' : 'COMPLETED',
        resultType: status === 'success' ? 'answer' : 'degraded',
        finishedAtMs: 1_100,
      });
      await trace.persist(repository);
      if (status === 'success') repository.linkFeedback(traceId, 'UP');

      const result = await new CoachTraceQueryService(repository).getOwned(
        `subject_hash_${status}`,
        traceId,
      );
      expect(result.requestId).toBe(requestId);
      expect(result.rag).toEqual(retrievalMetadata(status));
      expect(result.rag?.counts).toEqual({
        rawRecall: 5,
        accessEligible: 4,
        relevanceEligible: 3,
        deduplicated: 2,
        contextSelected: status === 'success' ? 1 : 0,
      });
      expect(result.rag?.usedCitationIds).toEqual(
        status === 'success' ? ['cit_observe_000001'] : [],
      );
      expect(result.rag?.unusedCitationIds).toEqual(
        status === 'success' ? ['cit_observe_000002'] : [],
      );
      expect(result.feedback).toBe(status === 'success' ? 'UP' : null);
      expect(JSON.stringify(result)).not.toMatch(
        /subject_hash|private document|userId/i,
      );
    },
  );
});
