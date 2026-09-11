import {
  McpCostMeter,
  type McpQuizCostMetric,
} from '../../src/mcp/governance/mcp-cost-meter';
import { MCP_SCHEMA_VERSION } from '@en/common/mcp';
import { McpCreateQuizExecutionOrchestrator } from '../../src/mcp/tools/create-quiz.tool';
import { McpQuizResultProjector } from '../../src/mcp/results/mcp-quiz-result.projector';

function fixture() {
  const metrics: McpQuizCostMetric[] = [];
  const traces: Record<string, unknown>[] = [];
  const meter = new McpCostMeter({
    sink: {
      record: () => undefined,
      recordQuiz: (metric) => metrics.push(metric),
    },
    trace: { record: async (trace) => void traces.push(trace) },
    hmacKey: 'test-mcp-quiz-cost-meter-hmac-key-000001',
    provider: 'deterministic-provider',
    model: 'quiz-model-v1',
    inputMicrosPerMillionTokens: 10_000,
    outputMicrosPerMillionTokens: 20_000,
  });
  return { meter, metrics, traces };
}

const timing = Object.freeze({
  cancellationOutcome: 'completed' as const,
  retrievalMs: 12,
  modelMs: 20,
  projectionMs: 5,
  totalMs: 37,
});

describe('MCP create_quiz one-shot idempotency cost meter', () => {
  it('records exactly one provider-reported charge and matching trace facts', async () => {
    const test = fixture();
    const session = test.meter.beginQuiz({ traceId: 'trace_quiz_cost_0001' });
    session.telemetry.onFirstOutput();
    session.telemetry.onUsage({ inputTokens: 120, outputTokens: 80 });

    const first = await session.finish({
      ...timing,
      idempotencyOutcome: 'executed',
      cacheOutcome: 'miss',
    });
    const duplicateFinish = await session.finish({
      ...timing,
      idempotencyOutcome: 'executed',
      cacheOutcome: 'miss',
    });

    expect(duplicateFinish).toBe(first);
    expect(test.metrics).toHaveLength(1);
    expect(test.metrics[0]).toMatchObject({
      schemaVersion: 'mcp.quiz-cost.v1',
      operation: 'create_quiz',
      measurementMode: 'provider-reported',
      idempotencyOutcome: 'executed',
      cacheOutcome: 'miss',
      modelExecuted: true,
      inputTokens: 120,
      outputTokens: 80,
      estimatedCostMicros: 3,
      stageTimingsMs: {
        retrieval: 12,
        model: 20,
        projection: 5,
        total: 37,
      },
    });
    expect(test.traces).toEqual([
      expect.objectContaining({
        traceId: 'trace_quiz_cost_0001',
        capabilityName: 'create_quiz',
        inputTokens: 120,
        outputTokens: 80,
        estimatedCostMicros: 3,
      }),
    ]);
    expect(
      Buffer.byteLength(JSON.stringify(test.metrics[0]), 'utf8'),
    ).toBeLessThan(2_048);
  });

  it.each([
    ['replayed', 'replay'],
    ['in_progress', 'concurrent_loser'],
  ] as const)(
    'records zero incremental model tokens/cost for %s idempotency outcomes',
    async (idempotencyOutcome, cacheOutcome) => {
      const test = fixture();
      const session = test.meter.beginQuiz({
        traceId: `trace_quiz_cost_${idempotencyOutcome}`,
      });

      await session.finish({
        ...timing,
        idempotencyOutcome,
        cacheOutcome,
        modelMs: 0,
      });

      expect(test.metrics).toHaveLength(1);
      expect(test.metrics[0]).toMatchObject({
        idempotencyOutcome,
        cacheOutcome,
        modelExecuted: false,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicros: 0,
      });
      expect(test.traces[0]).toMatchObject({
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicros: 0,
      });
    },
  );

  it('forces non-executing outcomes to zero even when supplied bad token counts', async () => {
    const test = fixture();

    const metric = await test.meter.recordQuiz({
      traceId: 'trace_quiz_cost_bad_replay',
      idempotencyOutcome: 'replayed',
      cacheOutcome: 'replay',
      cancellationOutcome: 'completed',
      modelExecuted: true,
      inputTokens: 999_999,
      outputTokens: 999_999,
      retrievalMs: 0,
      modelMs: 0,
      projectionMs: 1,
      totalMs: 1,
    });

    expect(metric).toMatchObject({
      modelExecuted: false,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMicros: 0,
    });
  });

  it('rejects a second model usage report so retries cannot double-charge', () => {
    const test = fixture();
    const session = test.meter.beginQuiz({ traceId: 'trace_quiz_cost_retry' });
    session.telemetry.onUsage({ inputTokens: 1, outputTokens: 1 });

    expect(() =>
      session.telemetry.onUsage({ inputTokens: 1, outputTokens: 1 }),
    ).toThrow('reported twice');
    expect(test.metrics).toEqual([]);
  });

  it('connects the executing idempotency winner to bridge telemetry and completion', async () => {
    const test = fixture();
    const identity = {
      issuer: 'https://issuer.mcp.test',
      subjectHmac: 'subject_hmac_quiz_cost',
      userId: 'learner_quiz_cost',
      authorizationId: 'authorization_quiz_cost',
      clientId: 'quiz-cost-client',
      audience: 'https://resource.mcp.test/ai/v1/mcp',
      authorizationVersion: 1,
    };
    const publicResult = {
      schemaVersion: MCP_SCHEMA_VERSION,
      ok: true as const,
      exerciseId: 'exercise_quiz_cost_0001',
      exerciseVersion: 'exercise.cost.v1',
      status: 'ready' as const,
      instructions: 'Choose one answer.',
      personalizationReason: 'Practises the due word agenda.',
      items: [
        {
          itemId: 'item_quiz_cost_0001',
          position: 1,
          type: 'MULTIPLE_CHOICE' as const,
          prompt: 'Which sentence uses agenda naturally?',
          choices: [
            { id: 'choice_a', text: 'Review the agenda.' },
            { id: 'choice_b', text: 'Agenda the review.' },
          ],
          maxScore: 100,
        },
      ],
      citations: [
        {
          citationId: 'cit_quiz_cost_0001',
          source: 'approved-dictionary',
          title: 'Agenda',
          excerpt: 'A list of meeting topics.',
          contentVersion: 'dictionary.v2',
          accessScope: 'PUBLIC' as const,
          status: 'active' as const,
        },
      ],
      replayed: false,
      traceId: 'trace_quiz_cost_orchestration',
    };
    const intent = {
      id: 'intent_quiz_cost_0001',
      requestFingerprint: 'a'.repeat(64),
    };
    const beginCreateQuiz = jest.fn(async () => ({
      action: 'EXECUTE' as const,
      intent,
    }));
    const completeCreateQuiz = jest.fn(async () => intent);
    const failRetryable = jest.fn();
    const failFinal = jest.fn();
    const createQuiz = jest.fn(async (request) => {
      request.onRetrievalComplete();
      request.beforeModelCall();
      request.modelTelemetry.onFirstOutput();
      request.modelTelemetry.onUsage({ inputTokens: 120, outputTokens: 80 });
      return publicResult;
    });
    let tick = Date.parse('2026-09-11T08:00:00.000Z');
    const orchestrator = new McpCreateQuizExecutionOrchestrator(
      { resolve: async () => identity },
      {
        beginCreateQuiz,
        completeCreateQuiz,
        failRetryable,
        failFinal,
      } as never,
      { createQuiz } as never,
      new McpQuizResultProjector(),
      test.meter,
      () => new Date((tick += 5)),
    );
    const orchestrationRequest = {
      userId: identity.userId,
      authorizationId: identity.authorizationId,
      issuer: identity.issuer,
      clientId: identity.clientId,
      requestId: 'request_quiz_cost_orchestration',
      traceId: publicResult.traceId,
      input: {
        schemaVersion: MCP_SCHEMA_VERSION,
        types: ['MULTIPLE_CHOICE'],
        count: 1,
        difficulty: 'MEDIUM',
        idempotencyKey: 'quiz-cost-orchestration-key',
      },
      deadline: new Date('2026-09-11T08:00:30.000Z'),
    };

    await expect(
      orchestrator.createQuiz(orchestrationRequest),
    ).resolves.toEqual(publicResult);
    expect(beginCreateQuiz).toHaveBeenCalledTimes(1);
    expect(createQuiz).toHaveBeenCalledTimes(1);
    expect(completeCreateQuiz).toHaveBeenCalledWith(
      identity,
      intent.id,
      publicResult,
      expect.any(Date),
    );
    expect(failRetryable).not.toHaveBeenCalled();
    expect(failFinal).not.toHaveBeenCalled();
    expect(test.metrics).toHaveLength(1);
    expect(test.metrics[0]).toMatchObject({
      idempotencyOutcome: 'executed',
      modelExecuted: true,
      inputTokens: 120,
      outputTokens: 80,
      estimatedCostMicros: 3,
    });
  });

  it.each([
    ['REPLAY', 'replayed', 'replay'],
    ['IN_PROGRESS', 'in_progress', 'concurrent_loser'],
  ] as const)(
    'connects %s idempotency decisions to zero-cost outcomes',
    async (action, idempotencyOutcome, cacheOutcome) => {
      const test = fixture();
      const identity = {
        issuer: 'https://issuer.mcp.test',
        subjectHmac: 'subject_hmac_quiz_cost',
        userId: 'learner_quiz_cost',
        authorizationId: 'authorization_quiz_cost',
        clientId: 'quiz-cost-client',
        audience: 'https://resource.mcp.test/ai/v1/mcp',
        authorizationVersion: 1,
      };
      const replay = {
        schemaVersion: MCP_SCHEMA_VERSION,
        ok: true,
        exerciseId: 'exercise_quiz_cost_replay',
        exerciseVersion: 'exercise.cost.v1',
        status: 'ready',
        instructions: 'Choose one answer.',
        personalizationReason: 'Uses a current learning target.',
        items: [
          {
            itemId: 'item_quiz_cost_replay',
            position: 1,
            type: 'MULTIPLE_CHOICE',
            prompt: 'Choose one.',
            choices: [
              { id: 'a', text: 'First' },
              { id: 'b', text: 'Second' },
            ],
            maxScore: 100,
          },
        ],
        citations: [
          {
            citationId: 'cit_quiz_cost_replay',
            source: 'dictionary',
            title: 'Entry',
            contentVersion: 'dictionary.v1',
            accessScope: 'PUBLIC',
            status: 'active',
          },
        ],
        replayed: true,
        traceId: 'trace_quiz_cost_replay',
      };
      const decision =
        action === 'REPLAY'
          ? { action, intent: { id: 'intent_replay' }, result: replay }
          : {
              action,
              intent: { id: 'intent_in_progress' },
              retryAfterMs: 1_000,
            };
      const bridge = { createQuiz: jest.fn() };
      const orchestrator = new McpCreateQuizExecutionOrchestrator(
        { resolve: async () => identity },
        {
          beginCreateQuiz: jest.fn(async () => decision),
          completeCreateQuiz: jest.fn(),
          failRetryable: jest.fn(),
          failFinal: jest.fn(),
        } as never,
        bridge as never,
        new McpQuizResultProjector(),
        test.meter,
      );
      const promise = orchestrator.createQuiz({
        userId: identity.userId,
        authorizationId: identity.authorizationId,
        issuer: identity.issuer,
        clientId: identity.clientId,
        requestId: 'request_quiz_cost_replay',
        traceId: 'trace_quiz_cost_replay',
        input: {
          schemaVersion: MCP_SCHEMA_VERSION,
          types: ['MULTIPLE_CHOICE'],
          count: 1,
          difficulty: 'MEDIUM',
          idempotencyKey: 'quiz-cost-replay-key-0001',
        },
        deadline: new Date(Date.now() + 30_000),
      });

      if (action === 'REPLAY') await expect(promise).resolves.toEqual(replay);
      else await expect(promise).rejects.toMatchObject({ code: 'IN_PROGRESS' });
      expect(bridge.createQuiz).not.toHaveBeenCalled();
      expect(test.metrics).toHaveLength(1);
      expect(test.metrics[0]).toMatchObject({
        idempotencyOutcome,
        cacheOutcome,
        modelExecuted: false,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicros: 0,
      });
    },
  );
});
