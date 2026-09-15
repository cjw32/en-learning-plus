import { CoachExecutionContext } from '@libs/shared';
import { EnvironmentCoachRuntimeBudgetFactory } from '../../src/coach/governance/coach-runtime-budget.factory';
import { CoachTraceService } from '../../src/coach/observability/coach-trace.service';
import { CoachRuntimeWorkflowService } from '../../src/coach/workflow/coach-runtime.workflow';
import type { StoredCoachRequest } from '../../src/coach/api/coach-request.service';

const now = new Date('2026-09-02T00:00:00.000Z');

function request(): StoredCoachRequest {
  return {
    id: 'request_runtime_001',
    subjectId: 'user-a',
    conversationId: 'conversation-a',
    clientRequestKey: 'runtime-key-000001',
    requestBodyHash: 'hash',
    inputPayload: { type: 'MESSAGE', message: 'Explain went.' },
    inputType: 'MESSAGE',
    status: 'RUNNING',
    deadlineAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
  };
}

function budgetFactory() {
  return new EnvironmentCoachRuntimeBudgetFactory({
    COACH_ENABLED: 'true',
    COACH_LIVE_MODEL_ENABLED: 'true',
    COACH_MODEL_NAME: 'deepseek-chat',
    COACH_MODEL_VERSION: 'candidate-1',
    COACH_MODEL_PRICE_VERSION: 'price-v1',
    COACH_BUDGET_POLICY_VERSION: 'budget-v1',
    COACH_EVAL_DATASET_VERSION: 'eval-v1',
    COACH_BUDGET_POLICY_APPROVED: 'true',
    COACH_MAX_INPUT_TOKENS: '1000',
    COACH_MAX_OUTPUT_TOKENS: '1000',
    COACH_MAX_MODEL_CALLS: '4',
    COACH_MAX_TOOL_CALLS: '6',
    COACH_MAX_COST_MICROS: '10000',
    COACH_MAX_DURATION_MS: '60000',
    COACH_MAX_MODEL_INPUT_TOKENS_PER_CALL: '100',
    COACH_MAX_MODEL_OUTPUT_TOKENS_PER_CALL: '100',
    COACH_MODEL_INPUT_PRICE_MICROS_PER_MILLION_TOKENS: '1000000',
    COACH_MODEL_OUTPUT_PRICE_MICROS_PER_MILLION_TOKENS: '2000000',
    COACH_MODEL_PRICE_VALID_FROM: '2026-01-01T00:00:00.000Z',
    COACH_MODEL_PRICE_VALID_UNTIL: '2027-01-01T00:00:00.000Z',
  });
}

