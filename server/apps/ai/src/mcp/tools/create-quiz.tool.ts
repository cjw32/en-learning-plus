import {
  MCP_SCHEMA_VERSION,
  mcpCreateQuizInputSchema,
  mcpCreateQuizSuccessSchema,
  type McpToolResult,
} from '@en/common/mcp';
import type { McpRequestContext } from '../auth/mcp-principal';
import type { McpCostMeter } from '../governance/mcp-cost-meter';
import type { McpIdempotencyService } from '../idempotency/mcp-idempotency.service';
import type { McpPersistenceIdentity } from '../persistence/mcp-subject.repository';
import type { McpLearningBridge } from '../../coach/mcp/mcp-learning.bridge';
import type { McpQuizResultProjector } from '../results/mcp-quiz-result.projector';
import { validateMcpResult } from '../results/mcp-result-validator';
import type { McpToolExecution } from './mcp-read-tool';

export const MCP_CREATE_QUIZ_MAX_RESULT_BYTES = 256 * 1024;
export const MCP_CREATE_QUIZ_DEADLINE_MS = 30_000;

export type McpCreateQuizRequest = Readonly<{
  userId: string;
  authorizationId: string;
  issuer: string;
  clientId: string;
  requestId: string;
  traceId: string;
  input: unknown;
  deadline: Date;
  signal?: AbortSignal;
}>;

export type McpCreateQuizOrchestrationPort = Readonly<{
  createQuiz(request: McpCreateQuizRequest): Promise<unknown>;
}>;

export type McpCreateQuizIdentityResolver = Readonly<{
  resolve(request: McpCreateQuizRequest): Promise<McpPersistenceIdentity>;
}>;

export class McpCreateQuizToolError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'SOURCE_RIGHTS_DENIED'
      | 'DATA_NOT_AVAILABLE'
      | 'BUDGET_EXCEEDED'
      | 'TIMEOUT'
      | 'CANCELLED'
      | 'DEPENDENCY_UNAVAILABLE'
      | 'SCHEMA_INVALID'
      | 'IDEMPOTENCY_CONFLICT'
      | 'IN_PROGRESS'
      | 'STATE_CONFLICT'
      | 'INTERNAL_ERROR',
    readonly retryable = false,
  ) {
    super('The quiz could not be created.');
    this.name = 'McpCreateQuizToolError';
  }
}

const forwardedErrorCodes = new Set([
  'RESOURCE_NOT_FOUND',
  'SOURCE_RIGHTS_DENIED',
  'DATA_NOT_AVAILABLE',
  'BUDGET_EXCEEDED',
  'TIMEOUT',
  'CANCELLED',
  'DEPENDENCY_UNAVAILABLE',
  'SCHEMA_INVALID',
  'IDEMPOTENCY_CONFLICT',
  'IN_PROGRESS',
  'STATE_CONFLICT',
]);

function effectiveDeadline(execution?: McpToolExecution): Date {
  return (
    execution?.deadline ?? new Date(Date.now() + MCP_CREATE_QUIZ_DEADLINE_MS)
  );
}

function assertNotCancelled(execution?: McpToolExecution): void {
  if (execution?.signal?.aborted) {
    throw new McpCreateQuizToolError('CANCELLED');
  }
}

function elapsed(startedAt: number, finishedAt: number): number {
  return Math.max(0, finishedAt - startedAt);
}

function codedError(code: string, retryAfterMs?: number): Error {
  return Object.assign(new Error('The quiz could not be created.'), {
    code,
    ...(retryAfterMs
      ? { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)) }
      : {}),
  });
}

