import {
  CoachTraceService,
  type CoachTraceTerminalStatus,
} from '../../src/coach/observability/coach-trace.service';
import { CoachLangChainCallbacks } from '../../src/coach/observability/coach-langchain.callbacks';
import {
  CoachTraceQueryService,
  InMemoryCoachTraceRepository,
} from '../../src/coach/observability/coach-trace-query.service';
import {
  CoachFeedbackService,
  InMemoryCoachFeedbackRepository,
} from '../../src/coach/observability/coach-feedback.service';

describe('Coach request observability', () => {
  it.each<{
    terminalStatus: CoachTraceTerminalStatus;
    resultType: string | null;
    schemaFailures: number;
    retries: number;
  }>([
    {
      terminalStatus: 'COMPLETED',
      resultType: 'answer',
      schemaFailures: 0,
      retries: 0,
    },
    {
      terminalStatus: 'COMPLETED',
      resultType: 'degraded',
      schemaFailures: 1,
      retries: 1,
    },
    {
      terminalStatus: 'CANCELLED',
      resultType: null,
      schemaFailures: 0,
      retries: 0,
    },
    {
      terminalStatus: 'TIMED_OUT',
      resultType: null,
      schemaFailures: 0,
      retries: 0,
    },
    {
      terminalStatus: 'BUDGET_EXCEEDED',
      resultType: null,
      schemaFailures: 0,
      retries: 0,
    },
  ])('persists complete $terminalStatus metadata', async (scenario) => {
    let clock = 1_000;
    const trace = new CoachTraceService(
      `trace_observe_${scenario.terminalStatus}`,
      `subject_hash_${scenario.terminalStatus}`,
    );
    trace.configureRun({
      requestId: `request_${scenario.terminalStatus}`,
      promptVersion: 'coach-answer-v1',
      promptHash: 'prompt_hash_001',
      modelProvider: 'deepseek',
      modelName: 'deepseek-chat',
      modelVersion: 'candidate-2026-09',
      resultSchemaVersion: 'coach.result.v1',
      budgetVersion: 'budget-baseline-pending-v1',
      startedAtMs: clock,
    });
    trace.startStep('generate', clock);
    const callbacks = new CoachLangChainCallbacks(trace, () => clock);
    callbacks.onModelStart({ inputTokens: 120 });
    clock = 1_080;
    callbacks.onFirstToken();
    clock = 1_180;
    callbacks.onModelEnd({ outputTokens: 40, estimatedCostMicros: 77 });
    trace.finishStep('generate', 'SUCCEEDED', clock);
    for (let index = 0; index < scenario.schemaFailures; index += 1) {
      trace.recordSchemaFailure();
    }
    for (let index = 0; index < scenario.retries; index += 1) {
      trace.recordRetry();
    }
    trace.finishRun({
      terminalStatus: scenario.terminalStatus,
      resultType: scenario.resultType,
      finishedAtMs: 1_250,
    });

    const repository = new InMemoryCoachTraceRepository();
    await trace.persist(repository);
    const query = new CoachTraceQueryService(repository);
    const snapshot = await query.getOwned(
      `subject_hash_${scenario.terminalStatus}`,
      `trace_observe_${scenario.terminalStatus}`,
    );
    expect(snapshot).toMatchObject({
      requestId: `request_${scenario.terminalStatus}`,
      promptVersion: 'coach-answer-v1',
      modelVersion: 'candidate-2026-09',
      resultSchemaVersion: 'coach.result.v1',
      budgetVersion: 'budget-baseline-pending-v1',
      ttftMs: 80,
      totalDurationMs: 250,
      inputTokens: 120,
      outputTokens: 40,
      estimatedCostMicros: 77,
      schemaFailureCount: scenario.schemaFailures,
      retryCount: scenario.retries,
      terminalStatus: scenario.terminalStatus,
      resultType: scenario.resultType,
      steps: [{ sequence: 0, stepName: 'generate', durationMs: 180 }],
    });
    expect(snapshot).not.toHaveProperty('traceSubjectId');
    await expect(
      query.getOwned('other_subject_hash', snapshot.traceId),
    ).rejects.toThrow('Trace 不存在或不可访问');
  });

  it('stores exactly one trace per request and links idempotent feedback once', async () => {
    const repository = new InMemoryCoachTraceRepository();
    const trace = new CoachTraceService(
      'trace_unique_001',
      'subject_hash_unique',
    );
    trace.configureRun({
      requestId: 'request_unique_001',
      promptVersion: 'coach-answer-v1',
      promptHash: 'prompt_hash_unique',
      modelProvider: 'mock',
      modelName: 'deterministic',
      modelVersion: 'mock-v1',
      resultSchemaVersion: 'coach.result.v1',
      budgetVersion: 'budget-baseline-pending-v1',
      startedAtMs: 10,
    });
    trace.finishRun({
      terminalStatus: 'COMPLETED',
      resultType: 'answer',
      finishedAtMs: 20,
    });
    await trace.persist(repository);
    await expect(trace.persist(repository)).rejects.toThrow('one Trace');
  });

  it('upserts one feedback row for an owned terminal request and links safe versions', async () => {
    const repository = new InMemoryCoachFeedbackRepository([
      {
        requestId: 'request_feedback_001',
        traceSubjectId: 'subject_hash_feedback',
        terminal: true,
        traceId: 'trace_feedback_001',
        resultSchemaVersion: 'coach.result.v1',
        promptVersion: 'coach-answer-v1',
        modelVersion: 'candidate-v1',
        responseType: 'answer',
      },
    ]);
    const service = new CoachFeedbackService(
      repository,
      () => new Date('2026-09-02T00:00:00.000Z'),
    );
    const input = {
      rating: 'DOWN' as const,
      category: 'TOO_HARD' as const,
      comment: 'Please make the explanation shorter.',
    };
    const first = await service.upsert(
      'subject_hash_feedback',
      'request_feedback_001',
      'feedback-key-000001',
      input,
    );
    const replay = await service.upsert(
      'subject_hash_feedback',
      'request_feedback_001',
      'feedback-key-000001',
      input,
    );
    expect(replay).toEqual(first);
    expect(repository.feedbackCount()).toBe(1);
    expect(repository.linkFor('request_feedback_001')).toEqual({
      traceId: 'trace_feedback_001',
      resultSchemaVersion: 'coach.result.v1',
      promptVersion: 'coach-answer-v1',
      modelVersion: 'candidate-v1',
      responseType: 'answer',
    });
    await expect(
      service.upsert(
        'other_subject_hash',
        'request_feedback_001',
        'feedback-key-000002',
        input,
      ),
    ).rejects.toThrow('不存在或不可访问');
    expect(repository.feedbackCount()).toBe(1);
  });
});
