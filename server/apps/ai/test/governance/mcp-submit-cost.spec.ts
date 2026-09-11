import { McpCostMeter } from '../../src/mcp/governance/mcp-cost-meter';
import { MCP_SCHEMA_VERSION } from '@en/common/mcp';
import {
  McpLearningBridge,
  type McpSubmitAnswerBridgeInput,
} from '../../src/coach/mcp/mcp-learning.bridge';
import { McpOperationEnvelopeFactory } from '../../src/coach/mcp/mcp-operation-envelope.factory';

type SubmitCostOutcome =
  | 'prepared'
  | 'confirmation_poll'
  | 'replayed'
  | 'concurrent_loser'
  | 'reconciled';

type SubmitCostMetric = Readonly<{
  schemaVersion: 'mcp.submit-cost.v1';
  operation: 'submit_answer';
  correlationId: string;
  measurementMode: 'provider-reported';
  provider: string;
  model: string;
  outcome: SubmitCostOutcome;
  modelExecuted: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
  currency: 'USD';
  stageTimingsMs: Readonly<{
    grading: number;
    projection: number;
    total: number;
  }>;
}>;

type SubmitCostSession = Readonly<{
  telemetry: Readonly<{
    onFirstOutput(): void;
    onUsage(input: { inputTokens: number; outputTokens: number }): void;
  }>;
  finish(input: {
    outcome: SubmitCostOutcome;
    cancellationOutcome: 'completed' | 'cancelled';
    gradingMs: number;
    projectionMs: number;
    totalMs: number;
  }): Promise<SubmitCostMetric>;
}>;

type SubmitCostMeter = McpCostMeter &
  Readonly<{
    beginSubmit(input: { traceId: string }): SubmitCostSession;
    recordSubmit(input: {
      traceId: string;
      outcome: SubmitCostOutcome;
      cancellationOutcome: 'completed' | 'cancelled';
      modelExecuted: boolean;
      inputTokens: number;
      outputTokens: number;
      gradingMs: number;
      projectionMs: number;
      totalMs: number;
    }): Promise<SubmitCostMetric>;
  }>;

function fixture() {
  const metrics: SubmitCostMetric[] = [];
  const traces: Record<string, unknown>[] = [];
  const meter = new McpCostMeter({
    sink: {
      record: () => undefined,
      recordSubmit: (metric: SubmitCostMetric) => metrics.push(metric),
    } as never,
    trace: { record: async (trace) => void traces.push(trace) },
    hmacKey: 'test-mcp-submit-cost-meter-hmac-key-00001',
    provider: 'deterministic-provider',
    model: 'grading-model-v1',
    inputMicrosPerMillionTokens: 10_000,
    outputMicrosPerMillionTokens: 20_000,
  }) as SubmitCostMeter;
  return { meter, metrics, traces };
}

const timings = Object.freeze({
  cancellationOutcome: 'completed' as const,
  gradingMs: 25,
  projectionMs: 5,
  totalMs: 30,
});

describe('MCP submit_answer preparation and replay cost governance', () => {
  it('records one bounded provider-reported charge for the first preparation', async () => {
    const test = fixture();
    const session = test.meter.beginSubmit({
      traceId: 'trace_submit_cost_prepared_0001',
    });
    session.telemetry.onFirstOutput();
    session.telemetry.onUsage({ inputTokens: 120, outputTokens: 80 });

    const first = await session.finish({ ...timings, outcome: 'prepared' });
    const duplicateFinish = await session.finish({
      ...timings,
      outcome: 'prepared',
    });

    expect(duplicateFinish).toBe(first);
    expect(test.metrics).toHaveLength(1);
    expect(first).toMatchObject({
      schemaVersion: 'mcp.submit-cost.v1',
      operation: 'submit_answer',
      measurementMode: 'provider-reported',
      provider: 'deterministic-provider',
      model: 'grading-model-v1',
      outcome: 'prepared',
      modelExecuted: true,
      inputTokens: 120,
      outputTokens: 80,
      estimatedCostMicros: 3,
      currency: 'USD',
      stageTimingsMs: { grading: 25, projection: 5, total: 30 },
    });
    expect(Buffer.byteLength(JSON.stringify(first), 'utf8')).toBeLessThan(
      2_048,
    );
    expect(test.traces).toEqual([
      expect.objectContaining({
        traceId: 'trace_submit_cost_prepared_0001',
        capabilityName: 'submit_answer',
        inputTokens: 120,
        outputTokens: 80,
        estimatedCostMicros: 3,
      }),
    ]);
  });

  it.each([
    'confirmation_poll',
    'replayed',
    'concurrent_loser',
    'reconciled',
  ] as const)(
    'forces %s to zero incremental model tokens and cost',
    async (outcome) => {
      const test = fixture();

      const metric = await test.meter.recordSubmit({
        traceId: `trace_submit_cost_${outcome}`,
        outcome,
        cancellationOutcome: 'completed',
        modelExecuted: true,
        inputTokens: 999_999,
        outputTokens: 999_999,
        gradingMs: 999,
        projectionMs: 5,
        totalMs: 1_004,
      });

      expect(metric).toMatchObject({
        outcome,
        modelExecuted: false,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicros: 0,
      });
      expect(test.metrics).toEqual([metric]);
      expect(test.traces[0]).toMatchObject({
        capabilityName: 'submit_answer',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicros: 0,
      });
    },
  );

  it('rejects duplicate provider usage so grading cannot be charged twice', () => {
    const test = fixture();
    const session = test.meter.beginSubmit({
      traceId: 'trace_submit_cost_duplicate_usage',
    });
    session.telemetry.onUsage({ inputTokens: 10, outputTokens: 5 });

    expect(() =>
      session.telemetry.onUsage({ inputTokens: 10, outputTokens: 5 }),
    ).toThrow('reported twice');
    expect(test.metrics).toEqual([]);
  });

  it('records cancellation before model usage as zero cost', async () => {
    const test = fixture();
    const session = test.meter.beginSubmit({
      traceId: 'trace_submit_cost_cancelled',
    });

    await expect(
      session.finish({
        outcome: 'prepared',
        cancellationOutcome: 'cancelled',
        gradingMs: 0,
        projectionMs: 0,
        totalMs: 1,
      }),
    ).resolves.toMatchObject({
      outcome: 'prepared',
      modelExecuted: false,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMicros: 0,
    });
    expect(test.metrics).toHaveLength(1);
  });
});

