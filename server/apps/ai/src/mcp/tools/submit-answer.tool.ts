import { createHash } from 'node:crypto';
import {
  MCP_SCHEMA_VERSION,
  mcpConfirmationRequiredSchema,
  mcpSubmitAnswerInputSchema,
  mcpSubmitAnswerSuccessSchema,
  type McpToolResult,
} from '@en/common/mcp';
import type {
  LearningWriteEffectService,
  McpSubmitAnswerService,
} from '@libs/learning';
import { mcpSubmitAnswerDigest } from '@libs/learning';
import type {
  McpLearningBridge,
  McpSubmitPreparation,
} from '../../coach/mcp/mcp-learning.bridge';
import type { McpRequestContext } from '../auth/mcp-principal';
import type { McpWriteConfirmationRecord } from '../confirmation/write-confirmation.repository';
import type { WriteConfirmationService } from '../confirmation/write-confirmation.service';
import type { McpSubmitReconciliationService } from '../confirmation/mcp-submit-reconciliation.service';
import type { McpCostMeter } from '../governance/mcp-cost-meter';
import type {
  McpIdempotencyDecision,
  McpIdempotencyService,
} from '../idempotency/mcp-idempotency.service';
import type { McpPersistenceIdentity } from '../persistence/mcp-subject.repository';
import { validateMcpResult } from '../results/mcp-result-validator';
import type { McpToolExecution } from './mcp-read-tool';

export const MCP_SUBMIT_ANSWER_DEADLINE_MS = 30_000;
export const MCP_SUBMIT_ANSWER_MAX_RESULT_BYTES = 256 * 1_024;

export type McpSubmitAnswerRequest = Readonly<{
  userId: string;
  authorizationId: string;
  issuer: string;
  clientId: string;
  requestId: string;
  traceId: string;
  context: McpRequestContext;
  input: unknown;
  deadline: Date;
  signal?: AbortSignal;
  sessionId?: string;
}>;

export type McpSubmitAnswerIdentityResolver = Readonly<{
  resolve(request: McpSubmitAnswerRequest): Promise<McpPersistenceIdentity>;
}>;

export type McpSubmitConfirmationPresentationPort = Readonly<{
  present(
    input: Readonly<{
      confirmationId: string;
      selector: string;
      elicitationId: string;
      intentDigest: string;
      expiresAt: Date;
      context: McpRequestContext;
      sessionId?: string;
    }>,
  ): Promise<unknown>;
}>;

export class McpSubmitAnswerToolError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'IDEMPOTENCY_CONFLICT'
      | 'CONFIRMATION_EXPIRED'
      | 'CONFIRMATION_STATE_CONFLICT'
      | 'IN_PROGRESS'
      | 'STATE_CONFLICT'
      | 'BUDGET_EXCEEDED'
      | 'TIMEOUT'
      | 'CANCELLED'
      | 'DEPENDENCY_UNAVAILABLE'
      | 'SCHEMA_INVALID'
      | 'INTERNAL_ERROR',
    readonly retryable = false,
  ) {
    super('The answer could not be submitted.');
    this.name = 'McpSubmitAnswerToolError';
  }
}

function assertOpen(signal: AbortSignal | undefined, deadline: Date): void {
  if (signal?.aborted) throw new McpSubmitAnswerToolError('CANCELLED');
  if (deadline.getTime() <= Date.now()) {
    throw new McpSubmitAnswerToolError('TIMEOUT');
  }
}

function scopeSnapshotDigest(context: McpRequestContext): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        issuer: context.principal.issuer,
        clientId: context.principal.clientId,
        authorizationVersion: context.principal.authorizationVersion,
        scopes: [...context.principal.scopes].sort(),
      }),
    )
    .digest('hex');
}

function elicitationId(confirmationId: string): string {
  return `elicitation_${createHash('sha256')
    .update(confirmationId, 'utf8')
    .digest('hex')
    .slice(0, 24)}`;
}

function retryAfterError(
  decision: Extract<McpIdempotencyDecision, { action: 'IN_PROGRESS' }>,
) {
  return Object.assign(new McpSubmitAnswerToolError('IN_PROGRESS', true), {
    retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)),
  });
}

