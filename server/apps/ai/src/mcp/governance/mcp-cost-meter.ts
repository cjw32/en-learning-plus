import { createHmac } from 'node:crypto';

export type McpRagCostMetric = Readonly<{
  schemaVersion: 'mcp.rag-cost.v1';
  operation: 'search_learning_materials';
  correlationId: string;
  measurementMode: 'estimated';
  tokenCountMode: 'utf8-byte-upper-bound';
  provider: string;
  model: string;
  cacheOutcome: 'hit' | 'miss' | 'bypass';
  cancellationOutcome: 'completed' | 'cancelled';
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
  currency: 'USD';
  stageTimingsMs: Readonly<{
    retrieval: number;
    projection: number;
    total: number;
  }>;
}>;

export type McpQuizCostMetric = Readonly<{
  schemaVersion: 'mcp.quiz-cost.v1';
  operation: 'create_quiz';
  correlationId: string;
  measurementMode: 'provider-reported';
  provider: string;
  model: string;
  idempotencyOutcome: 'executed' | 'replayed' | 'in_progress';
  cacheOutcome: 'miss' | 'replay' | 'concurrent_loser';
  cancellationOutcome: 'completed' | 'cancelled';
  modelExecuted: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
  currency: 'USD';
  stageTimingsMs: Readonly<{
    retrieval: number;
    model: number;
    projection: number;
    total: number;
  }>;
}>;

export type McpSubmitCostOutcome =
  | 'prepared'
  | 'confirmation_poll'
  | 'replayed'
  | 'concurrent_loser'
  | 'reconciled';