const preparationNow = new Date('2026-09-11T08:00:00.000Z');
const preparationInput = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  exerciseId: 'exercise_submit_cost_0001',
  exerciseVersion: 'exercise-version-v1',
  answers: Object.freeze([
    Object.freeze({ itemId: 'item_1', value: 'A concise answer.' }),
  ]),
  idempotencyKey: 'submit-cost-idempotency-0001',
});
const preparationRequest: Omit<McpSubmitAnswerBridgeInput, 'preparations'> =
  Object.freeze({
    identity: Object.freeze({
      issuer: 'https://issuer.example.test',
      subjectHmac: 'subject_hmac_submit_cost_a',
      userId: 'learner_submit_cost_a',
      authorizationId: 'authorization_submit_cost_a',
      clientId: 'client_submit_cost_a',
      audience: 'https://api.example.test/mcp',
      authorizationVersion: 1,
    }),
    userId: 'learner_submit_cost_a',
    authorizationId: 'authorization_submit_cost_a',
    requestId: 'request_submit_cost_0001',
    traceId: 'trace_submit_bridge_0001',
    invocationId: 'invocation_submit_cost_0001',
    idempotencyIntentId: 'intent_submit_cost_0001',
    requestFingerprint: 'a'.repeat(64),
    input: preparationInput,
    deadline: new Date('2026-09-11T08:00:30.000Z'),
  });

function bridgeFixture() {
  const cost = fixture();
  let staged: unknown;
  const authoritativeWrites = {
    submission: jest.fn(),
    attempt: jest.fn(),
    review: jest.fn(),
  };
  const model = {
    gradeSubjective: jest.fn(async (_input, signal, telemetry) => {
      if (signal?.aborted)
        throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
      telemetry?.onFirstOutput();
      telemetry?.onUsage({ inputTokens: 120, outputTokens: 80 });
      return {
        scoreRatio: 0.8,
        isCorrect: true,
        correction: '',
        explanation: 'Clear and relevant.',
        errorTypes: [],
        examples: [],
      };
    }),
  };
  const prepareOwned = jest.fn(async (input) => {
    await input.subjective?.evaluate({
      exerciseType: 'SITUATIONAL_DIALOGUE',
      prompt: 'Answer briefly.',
      answer: 'A concise answer.',
      referenceAnswer: null,
      controlledRubric: {},
      maxScore: 100,
    });
    return {
      status: 'GRADED_VALID' as const,
      exerciseId: preparationInput.exerciseId,
      exerciseVersion: preparationInput.exerciseVersion,
      citations: [],
      result: {
        status: 'GRADED_VALID' as const,
        answerVersion: 'b'.repeat(64),
        gradingHash: 'c'.repeat(64),
        score: 80,
        correction: '',
        explanation: 'Clear and relevant.',
        examples: [],
        errorTypes: [],
        items: [
          {
            itemId: 'item_1',
            isCorrect: true,
            score: 80,
            correction: '',
            explanation: 'Clear and relevant.',
            errorTypes: [],
            examples: [],
            targetQualities: [
              { targetType: 'WORD' as const, targetKey: 'word_1', quality: 4 },
            ],
          },
        ],
      },
    };
  });
  const loadSubmitPreparation = jest.fn(async () =>
    staged
      ? {
          intent: { exerciseId: preparationInput.exerciseId },
          gradingResult: staged,
          gradingResultHash: 'd'.repeat(64),
        }
      : null,
  );
  const stageSubmitPreparation = jest.fn(async (_identity, input) => {
    staged = input.gradingResult;
    return {
      intent: { exerciseId: input.exerciseId },
      gradingResult: staged,
      gradingResultHash: 'd'.repeat(64),
    };
  });
  const persistMcpOperationEnvelope = jest.fn(async (envelope) => envelope);
  const bridge = new McpLearningBridge(
    { searchV2: jest.fn() } as never,
    undefined,
    cost.meter,
    () => preparationNow,
    undefined,
    {
      grading: { prepareOwned },
      envelopes: {
        create: new McpOperationEnvelopeFactory({
          hmacKey: 'submit-cost-envelope-key-at-least-32-bytes',
          envelopeTtlMs: 24 * 60 * 60 * 1_000,
        }).create.bind(
          new McpOperationEnvelopeFactory({
            hmacKey: 'submit-cost-envelope-key-at-least-32-bytes',
            envelopeTtlMs: 24 * 60 * 60 * 1_000,
          }),
        ),
      },
      conversations: { persistMcpOperationEnvelope },
      model,
    } as never,
  );
  return {
    ...cost,
    bridge,
    prepareOwned,
    loadSubmitPreparation,
    stageSubmitPreparation,
    persistMcpOperationEnvelope,
    model,
    authoritativeWrites,
    preparations: { loadSubmitPreparation, stageSubmitPreparation },
  };
}