const forwardedCodes = new Set([
  'VALIDATION_FAILED',
  'RESOURCE_NOT_FOUND',
  'IDEMPOTENCY_CONFLICT',
  'CONFIRMATION_EXPIRED',
  'CONFIRMATION_STATE_CONFLICT',
  'IN_PROGRESS',
  'STATE_CONFLICT',
  'BUDGET_EXCEEDED',
  'TIMEOUT',
  'CANCELLED',
  'DEPENDENCY_UNAVAILABLE',
  'SCHEMA_INVALID',
]);

export class McpSubmitAnswerOrchestrator {
  constructor(
    private readonly identities: McpSubmitAnswerIdentityResolver,
    private readonly idempotency: Pick<
      McpIdempotencyService,
      'beginSubmitAnswer' | 'loadSubmitPreparation' | 'stageSubmitPreparation'
    >,
    private readonly bridge: Pick<McpLearningBridge, 'prepareSubmitAnswer'>,
    private readonly confirmations: Pick<
      WriteConfirmationService,
      'create' | 'findForSubmit'
    >,
    private readonly effects: Pick<LearningWriteEffectService, 'summarize'>,
    private readonly finalizer: Pick<
      McpSubmitAnswerService,
      'finalizeConfirmed'
    >,
    private readonly reconciliation: Pick<
      McpSubmitReconciliationService,
      'reconcile'
    >,
    private readonly presenter: McpSubmitConfirmationPresentationPort,
    private readonly costs: Pick<McpCostMeter, 'recordSubmit'>,
    private readonly now: () => Date = () => new Date(),
    private readonly createSubmissionId: (intentId: string) => string = (
      intentId,
    ) =>
      `submission_${createHash('sha256')
        .update(`mcp-submit\0${intentId}`, 'utf8')
        .digest('hex')
        .slice(0, 24)}`,
  ) {}