function fixture(abort = new AbortController(), rag = false) {
  const order: string[] = [];
  const stream = {
    async publishStatus(_id: string, status: string) {
      order.push(`status:${status}`);
    },
    async publishToolStatus(_id: string, tool: string, state: string) {
      order.push(`${tool}:${state}`);
    },
  };
  const model = {
    async classifyIntent(
      _message: string,
      signal: AbortSignal,
      telemetry: {
        onFirstOutput(): void;
        onUsage(value: { inputTokens: number; outputTokens: number }): void;
      },
    ) {
      expect(signal.aborted).toBe(false);
      telemetry.onFirstOutput();
      telemetry.onUsage({ inputTokens: 5, outputTokens: 2 });
      return 'ANSWER' as const;
    },
    async generateAnswer(
      _input: unknown,
      signal: AbortSignal,
      telemetry: {
        onFirstOutput(): void;
        onUsage(value: { inputTokens: number; outputTokens: number }): void;
      },
    ) {
      expect(signal.aborted).toBe(false);
      telemetry.onFirstOutput();
      telemetry.onUsage({ inputTokens: 20, outputTokens: 10 });
      return {
        correction: '',
        explanation: 'Went is the past tense of go.',
        examples: ['I went home yesterday.'],
        errorTypes: [],
        citations: [
          {
            sourceId: 'word:went',
            materialType: 'word',
            title: 'went',
            locator: 'dictionary/went',
            supports: 'past tense of go',
          },
        ],
      };
    },
    generateGroundedAnswer: jest.fn(
      async (
        _input: unknown,
        signal: AbortSignal,
        telemetry: {
          onFirstOutput(): void;
          onUsage(value: { inputTokens: number; outputTokens: number }): void;
        },
      ) => {
        expect(signal.aborted).toBe(false);
        telemetry.onFirstOutput();
        telemetry.onUsage({ inputTokens: 20, outputTokens: 10 });
        return {
          correction: '',
          explanation: 'Went is the past tense of go.',
          examples: ['I went home yesterday.'],
          errorTypes: [],
          groundedClaims: [
            {
              claimId: 'claim_runtime_grounded_001',
              resultPath: '/explanation',
              text: 'Went is the past tense of go.',
              citationIds: ['cit_runtime_grounded_000001'],
            },
          ],
        };
      },
    ),
  };
  const profile = {
    execute: jest.fn(async () => ({
      schemaVersion: 'coach.tool.v1',
      ok: true,
      snapshotAt: now.toISOString(),
      timezone: 'Asia/Shanghai',
      level: { cefr: 'A2', source: 'USER_DECLARED' },
      goal: null,
      activeCourse: null,
      learnedWordSummary: {
        legacyCompletedCount: 1,
        coachEngagedCount: 0,
        recentWords: [],
      },
      weakItems: [],
      errorTypes: [],
      recentPerformance: {
        attemptCount: 0,
        averageScore: null,
        windowStart: now.toISOString(),
      },
      signals: [{ dimension: 'LEVEL', status: 'AVAILABLE' }],
    })),
  };
  const materials = {
    execute: jest.fn(async () =>
      rag
        ? {
            schemaVersion: 'coach.tool.v2',
            ok: true,
            query: 'Explain went.',
            appliedFilters: {
              levels: ['A2'],
              levelFilterApplied: true,
              categories: [
                'WORD_MEANING',
                'WORD_TRANSLATION',
                'WORD_PRONUNCIATION',
                'WORD_FORM',
                'WORD_USAGE',
                'COLLOCATION',
                'EXAMPLE_SENTENCE',
                'GRAMMAR_RULE',
                'GRAMMAR_EXCEPTION',
                'COURSE_LESSON',
              ],
              sources: [],
              courseIds: [],
              wordIds: [],
              accessScopes: ['PUBLIC', 'OWNED_COURSE'],
              privateOwnerEnforced: true,
              topK: 8,
              minimumRelevance: 0.65,
              sourceRightsSnapshotVersion: 'rights.test.v1',
              contentVersionPolicy: 'content.sha256.v1',
              chunkingVersion: 'chunking.v1',
              embeddingVersion: 'embedding.test.8d.v1',
              retrievalConfigVersion: 'retrieval.exact.v1',
              indexVersion: 'exact-cosine.v1',
            },
            results: [
              {
                resultId: 'result_runtime_grounded_001',
                chunkId: 'chunk_runtime_grounded_001',
                documentId: 'document_runtime_grounded_001',
                citationId: 'cit_runtime_grounded_000001',
                source: 'synthetic-word-source',
                sourceId: 'word:went',
                title: 'went',
                category: 'WORD_MEANING',
                excerpt: 'Went is the past tense of go.',
                level: 'A2',
                courseId: null,
                wordId: 'word_went',
                accessScope: 'PUBLIC',
                rank: 1,
                relevanceScore: 0.95,
                contentVersion: 'content.test.v1',
                embeddingVersion: 'embedding.test.8d.v1',
                status: 'valid',
              },
            ],
            citations: [
              {
                citationId: 'cit_runtime_grounded_000001',
                source: 'synthetic-word-source',
                sourceId: 'word:went',
                title: 'went',
                excerpt: 'Went is the past tense of go.',
                category: 'WORD_MEANING',
                wordId: 'word_went',
                courseId: null,
                accessScope: 'PUBLIC',
                status: 'active',
                usage: 'answer_evidence',
              },
            ],
            conflicts: [],
            retrievalStatus: 'success',
          }
        : {
            schemaVersion: 'coach.tool.v1',
            ok: true,
            query: 'Explain went.',
            materials: [
              {
                citation: {
                  sourceId: 'word:went',
                  materialType: 'word',
                  title: 'went',
                  locator: 'dictionary/went',
                  supports: 'past tense of go',
                  accessScope: 'PUBLIC',
                },
                summary: 'went is the past tense of go',
                freshness: now.toISOString(),
              },
            ],
            unavailableTypes: ['course', 'grammar'],
          },
    ),
  };
  const runtime = new CoachRuntimeWorkflowService(
    stream as never,
    {
      abortSignalFor: () => abort.signal,
      observe: async () => abort.signal.aborted,
    } as never,
    budgetFactory(),
    model as never,
    profile as never,
    { execute: jest.fn() } as never,
    { ...materials, executeLegacy: materials.execute } as never,
    { select: jest.fn() } as never,
    { execute: jest.fn() } as never,
    { execute: jest.fn() } as never,
    { execute: jest.fn() } as never,
    () => now,
  );
  return { runtime, order, profile, materials, model };
}

