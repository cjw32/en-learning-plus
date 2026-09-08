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

function fixture(abort = new AbortController()) {
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
    execute: jest.fn(async () => ({
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
    })),
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
    materials as never,
    { select: jest.fn() } as never,
    { execute: jest.fn() } as never,
    { execute: jest.fn() } as never,
    { execute: jest.fn() } as never,
    () => now,
  );
  return { runtime, order, profile, materials };
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
});