export type McpSubmitCostMetric = Readonly<{
  schemaVersion: 'mcp.submit-cost.v1';
  operation: 'submit_answer';
  correlationId: string;
  measurementMode: 'provider-reported';
  provider: string;
  model: string;
  outcome: McpSubmitCostOutcome;
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

export interface McpCostMetricSink {
  record(metric: McpRagCostMetric): Promise<void> | void;
  recordQuiz?(metric: McpQuizCostMetric): Promise<void> | void;
  recordSubmit?(metric: McpSubmitCostMetric): Promise<void> | void;
}

export type McpQuizModelTelemetry = Readonly<{
  onFirstOutput(): void;
  onUsage(input: { inputTokens: number; outputTokens: number }): void;
}>;

export type McpQuizCostSession = Readonly<{
  telemetry: McpQuizModelTelemetry;
  finish(
    input: Readonly<{
      idempotencyOutcome: McpQuizCostMetric['idempotencyOutcome'];
      cacheOutcome: McpQuizCostMetric['cacheOutcome'];
      cancellationOutcome: McpQuizCostMetric['cancellationOutcome'];
      retrievalMs: number;
      modelMs: number;
      projectionMs: number;
      totalMs: number;
    }>,
  ): Promise<McpQuizCostMetric>;
}>;

export type McpSubmitCostSession = Readonly<{
  telemetry: McpQuizModelTelemetry;
  finish(
    input: Readonly<{
      outcome: McpSubmitCostOutcome;
      cancellationOutcome: 'completed' | 'cancelled';
      gradingMs: number;
      projectionMs: number;
      totalMs: number;
    }>,
  ): Promise<McpSubmitCostMetric>;
}>;

type Options = Readonly<{
  sink: McpCostMetricSink;
  hmacKey: string;
  provider: string;
  model: string;
  inputMicrosPerMillionTokens: number;
  outputMicrosPerMillionTokens: number;
  trace?: Readonly<{ record(input: Record<string, unknown>): Promise<void> }>;
}>;

const noOpSink: McpCostMetricSink = Object.freeze({ record: () => undefined });
const defaultOptions: Options = Object.freeze({
  sink: noOpSink,
  hmacKey: 'disabled-mcp-cost-meter-hmac-key',
  provider: 'unapproved',
  model: 'unapproved',
  inputMicrosPerMillionTokens: 0,
  outputMicrosPerMillionTokens: 0,
});

function boundedInteger(value: number, maximum: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(maximum, Math.round(value));
}

function safeLabel(value: string): string {
  const normalized = value.normalize('NFKC').trim();
  if (
    !normalized ||
    normalized.length > 128 ||
    /\p{Cc}|bearer|eyJ[A-Za-z0-9_-]{8,}\./iu.test(normalized)
  ) {
    return 'unavailable';
  }
  return normalized;
}

export class McpCostMeter {
  private readonly options: Options;

  constructor(options: Options = defaultOptions) {
    if (
      Buffer.byteLength(options.hmacKey, 'utf8') < 32 ||
      !Number.isSafeInteger(options.inputMicrosPerMillionTokens) ||
      options.inputMicrosPerMillionTokens < 0 ||
      !Number.isSafeInteger(options.outputMicrosPerMillionTokens) ||
      options.outputMicrosPerMillionTokens < 0
    ) {
      throw new Error('Invalid MCP cost meter configuration');
    }
    this.options = options;
  }

  async recordRag(
    input: Readonly<{
      traceId: string;
      inputTokens: number;
      outputTokens: number;
      cacheOutcome: 'hit' | 'miss' | 'bypass';
      cancellationOutcome: 'completed' | 'cancelled';
      retrievalMs: number;
      projectionMs: number;
      totalMs: number;
    }>,
  ): Promise<McpRagCostMetric> {
    const inputTokens = boundedInteger(input.inputTokens, 1_000_000);
    const outputTokens = boundedInteger(input.outputTokens, 1_000_000);
    const estimatedCostMicros = Math.min(
      100_000_000,
      Math.ceil(
        (inputTokens * this.options.inputMicrosPerMillionTokens +
          outputTokens * this.options.outputMicrosPerMillionTokens) /
          1_000_000,
      ),
    );
    const metric = Object.freeze({
      schemaVersion: 'mcp.rag-cost.v1' as const,
      operation: 'search_learning_materials' as const,
      correlationId: `mcp_corr_${createHmac('sha256', this.options.hmacKey)
        .update(input.traceId)
        .digest('hex')
        .slice(0, 24)}`,
      measurementMode: 'estimated' as const,
      tokenCountMode: 'utf8-byte-upper-bound' as const,
      provider: safeLabel(this.options.provider),
      model: safeLabel(this.options.model),
      cacheOutcome: input.cacheOutcome,
      cancellationOutcome: input.cancellationOutcome,
      inputTokens,
      outputTokens,
      estimatedCostMicros,
      currency: 'USD' as const,
      stageTimingsMs: Object.freeze({
        retrieval: boundedInteger(input.retrievalMs, 30_000),
        projection: boundedInteger(input.projectionMs, 30_000),
        total: boundedInteger(input.totalMs, 30_000),
      }),
    });
    if (Buffer.byteLength(JSON.stringify(metric), 'utf8') > 2_048) {
      throw new Error('MCP cost metric exceeds its safe bound');
    }
    await this.options.sink.record(metric);
    return metric;
  }

  beginQuiz(input: Readonly<{ traceId: string }>): McpQuizCostSession {
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let finished: Promise<McpQuizCostMetric> | undefined;
    const telemetry: McpQuizModelTelemetry = Object.freeze({
      onFirstOutput: () => undefined,
      onUsage: (reported) => {
        if (usage) throw new Error('MCP quiz model usage was reported twice');
        usage = {
          inputTokens: boundedInteger(reported.inputTokens, 1_000_000),
          outputTokens: boundedInteger(reported.outputTokens, 1_000_000),
        };
      },
    });
    return Object.freeze({
      telemetry,
      finish: (outcome) => {
        finished ??= this.recordQuiz({
          traceId: input.traceId,
          ...outcome,
          modelExecuted: usage !== undefined,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
        });
        return finished;
      },
    });
  }

  beginSubmit(input: Readonly<{ traceId: string }>): McpSubmitCostSession {
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let finished: Promise<McpSubmitCostMetric> | undefined;
    const telemetry: McpQuizModelTelemetry = Object.freeze({
      onFirstOutput: () => undefined,
      onUsage: (reported) => {
        if (usage) throw new Error('MCP submit model usage was reported twice');
        usage = {
          inputTokens: boundedInteger(reported.inputTokens, 1_000_000),
          outputTokens: boundedInteger(reported.outputTokens, 1_000_000),
        };
      },
    });
    return Object.freeze({
      telemetry,
      finish: (outcome) => {
        finished ??= this.recordSubmit({
          traceId: input.traceId,
          ...outcome,
          modelExecuted: usage !== undefined,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
        });
        return finished;
      },
    });
  }

  async recordSubmit(
    input: Readonly<{
      traceId: string;
      outcome: McpSubmitCostOutcome;
      cancellationOutcome: 'completed' | 'cancelled';
      modelExecuted: boolean;
      inputTokens: number;
      outputTokens: number;
      gradingMs: number;
      projectionMs: number;
      totalMs: number;
    }>,
  ): Promise<McpSubmitCostMetric> {
    const chargeable = input.outcome === 'prepared' && input.modelExecuted;
    const inputTokens = chargeable
      ? boundedInteger(input.inputTokens, 1_000_000)
      : 0;
    const outputTokens = chargeable
      ? boundedInteger(input.outputTokens, 1_000_000)
      : 0;
    const estimatedCostMicros = chargeable
      ? Math.min(
          100_000_000,
          Math.ceil(
            (inputTokens * this.options.inputMicrosPerMillionTokens +
              outputTokens * this.options.outputMicrosPerMillionTokens) /
              1_000_000,
          ),
        )
      : 0;
    const metric = Object.freeze({
      schemaVersion: 'mcp.submit-cost.v1' as const,
      operation: 'submit_answer' as const,
      correlationId: `mcp_corr_${createHmac('sha256', this.options.hmacKey)
        .update(input.traceId)
        .digest('hex')
        .slice(0, 24)}`,
      measurementMode: 'provider-reported' as const,
      provider: safeLabel(this.options.provider),
      model: safeLabel(this.options.model),
      outcome: input.outcome,
      modelExecuted: chargeable,
      inputTokens,
      outputTokens,
      estimatedCostMicros,
      currency: 'USD' as const,
      stageTimingsMs: Object.freeze({
        grading: boundedInteger(input.gradingMs, 30_000),
        projection: boundedInteger(input.projectionMs, 30_000),
        total: boundedInteger(input.totalMs, 30_000),
      }),
    });
    if (Buffer.byteLength(JSON.stringify(metric), 'utf8') > 2_048) {
      throw new Error('MCP cost metric exceeds its safe bound');
    }
    await this.options.sink.recordSubmit?.(metric);
    await this.options.trace?.record({
      traceId: input.traceId,
      protocolMethod: 'tools/call',
      capabilityType: 'TOOL',
      capabilityName: 'submit_answer',
      capabilityVersion: 'en-learning.mcp.v1',
      capabilityEffect: 'UPDATE_LEARNING_STATE',
      terminalStatus:
        input.cancellationOutcome === 'cancelled' ? 'CANCELLED' : 'COMPLETED',
      retryCount: 0,
      cancelled: input.cancellationOutcome === 'cancelled',
      inputTokens,
      outputTokens,
      estimatedCostMicros,
      diagnostic: {
        operation: 'submit_answer',
        policyVersion: 'mcp-submit-answer.v1',
        inputTokens,
        outputTokens,
        costMicros: estimatedCostMicros,
        durationMs: metric.stageTimingsMs.total,
      },
    });
    return metric;
  }

  async recordQuiz(
    input: Readonly<{
      traceId: string;
      idempotencyOutcome: McpQuizCostMetric['idempotencyOutcome'];
      cacheOutcome: McpQuizCostMetric['cacheOutcome'];
      cancellationOutcome: McpQuizCostMetric['cancellationOutcome'];
      modelExecuted: boolean;
      inputTokens: number;
      outputTokens: number;
      retrievalMs: number;
      modelMs: number;
      projectionMs: number;
      totalMs: number;
    }>,
  ): Promise<McpQuizCostMetric> {
    const chargeable =
      input.idempotencyOutcome === 'executed' &&
      input.cacheOutcome === 'miss' &&
      input.modelExecuted;
    const inputTokens = chargeable
      ? boundedInteger(input.inputTokens, 1_000_000)
      : 0;
    const outputTokens = chargeable
      ? boundedInteger(input.outputTokens, 1_000_000)
      : 0;
    const estimatedCostMicros = chargeable
      ? Math.min(
          100_000_000,
          Math.ceil(
            (inputTokens * this.options.inputMicrosPerMillionTokens +
              outputTokens * this.options.outputMicrosPerMillionTokens) /
              1_000_000,
          ),
        )
      : 0;
    const metric = Object.freeze({
      schemaVersion: 'mcp.quiz-cost.v1' as const,
      operation: 'create_quiz' as const,
      correlationId: `mcp_corr_${createHmac('sha256', this.options.hmacKey)
        .update(input.traceId)
        .digest('hex')
        .slice(0, 24)}`,
      measurementMode: 'provider-reported' as const,
      provider: safeLabel(this.options.provider),
      model: safeLabel(this.options.model),
      idempotencyOutcome: input.idempotencyOutcome,
      cacheOutcome: input.cacheOutcome,
      cancellationOutcome: input.cancellationOutcome,
      modelExecuted: chargeable,
      inputTokens,
      outputTokens,
      estimatedCostMicros,
      currency: 'USD' as const,
      stageTimingsMs: Object.freeze({
        retrieval: boundedInteger(input.retrievalMs, 30_000),
        model: boundedInteger(input.modelMs, 30_000),
        projection: boundedInteger(input.projectionMs, 30_000),
        total: boundedInteger(input.totalMs, 30_000),
      }),
    });
    if (Buffer.byteLength(JSON.stringify(metric), 'utf8') > 2_048) {
      throw new Error('MCP quiz cost metric exceeds its safe bound');
    }
    await this.options.sink.recordQuiz?.(metric);
    await this.options.trace?.record({
      traceId: input.traceId,
      protocolMethod: 'tools/call',
      capabilityType: 'TOOL',
      capabilityName: 'create_quiz',
      capabilityVersion: 'en-learning.mcp.v1',
      capabilityEffect: 'CREATE_EXERCISE',
      terminalStatus:
        input.cancellationOutcome === 'cancelled' ? 'CANCELLED' : 'COMPLETED',
      retryCount: 0,
      cancelled: input.cancellationOutcome === 'cancelled',
      inputTokens,
      outputTokens,
      estimatedCostMicros,
      diagnostic: {
        operation: 'create_quiz',
        policyVersion: 'mcp-create-quiz.v1',
        inputTokens,
        outputTokens,
        costMicros: estimatedCostMicros,
        durationMs: metric.stageTimingsMs.total,
      },
    });
    return metric;
  }
}