describe('Coach controlled runtime graph', () => {
  it('runs the owned answer path and captures actual model usage and cost', async () => {
    const test = fixture();
    const trace = new CoachTraceService(
      'trace_request_runtime_001',
      'ts_user_a',
    );
    trace.configureRun({
      requestId: 'request_runtime_001',
      promptVersion: 'coach.workflow.v1',
      promptHash: 'a'.repeat(64),
      modelProvider: 'deepseek',
      modelName: 'deepseek-chat',
      modelVersion: 'candidate-1',
      resultSchemaVersion: 'coach.result.v1',
      budgetVersion: 'budget-v1',
      startedAtMs: now.getTime(),
    });

    const output = await test.runtime.run({
      request: request(),
      context: new CoachExecutionContext('user-a', 1_788_307_260),
      signal: new AbortController().signal,
      trace,
    });

    expect(output).toMatchObject({
      intent: 'ANSWER',
      result: { responseType: 'answer', traceId: 'trace_request_runtime_001' },
    });
    expect(test.profile.execute).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: 'user-a' }),
      expect.not.objectContaining({ userId: expect.anything() }),
    );
    expect(test.materials.execute).toHaveBeenCalledTimes(1);
    expect(trace.snapshot()).toMatchObject({
      inputTokens: 25,
      outputTokens: 12,
      estimatedCostMicros: 49,
      ttftMs: 0,
    });
    expect(test.order).toEqual(
      expect.arrayContaining([
        'get_learner_profile:started',
        'get_learner_profile:succeeded',
        'search_learning_materials:started',
        'search_learning_materials:succeeded',
      ]),
    );
  });

  it('propagates the cancellation signal to the model and does not run tools', async () => {
    const abort = new AbortController();
    abort.abort();
    const test = fixture(abort);
    const trace = new CoachTraceService(
      'trace_request_runtime_001',
      'ts_user_a',
    );
    trace.configureRun({
      requestId: 'request_runtime_001',
      promptVersion: 'coach.workflow.v1',
      promptHash: 'a'.repeat(64),
      modelProvider: 'deepseek',
      modelName: 'deepseek-chat',
      modelVersion: 'candidate-1',
      resultSchemaVersion: 'coach.result.v1',
      budgetVersion: 'budget-v1',
      startedAtMs: now.getTime(),
    });

    await expect(
      test.runtime.run({
        request: request(),
        context: new CoachExecutionContext('user-a', 1_788_307_260),
        signal: abort.signal,
        trace,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(test.profile.execute).not.toHaveBeenCalled();
    expect(test.materials.execute).not.toHaveBeenCalled();
  });

  it('keeps issued citation IDs through the live RAG path and emits coach.result.v2', async () => {
    const environment = {
      COACH_ENABLED: 'true',
      RAG_ENABLED: 'true',
      RAG_SHADOW_ENABLED: 'false',
      RAG_INGESTION_ENABLED: 'false',
      RAG_PRIVATE_CONTENT_ENABLED: 'false',
      RAG_EMBEDDING_PROVIDER_APPROVED: 'true',
      RAG_EMBEDDING_ENDPOINT: 'https://embedding.invalid/v1/embeddings',
      RAG_EMBEDDING_MODEL: 'approved-test-model',
      RAG_EMBEDDING_DIMENSIONS: '8',
      RAG_EMBEDDING_VERSION: 'embedding.test.8d.v1',
      RAG_SOURCE_RIGHTS_SNAPSHOT_VERSION: 'rights.test.v1',
      RAG_CHUNKING_VERSION: 'chunking.v1',
      RAG_RETRIEVAL_CONFIG_VERSION: 'retrieval.exact.v1',
      RAG_INDEX_VERSION: 'exact-cosine.v1',
      RAG_RESULT_SCHEMA_VERSION: 'coach.result.v2',
      RAG_PRICE_VERSION: 'price.test.v1',
      RAG_TEST_BUDGET_MICROS: '1000',
      COACH_TRACE_PEPPER: 'synthetic-test-pepper',
    } as const;
    const previous = Object.fromEntries(
      Object.keys(environment).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, environment);
    try {
      const test = fixture(new AbortController(), true);
      const trace = new CoachTraceService(
        'trace_request_runtime_001',
        'ts_user_a',
      );
      trace.configureRun({
        requestId: 'request_runtime_001',
        promptVersion: 'coach.workflow.v1',
        promptHash: 'a'.repeat(64),
        modelProvider: 'deepseek',
        modelName: 'deepseek-chat',
        modelVersion: 'candidate-1',
        resultSchemaVersion: 'coach.result.v1',
        budgetVersion: 'budget-v1',
        startedAtMs: now.getTime(),
      });

      const output = await test.runtime.run({
        request: request(),
        context: new CoachExecutionContext('user-a', 1_788_307_260),
        signal: new AbortController().signal,
        trace,
      });

      expect(test.model.generateGroundedAnswer).toHaveBeenCalledTimes(1);
      expect(output.result).toMatchObject({
        schemaVersion: 'coach.result.v2',
        knowledgeStatus: 'grounded',
        citations: [{ citationId: 'cit_runtime_grounded_000001' }],
        groundedClaims: [{ citationIds: ['cit_runtime_grounded_000001'] }],
      });
      expect(trace.snapshot()).toMatchObject({
        rag: {
          usedCitationIds: ['cit_runtime_grounded_000001'],
          unusedCitationIds: [],
          claimCitations: [
            {
              claimPath: '/explanation',
              citationIds: ['cit_runtime_grounded_000001'],
            },
          ],
        },
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