  async submit(request: McpSubmitAnswerRequest): Promise<unknown> {
    const parsed = mcpSubmitAnswerInputSchema.safeParse(request.input);
    if (!parsed.success)
      throw new McpSubmitAnswerToolError('VALIDATION_FAILED');
    assertOpen(request.signal, request.deadline);
    const identity = await this.identities.resolve(request);
    if (
      identity.userId !== request.userId ||
      identity.authorizationId !== request.authorizationId ||
      identity.issuer !== request.issuer ||
      identity.clientId !== request.clientId
    ) {
      throw new McpSubmitAnswerToolError('RESOURCE_NOT_FOUND');
    }
    const decision = await this.idempotency.beginSubmitAnswer(
      identity,
      parsed.data,
      this.now(),
    );
    if (decision.action === 'REPLAY') {
      await this.zeroCost(request, 'replayed');
      return this.replay(decision.result, request.traceId);
    }
    if (decision.action === 'TERMINAL') {
      throw new McpSubmitAnswerToolError(
        forwardedCodes.has(decision.errorCode ?? '')
          ? (decision.errorCode as McpSubmitAnswerToolError['code'])
          : 'STATE_CONFLICT',
      );
    }
    if (decision.action === 'RECONCILE') {
      const reconciled = await this.reconciliation.reconcile(
        identity,
        decision.intent.id,
        request.signal ? { signal: request.signal } : undefined,
      );
      await this.zeroCost(request, 'reconciled');
      if (
        reconciled.status === 'recovered' ||
        reconciled.status === 'already_completed'
      ) {
        return this.replay(reconciled.result, request.traceId);
      }
      throw new McpSubmitAnswerToolError('IN_PROGRESS', true);
    }
    if (decision.action === 'IN_PROGRESS') {
      const confirmation = await this.confirmations.findForSubmit(
        identity,
        decision.intent.id,
      );
      if (!confirmation) throw retryAfterError(decision);
      if (confirmation.state === 'PENDING') {
        await this.zeroCost(request, 'confirmation_poll');
        return validateMcpResult(mcpConfirmationRequiredSchema, {
          schemaVersion: MCP_SCHEMA_VERSION,
          ok: false,
          status: 'confirmation_pending',
          expiresAt: confirmation.expiresAt.toISOString(),
          operationSummary: this.operationSummaryText(confirmation),
          traceId: request.traceId,
        });
      }
      if (confirmation.state === 'CONFIRMED') {
        return this.finalize(
          identity,
          decision.intent.requestFingerprint,
          confirmation,
          parsed.data,
          request,
        );
      }
      if (
        confirmation.state === 'CLAIMED' ||
        confirmation.state === 'CONSUMED'
      ) {
        const reconciled = await this.reconciliation.reconcile(
          identity,
          decision.intent.id,
          request.signal ? { signal: request.signal } : undefined,
        );
        await this.zeroCost(request, 'reconciled');
        if (
          reconciled.status === 'recovered' ||
          reconciled.status === 'already_completed'
        ) {
          return this.replay(reconciled.result, request.traceId);
        }
        throw retryAfterError(decision);
      }
      throw new McpSubmitAnswerToolError('CONFIRMATION_STATE_CONFLICT');
    }

    const prepared = await this.bridge.prepareSubmitAnswer({
      identity,
      userId: request.userId,
      authorizationId: request.authorizationId,
      requestId: request.requestId,
      traceId: request.traceId,
      invocationId: request.requestId,
      idempotencyIntentId: decision.intent.id,
      requestFingerprint: decision.intent.requestFingerprint,
      preparations: this.idempotency,
      input: parsed.data,
      deadline: request.deadline,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    assertOpen(request.signal, request.deadline);
    const summary = this.effects.summarize({
      answerCount: parsed.data.answers.length,
    });
    const scopeDigest = scopeSnapshotDigest(request.context);
    const answerDigest = mcpSubmitAnswerDigest(
      parsed.data.answers.map(({ itemId, value }) => ({
        itemId,
        response: value,
      })),
    );
    const created = await this.confirmations.create(identity, {
      idempotencyIntentId: decision.intent.id,
      scopeSnapshotDigest: scopeDigest,
      exerciseId: parsed.data.exerciseId,
      exerciseVersion: parsed.data.exerciseVersion,
      answerDigest,
      operationSummary: summary,
      clientDisplayName: request.clientId.slice(0, 120),
      itemCount: parsed.data.answers.length,
    });
    return this.presenter.present({
      confirmationId: created.confirmation.id,
      selector: created.selector,
      elicitationId: elicitationId(created.confirmation.id),
      intentDigest: decision.intent.requestFingerprint,
      expiresAt: created.confirmation.expiresAt,
      context: request.context,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    });
  }

  private async finalize(
    identity: McpPersistenceIdentity,
    intentRequestFingerprint: string,
    confirmation: McpWriteConfirmationRecord,
    input: ReturnType<typeof mcpSubmitAnswerInputSchema.parse>,
    request: McpSubmitAnswerRequest,
  ): Promise<McpToolResult> {
    assertOpen(request.signal, request.deadline);
    const staged = await this.idempotency.loadSubmitPreparation(
      identity,
      confirmation.idempotencyIntentId,
      intentRequestFingerprint,
    );
    if (!staged) throw new McpSubmitAnswerToolError('STATE_CONFLICT');
    const prepared = staged.gradingResult as McpSubmitPreparation;
    const result = await this.finalizer.finalizeConfirmed(identity, {
      schemaVersion: MCP_SCHEMA_VERSION,
      intentId: confirmation.idempotencyIntentId,
      confirmationId: confirmation.id,
      exerciseId: input.exerciseId,
      exerciseVersion: input.exerciseVersion,
      answers: input.answers.map(({ itemId, value }) => ({
        itemId,
        response: value,
      })),
      idempotencyKey: input.idempotencyKey,
      grading: {
        submissionId: this.createSubmissionId(confirmation.idempotencyIntentId),
        gradeRequestId: prepared.gradeRequestId,
        stagingHash: staged.gradingResultHash,
        gradingHash: prepared.gradingHash,
        score: prepared.score,
        items: prepared.items,
        learningChanges: [],
      },
      traceId: request.traceId,
      intentRequestFingerprint,
      answerDigest: confirmation.answerDigest,
      operationSummaryDigest: confirmation.operationSummaryDigest,
      scopeSnapshotDigest: scopeSnapshotDigest(request.context),
    });
    await this.zeroCost(
      request,
      result.saveStatus === 'replayed' ? 'replayed' : 'confirmation_poll',
    );
    return result;
  }

  private replay(untrusted: unknown, traceId: string): McpToolResult {
    const parsed = mcpSubmitAnswerSuccessSchema.safeParse(untrusted);
    if (!parsed.success || parsed.data.saveStatus === 'not_saved') {
      throw new McpSubmitAnswerToolError('STATE_CONFLICT');
    }
    return validateMcpResult(mcpSubmitAnswerSuccessSchema, {
      ...parsed.data,
      saveStatus: 'replayed',
      traceId,
    });
  }

  private operationSummaryText(record: McpWriteConfirmationRecord): string {
    const value = record.operationSummary as {
      summary?: { notice?: unknown };
    };
    return typeof value?.summary?.notice === 'string'
      ? value.summary.notice.slice(0, 1_000)
      : 'Review and confirm the learning update in en-learning-plus.';
  }

  private async zeroCost(
    request: McpSubmitAnswerRequest,
    outcome: 'confirmation_poll' | 'replayed' | 'reconciled',
  ): Promise<void> {
    await this.costs.recordSubmit({
      traceId: request.traceId,
      outcome,
      cancellationOutcome: request.signal?.aborted ? 'cancelled' : 'completed',
      modelExecuted: false,
      inputTokens: 0,
      outputTokens: 0,
      gradingMs: 0,
      projectionMs: 0,
      totalMs: 0,
    });
  }
}

export class McpSubmitAnswerTool {
  readonly name = 'submit_answer' as const;
  readonly definition = Object.freeze({
    description:
      'Grade and save one owned exercise only after same-user URL confirmation; updates mastery and review scheduling atomically.',
    inputSchema: mcpSubmitAnswerInputSchema,
    outputSchema: mcpSubmitAnswerSuccessSchema,
    annotations: Object.freeze({
      readOnlyHint: false as const,
      destructiveHint: false as const,
      idempotentHint: true as const,
      openWorldHint: false as const,
    }),
    _meta: Object.freeze({
      'en-learning/schemaVersion': MCP_SCHEMA_VERSION,
      'en-learning/requiredScopes': Object.freeze(['answer:submit']),
      'en-learning/effect': 'write_learning_progress',
      'en-learning/confirmation': 'url_elicitation_required',
      'en-learning/idempotency': 'required',
      'en-learning/maxResultBytes': MCP_SUBMIT_ANSWER_MAX_RESULT_BYTES,
      'en-learning/deadlineMs': MCP_SUBMIT_ANSWER_DEADLINE_MS,
      'en-learning/rateLimitPolicy': 'mcp-submit-answer.v1',
      'en-learning/budgetPolicy': 'mcp-submit-answer.v1',
      'en-learning/retryPolicy': 'idempotent-client-replay-only.v1',
      'en-learning/degradation': 'stable-error-no-learning-write',
      'en-learning/operationId': 'mcp.tool.submit_answer.v1',
    }),
  });

  constructor(
    private readonly orchestrator: Pick<McpSubmitAnswerOrchestrator, 'submit'>,
  ) {}

  execute(
    untrustedInput: unknown,
    context: McpRequestContext,
    execution?: McpToolExecution & Readonly<{ sessionId?: string }>,
  ): Promise<unknown> {
    const deadline =
      execution?.deadline ??
      new Date(Date.now() + MCP_SUBMIT_ANSWER_DEADLINE_MS);
    assertOpen(execution?.signal, deadline);
    return this.orchestrator.submit({
      userId: context.userId,
      authorizationId: context.authorizationId,
      issuer: context.principal.issuer,
      clientId: context.principal.clientId,
      requestId: context.requestId,
      traceId: context.traceId,
      context,
      input: untrustedInput,
      deadline,
      ...(execution?.signal ? { signal: execution.signal } : {}),
      ...(execution?.sessionId ? { sessionId: execution.sessionId } : {}),
    });
  }
}