export class McpCreateQuizExecutionOrchestrator implements McpCreateQuizOrchestrationPort {
  constructor(
    private readonly identities: McpCreateQuizIdentityResolver,
    private readonly idempotency: Pick<
      McpIdempotencyService,
      'beginCreateQuiz' | 'completeCreateQuiz' | 'failRetryable' | 'failFinal'
    >,
    private readonly bridge: Pick<McpLearningBridge, 'createQuiz'>,
    private readonly projector: Pick<McpQuizResultProjector, 'project'>,
    private readonly costs: Pick<McpCostMeter, 'beginQuiz'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createQuiz(request: McpCreateQuizRequest): Promise<unknown> {
    const parsed = mcpCreateQuizInputSchema.safeParse(request.input);
    if (!parsed.success) throw new McpCreateQuizToolError('VALIDATION_FAILED');
    const identity = await this.identities.resolve(request);
    if (
      identity.userId !== request.userId ||
      identity.authorizationId !== request.authorizationId ||
      identity.issuer !== request.issuer ||
      identity.clientId !== request.clientId
    ) {
      throw new McpCreateQuizToolError('RESOURCE_NOT_FOUND');
    }

    const startedAt = this.now().getTime();
    let retrievalFinishedAt = startedAt;
    let modelStartedAt = startedAt;
    let modelFinishedAt = startedAt;
    const session = this.costs.beginQuiz({ traceId: request.traceId });
    const decision = await this.idempotency.beginCreateQuiz(
      identity,
      parsed.data,
      this.now(),
    );
    if (decision.action === 'REPLAY') {
      await session.finish({
        idempotencyOutcome: 'replayed',
        cacheOutcome: 'replay',
        cancellationOutcome: 'completed',
        retrievalMs: 0,
        modelMs: 0,
        projectionMs: 0,
        totalMs: elapsed(startedAt, this.now().getTime()),
      });
      return decision.result;
    }
    if (decision.action === 'IN_PROGRESS') {
      await session.finish({
        idempotencyOutcome: 'in_progress',
        cacheOutcome: 'concurrent_loser',
        cancellationOutcome: 'completed',
        retrievalMs: 0,
        modelMs: 0,
        projectionMs: 0,
        totalMs: elapsed(startedAt, this.now().getTime()),
      });
      throw codedError('IN_PROGRESS', decision.retryAfterMs);
    }
    if (decision.action === 'TERMINAL') {
      await session.finish({
        idempotencyOutcome: 'replayed',
        cacheOutcome: 'replay',
        cancellationOutcome:
          decision.errorCode === 'CANCELLED' ? 'cancelled' : 'completed',
        retrievalMs: 0,
        modelMs: 0,
        projectionMs: 0,
        totalMs: elapsed(startedAt, this.now().getTime()),
      });
      throw codedError(decision.errorCode ?? 'STATE_CONFLICT');
    }

    try {
      const raw = await this.bridge.createQuiz({
        userId: request.userId,
        authorizationId: request.authorizationId,
        requestId: request.requestId,
        traceId: request.traceId,
        invocationId: request.requestId,
        idempotencyIntentId: decision.intent.id,
        requestFingerprint: decision.intent.requestFingerprint,
        input: parsed.data,
        deadline: request.deadline,
        ...(request.signal ? { signal: request.signal } : {}),
        onRetrievalComplete: () => {
          retrievalFinishedAt = this.now().getTime();
        },
        beforeModelCall: () => {
          modelStartedAt = this.now().getTime();
        },
        modelTelemetry: {
          onFirstOutput: session.telemetry.onFirstOutput,
          onUsage: (usage) => {
            modelFinishedAt = this.now().getTime();
            session.telemetry.onUsage(usage);
          },
        },
      });
      const projected = this.projector.project(raw, {
        traceId: request.traceId,
        requestedCount: parsed.data.count,
        requestedTypes: parsed.data.types,
        issuedCitations: raw.citations,
      });
      await this.idempotency.completeCreateQuiz(
        identity,
        decision.intent.id,
        projected,
        this.now(),
      );
      const finishedAt = this.now().getTime();
      await session.finish({
        idempotencyOutcome: 'executed',
        cacheOutcome: 'miss',
        cancellationOutcome: 'completed',
        retrievalMs: elapsed(startedAt, retrievalFinishedAt),
        modelMs: elapsed(modelStartedAt, modelFinishedAt),
        projectionMs: elapsed(modelFinishedAt, finishedAt),
        totalMs: elapsed(startedAt, finishedAt),
      });
      return projected;
    } catch (error) {
      const failedAt = this.now();
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'INTERNAL_ERROR';
      try {
        if (
          [
            'CANCELLED',
            'TIMEOUT',
            'DEPENDENCY_UNAVAILABLE',
            'DATA_NOT_AVAILABLE',
          ].includes(code)
        ) {
          await this.idempotency.failRetryable(
            identity,
            decision.intent.id,
            code,
            failedAt,
          );
        } else {
          await this.idempotency.failFinal(
            identity,
            decision.intent.id,
            forwardedErrorCodes.has(code) ? code : 'INTERNAL_ERROR',
            failedAt,
          );
        }
      } catch {
        // Preserve the original bounded failure; reconciliation owns state repair.
      }
      await session.finish({
        idempotencyOutcome: 'executed',
        cacheOutcome: 'miss',
        cancellationOutcome: code === 'CANCELLED' ? 'cancelled' : 'completed',
        retrievalMs: elapsed(startedAt, retrievalFinishedAt),
        modelMs: elapsed(modelStartedAt, modelFinishedAt),
        projectionMs: elapsed(modelFinishedAt, failedAt.getTime()),
        totalMs: elapsed(startedAt, failedAt.getTime()),
      });
      throw error;
    }
  }
}

export class McpCreateQuizTool {
  readonly name = 'create_quiz' as const;
  readonly definition = Object.freeze({
    description:
      'Create one current-user owned exercise without changing mastery, review schedules, submissions, or attempts.',
    inputSchema: mcpCreateQuizInputSchema,
    outputSchema: mcpCreateQuizSuccessSchema,
    annotations: Object.freeze({
      readOnlyHint: false as const,
      destructiveHint: false as const,
      idempotentHint: true as const,
      openWorldHint: false as const,
    }),
    _meta: Object.freeze({
      'en-learning/schemaVersion': MCP_SCHEMA_VERSION,
      'en-learning/requiredScopes': Object.freeze(['quiz:create']),
      'en-learning/effect': 'create_exercise',
      'en-learning/confirmation': 'none',
      'en-learning/idempotency': 'required',
      'en-learning/maxResultBytes': MCP_CREATE_QUIZ_MAX_RESULT_BYTES,
      'en-learning/deadlineMs': MCP_CREATE_QUIZ_DEADLINE_MS,
      'en-learning/rateLimitPolicy': 'mcp-create-quiz.v1',
      'en-learning/budgetPolicy': 'mcp-create-quiz.v1',
      'en-learning/retryPolicy': 'no-automatic-model-retry.v1',
      'en-learning/degradation': 'stable-error-no-ready-exercise',
      'en-learning/operationId': 'mcp.tool.create_quiz.v1',
    }),
  });

  constructor(private readonly orchestrator: McpCreateQuizOrchestrationPort) {}

  async execute(
    untrustedInput: unknown,
    context: McpRequestContext,
    execution?: McpToolExecution,
  ): Promise<McpToolResult> {
    assertNotCancelled(execution);
    const parsed = mcpCreateQuizInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw new McpCreateQuizToolError('VALIDATION_FAILED');

    let raw: unknown;
    try {
      raw = await this.orchestrator.createQuiz({
        userId: context.userId,
        authorizationId: context.authorizationId,
        issuer: context.principal.issuer,
        clientId: context.principal.clientId,
        requestId: context.requestId,
        traceId: context.traceId,
        input: parsed.data,
        deadline: effectiveDeadline(execution),
        ...(execution?.signal ? { signal: execution.signal } : {}),
      });
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (forwardedErrorCodes.has(code)) throw error;
      throw new McpCreateQuizToolError('INTERNAL_ERROR');
    }
    assertNotCancelled(execution);
    const result = validateMcpResult(mcpCreateQuizSuccessSchema, raw);
    if (result.traceId !== context.traceId) {
      throw new McpCreateQuizToolError('INTERNAL_ERROR');
    }
    return result;
  }
}
