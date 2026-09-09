import { RetrievalOutcomeService } from '@libs/learning/knowledge/retrieval/retrieval-outcome.service';
import { buildRagDegradationFallback } from '../../src/coach/workflow/fallback.builder';
import { RagRetrievalDegradationError } from '../../src/coach/workflow/fallback.builder';
import { CoachAnswerWorkflow } from '../../src/coach/workflow/coach.graph';
import { CoachExecutionContext } from '@libs/shared';

const validResult = {
  chunkId: 'chunk_degradation_001',
  status: 'ACTIVE' as const,
  relevanceScore: 0.91,
};

describe('RAG retrieval degradation workflow', () => {
  const service = new RetrievalOutcomeService();

  it('classifies eligible evidence as success', () => {
    expect(
      service.classify({
        results: [validResult],
        citations: [{ citationId: 'cit_degradation_001', status: 'active' }],
        minimumRelevance: 0.65,
        unavailableCategories: [],
      }),
    ).toMatchObject({ status: 'success', diagnosticCode: null });
  });

  it.each([
    ['empty recall', [], [], 'EMPTY_RECALL'],
    [
      'low relevance',
      [{ ...validResult, relevanceScore: 0.2 }],
      [],
      'LOW_RELEVANCE',
    ],
    [
      'invalid source',
      [{ ...validResult, status: 'INVALID' }],
      [],
      'SOURCE_INVALID',
    ],
    ['unavailable category', [], ['GRAMMAR_RULE'], 'SOURCE_UNAVAILABLE'],
  ] as const)(
    'classifies %s as insufficient',
    (_name, results, unavailable, code) => {
      expect(
        service.classify({
          results,
          citations: [],
          minimumRelevance: 0.65,
          unavailableCategories: unavailable,
        }),
      ).toMatchObject({
        status: 'insufficient',
        results: [],
        citations: [],
        diagnosticCode: code,
      });
    },
  );

  it.each([
    ['timeout', { code: 'TOOL_TIMEOUT', retryable: true }],
    ['rate limit', { code: 'RATE_LIMITED', retryable: true }],
    ['provider exception', { code: 'INTERNAL_ERROR', retryable: false }],
  ] as const)('classifies %s as failed without evidence', (_name, failure) => {
    expect(
      service.classify({
        results: [validResult],
        citations: [{ citationId: 'cit_degradation_001', status: 'active' }],
        minimumRelevance: 0.65,
        unavailableCategories: [],
        failure,
      }),
    ).toMatchObject({
      status: 'failed',
      results: [],
      citations: [],
      diagnosticCode: failure.code,
    });
  });

  it.each(['insufficient', 'failed'] as const)(
    'builds a safe %s fallback without factual exercises or citations',
    (status) => {
      const fallback = buildRagDegradationFallback('trace_degradation_001', {
        status,
        diagnosticCode: status === 'failed' ? 'TOOL_TIMEOUT' : 'EMPTY_RECALL',
      });
      expect(fallback).toMatchObject({
        responseType: 'degraded',
        citations: [],
        examples: [],
        score: null,
      });
      expect(JSON.stringify(fallback)).not.toMatch(
        /chunk_|cit_degradation|stack|sql/i,
      );
    },
  );

  it('stops before model generation and uses the classified insufficient wording', async () => {
    const generateAnswer = jest.fn();
    const workflow = new CoachAnswerWorkflow({
      classifyIntent: async () => 'ANSWER',
      getLearnerProfile: async () => ({}),
      searchLearningMaterials: async () => {
        throw new RagRetrievalDegradationError('insufficient', 'EMPTY_RECALL');
      },
      generateAnswer,
      recommend: async () => ({
        nextAction: 'continue' as const,
        nextActionReason: 'continue',
      }),
      gradeAnswer: async () => undefined,
      saveAttempt: async () => undefined,
    });
    const result = await workflow.run(
      {
        requestId: 'request_degradation_001',
        conversationId: 'conversation_degradation_001',
        message: 'Explain unavailable material',
        traceId: 'trace_degradation_001',
      },
      new CoachExecutionContext('synthetic_a', 1_788_307_260),
    );
    expect(result).toMatchObject({
      responseType: 'degraded',
      citations: [],
      examples: [],
    });
    expect(result.explanation).toContain('材料不足');
    expect(generateAnswer).not.toHaveBeenCalled();
  });
});