describe('MCP constrained pre-confirmation grading bridge', () => {
  it('stages one read-only preparation and replays it without another model charge', async () => {
    const test = bridgeFixture();

    const first = await test.bridge.prepareSubmitAnswer({
      ...preparationRequest,
      preparations: test.preparations,
    });
    const replay = await test.bridge.prepareSubmitAnswer({
      ...preparationRequest,
      preparations: test.preparations,
      traceId: 'trace_submit_bridge_0002',
      requestId: 'request_submit_cost_0002',
    });

    expect(replay).toEqual(first);
    expect(test.prepareOwned).toHaveBeenCalledTimes(1);
    expect(test.model.gradeSubjective).toHaveBeenCalledTimes(1);
    expect(test.stageSubmitPreparation).toHaveBeenCalledTimes(1);
    expect(test.persistMcpOperationEnvelope).toHaveBeenCalledTimes(1);
    expect(test.metrics).toHaveLength(2);
    expect(test.metrics[0]).toMatchObject({
      outcome: 'prepared',
      modelExecuted: true,
      estimatedCostMicros: 3,
    });
    expect(test.metrics[1]).toMatchObject({
      outcome: 'replayed',
      modelExecuted: false,
      estimatedCostMicros: 0,
    });
    expect(test.authoritativeWrites.submission).not.toHaveBeenCalled();
    expect(test.authoritativeWrites.attempt).not.toHaveBeenCalled();
    expect(test.authoritativeWrites.review).not.toHaveBeenCalled();
    expect(JSON.stringify(first)).not.toMatch(
      /answerKey|gradingRubric|referenceAnswer/iu,
    );
  });

  it('rejects an elapsed deadline before envelope, grading, staging, or model work', async () => {
    const test = bridgeFixture();

    await expect(
      test.bridge.prepareSubmitAnswer({
        ...preparationRequest,
        preparations: test.preparations,
        deadline: preparationNow,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(test.loadSubmitPreparation).not.toHaveBeenCalled();
    expect(test.persistMcpOperationEnvelope).not.toHaveBeenCalled();
    expect(test.prepareOwned).not.toHaveBeenCalled();
    expect(test.stageSubmitPreparation).not.toHaveBeenCalled();
    expect(test.model.gradeSubjective).not.toHaveBeenCalled();
  });

  it('propagates cancellation and starts no staging after an aborted grade', async () => {
    const test = bridgeFixture();
    const controller = new AbortController();
    test.model.gradeSubjective.mockImplementationOnce(
      async (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () =>
              reject(
                Object.assign(new Error('cancelled'), { code: 'CANCELLED' }),
              ),
            { once: true },
          );
          controller.abort();
        }),
    );

    await expect(
      test.bridge.prepareSubmitAnswer({
        ...preparationRequest,
        preparations: test.preparations,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(test.stageSubmitPreparation).not.toHaveBeenCalled();
    expect(test.authoritativeWrites.submission).not.toHaveBeenCalled();
    expect(test.authoritativeWrites.attempt).not.toHaveBeenCalled();
    expect(test.authoritativeWrites.review).not.toHaveBeenCalled();
  });
});
