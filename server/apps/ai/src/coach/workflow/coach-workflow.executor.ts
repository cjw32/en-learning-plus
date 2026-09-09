import { Injectable } from '@nestjs/common';
import {
  COACH_RESULT_SCHEMA_VERSION,
  anyPublicCoachResultSchema,
  type AnyPublicCoachResult,
  type CoachSseEvent,
} from '@en/common/coach';
import { CoachExecutionContext } from '@libs/shared';
import type {
  StoredCoachRequest,
  CoachRequestStatus,
} from '../api/coach-request.service';
import type { CoachEventStreamService } from '../streaming/coach-event-stream.service';
import {
  CoachTraceService,
  type CoachTraceSnapshot,
  type CoachTraceTerminalStatus,
} from '../observability/coach-trace.service';
import { createTraceSubjectId } from '../observability/coach-redaction';
import { mapCoachFailure } from '../governance/coach-failure.mapper';
import type { CoachAdmissionService } from '../governance/coach-admission.service';
import {
  COACH_WORKFLOW_PROMPT_HASH,
  COACH_WORKFLOW_PROMPT_VERSION,
} from '../prompts/coach-prompt.manifest';

export type CoachRuntimeIntent =
  | 'ANSWER'
  | 'CORRECTION'
  | 'CREATE_EXERCISE'
  | 'GRADE_ANSWER'
  | 'REVIEW_RECOMMENDATION'
  | 'UNKNOWN';

export interface CoachExecutorRepository {
  claimForExecution(requestId: string): Promise<StoredCoachRequest | null>;
  completeExecution(input: {
    request: StoredCoachRequest;
    intent: CoachRuntimeIntent;
    result: AnyPublicCoachResult;
    promptVersion: string;
    modelVersion: string;
    budgetVersion: string;
    finishedAt: Date;
  }): Promise<boolean>;
  failExecution(input: {
    requestId: string;
    status: Extract<
      CoachRequestStatus,
      'CANCELLED' | 'TIMED_OUT' | 'BUDGET_EXCEEDED' | 'FAILED'
    >;
    errorCode: CoachPublicErrorCode;
    finishedAt: Date;
  }): Promise<{
    updated: boolean;
    status: Extract<
      CoachRequestStatus,
      'CANCELLED' | 'TIMED_OUT' | 'BUDGET_EXCEEDED' | 'FAILED'
    >;
    errorCode: CoachPublicErrorCode;
    saveStatus: 'SAVED_ONCE' | 'NOT_SAVED';
  }>;
}

type CoachPublicErrorCode = Extract<
  CoachSseEvent,
  { type: 'error' }
>['payload']['code'];

export interface CoachRuntimeWorkflow {
  metadata?(): {
    promptVersion: string;
    promptHash: string;
    modelProvider: string;
    modelName: string;
    modelVersion: string;
    budgetVersion: string;
  };
  run(input: {
    request: StoredCoachRequest;
    context: CoachExecutionContext;
    signal: AbortSignal;
    trace: CoachTraceService;
  }): Promise<{ intent: CoachRuntimeIntent; result: AnyPublicCoachResult }>;
}

export interface CoachExecutorTraceWriter {
  ensureSubject(subjectId: string, traceSubjectId: string): Promise<void>;
  save(trace: CoachTraceSnapshot): Promise<void>;
}

export interface CoachExecutorTraceFactory {
  create(traceId: string, traceSubjectId: string): CoachTraceService;
  traceSubjectId(subjectId: string): string;
}

export class EnvironmentCoachTraceFactory implements CoachExecutorTraceFactory {
  constructor(
    private readonly pepper = process.env.COACH_TRACE_PEPPER ??
      process.env.JWT_SECRET ??
      '',
  ) {}

  create(traceId: string, traceSubjectId: string) {
    return new CoachTraceService(traceId, traceSubjectId);
  }

  traceSubjectId(subjectId: string) {
    return createTraceSubjectId(subjectId, this.pepper);
  }
}

type ExecutorStream = Pick<
  CoachEventStreamService,
  | 'publishStatus'
  | 'publishResult'
  | 'publishCompleted'
  | 'publishCancelled'
  | 'publishError'
>;

class CoachExecutorAbortError extends Error {
  readonly code: 'CANCELLED' | 'REQUEST_TIMEOUT';

  constructor(code: 'CANCELLED' | 'REQUEST_TIMEOUT') {
    super(code);
    this.code = code;
  }
}

@Injectable()
export class CoachWorkflowExecutor {
  constructor(
    private repository: CoachExecutorRepository,
    private readonly stream: ExecutorStream,
    private readonly runtime: CoachRuntimeWorkflow,
    private readonly traceWriter: CoachExecutorTraceWriter,
    private readonly traceFactory: CoachExecutorTraceFactory = new EnvironmentCoachTraceFactory(),
    private readonly now: () => Date = () => new Date(),
    private readonly admission?: Pick<CoachAdmissionService, 'releaseSubject'>,
  ) {}

  async executeRequest(
    requestId: string,
    externalSignal: AbortSignal = new AbortController().signal,
  ): Promise<void> {
    const request = await this.repository.claimForExecution(requestId);
    if (!request) return;

    const startedAt = request.startedAt ?? this.now();
    const traceId = `trace_${request.id}`;
    const traceSubjectId = this.traceFactory.traceSubjectId(request.subjectId);
    const trace = this.traceFactory.create(traceId, traceSubjectId);
    const metadata = this.runtime.metadata?.() ?? {
      promptVersion: COACH_WORKFLOW_PROMPT_VERSION,
      promptHash: COACH_WORKFLOW_PROMPT_HASH,
      modelProvider: 'disabled',
      modelName: 'disabled',
      modelVersion: 'disabled',
      budgetVersion: 'disabled',
    };
    trace.configureRun({
      requestId: request.id,
      promptVersion: metadata.promptVersion,
      promptHash: metadata.promptHash,
      modelProvider: metadata.modelProvider,
      modelName: metadata.modelName,
      modelVersion: metadata.modelVersion,
      resultSchemaVersion: COACH_RESULT_SCHEMA_VERSION,
      budgetVersion: metadata.budgetVersion,
      startedAtMs: startedAt.getTime(),
    });
    await this.traceWriter.ensureSubject(request.subjectId, traceSubjectId);

    const deadline = new AbortController();
    const remainingMs = Math.max(
      0,
      request.deadlineAt.getTime() - this.now().getTime(),
    );
    const timer = setTimeout(() => deadline.abort(), remainingMs);
    const signal = AbortSignal.any([externalSignal, deadline.signal]);

    try {
      if (signal.aborted) {
        throw new CoachExecutorAbortError(
          externalSignal.aborted ? 'CANCELLED' : 'REQUEST_TIMEOUT',
        );
      }
      if (request.cancelRequestedAt) {
        throw new CoachExecutorAbortError('CANCELLED');
      }
      await this.stream.publishStatus(request.id, 'validating');
      const output = await this.runtime.run({
        request,
        context: new CoachExecutionContext(
          request.subjectId,
          Math.floor(request.deadlineAt.getTime() / 1000),
        ),
        signal,
        trace,
      });
      if (signal.aborted) {
        throw new CoachExecutorAbortError(
          externalSignal.aborted ? 'CANCELLED' : 'REQUEST_TIMEOUT',
        );
      }
      const validationStartedAt = this.now().getTime();
      trace.startStep('validate_result', validationStartedAt);
      let result: AnyPublicCoachResult;
      try {
        result = anyPublicCoachResultSchema.parse(output.result);
        if (result.traceId !== traceId) {
          throw Object.assign(new Error('Result Trace mismatch'), {
            code: 'SCHEMA_INVALID',
          });
        }
        trace.setResultSchemaVersion(result.schemaVersion);
        trace.finishStep('validate_result', 'SUCCEEDED', this.now().getTime());
      } catch (error) {
        trace.recordSchemaFailure();
        trace.finishStep('validate_result', 'FAILED', this.now().getTime(), {
          errorCode: 'SCHEMA_INVALID',
        });
        throw error;
      }
      await this.stream.publishStatus(request.id, 'finalizing');
      trace.startStep('finalize', this.now().getTime());
      const finishedAt = this.now();
      try {
        const persisted = await this.repository.completeExecution({
          request,
          intent: output.intent,
          result,
          promptVersion: metadata.promptVersion,
          modelVersion: metadata.modelVersion,
          budgetVersion: metadata.budgetVersion,
          finishedAt,
        });
        if (!persisted) {
          throw Object.assign(
            new Error('Request left RUNNING before finalization'),
            { code: 'STATE_CONFLICT' },
          );
        }
        trace.finishStep('finalize', 'SUCCEEDED', this.now().getTime());
      } catch (error) {
        trace.finishStep('finalize', 'FAILED', this.now().getTime(), {
          errorCode:
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : 'INTERNAL_ERROR',
        });
        throw error;
      }
      trace.finishRun({
        terminalStatus: 'COMPLETED',
        resultType: result.responseType,
        finishedAtMs: finishedAt.getTime(),
      });
      await trace.persist(this.traceWriter);
      const resultEvent = await this.stream.publishResult(request.id, result);
      await this.stream.publishCompleted(
        request.id,
        resultEvent.eventId,
        result.learningUpdate?.status ?? 'not_applicable',
      );
    } catch (error) {
      const existingSnapshot = trace.snapshot() as Partial<CoachTraceSnapshot>;
      if (existingSnapshot.terminalStatus) throw error;
      let failure = mapCoachFailure(
        error,
        externalSignal.aborted || deadline.signal.aborted
          ? 'NOT_SAVED'
          : 'NOT_STARTED',
      );
      const terminal = this.terminalFor(failure.code);
      const finishedAt = this.now();
      const reconciled = await this.repository.failExecution({
        requestId: request.id,
        status: terminal.requestStatus,
        errorCode: this.publicErrorCode(failure.code),
        finishedAt,
      });
      failure = mapCoachFailure(error, reconciled.saveStatus);
      const reconciledTerminal = this.terminalFor(reconciled.errorCode);
      trace.finishRun({
        terminalStatus: reconciledTerminal.traceStatus,
        resultType: null,
        finishedAtMs: finishedAt.getTime(),
      });
      await trace.persist(this.traceWriter);
      if (reconciled.errorCode === 'CANCELLED') {
        await this.stream.publishCancelled(
          request.id,
          failure.saveStatus === 'SAVED_ONCE' ? 'SAVED_ONCE' : 'NOT_SAVED',
          failure.message,
        );
      } else {
        await this.stream.publishError(request.id, {
          code: reconciled.errorCode,
          message: failure.message,
          retryable: failure.retryable,
          retryAfterSeconds: null,
          saveStatus:
            failure.saveStatus === 'UNKNOWN_RECONCILED'
              ? 'NOT_SAVED'
              : failure.saveStatus,
        });
      }
    } finally {
      clearTimeout(timer);
      await this.admission
        ?.releaseSubject(request.subjectId)
        .catch(() => undefined);
    }
  }

  private terminalFor(code: string): {
    requestStatus: 'CANCELLED' | 'TIMED_OUT' | 'BUDGET_EXCEEDED' | 'FAILED';
    traceStatus: CoachTraceTerminalStatus;
  } {
    if (code === 'CANCELLED') {
      return { requestStatus: 'CANCELLED', traceStatus: 'CANCELLED' };
    }
    if (code === 'REQUEST_TIMEOUT' || code === 'TOOL_TIMEOUT') {
      return { requestStatus: 'TIMED_OUT', traceStatus: 'TIMED_OUT' };
    }
    if (code === 'BUDGET_EXCEEDED') {
      return {
        requestStatus: 'BUDGET_EXCEEDED',
        traceStatus: 'BUDGET_EXCEEDED',
      };
    }
    return { requestStatus: 'FAILED', traceStatus: 'FAILED' };
  }

  private publicErrorCode(code: string): CoachPublicErrorCode {
    const mapped =
      code === 'DATA_NOT_AVAILABLE' ? 'MATERIAL_NOT_AVAILABLE' : code;
    const allowed = new Set<CoachPublicErrorCode>([
      'AUTH_REQUIRED',
      'TOKEN_INVALID',
      'FORBIDDEN',
      'RESOURCE_NOT_FOUND',
      'VALIDATION_FAILED',
      'SCHEMA_INVALID',
      'MATERIAL_NOT_AVAILABLE',
      'MODEL_UNAVAILABLE',
      'TOOL_TIMEOUT',
      'REQUEST_TIMEOUT',
      'BUDGET_EXCEEDED',
      'RATE_LIMITED',
      'IDEMPOTENCY_CONFLICT',
      'STATE_CONFLICT',
      'CANCELLED',
      'INTERNAL_ERROR',
    ]);
    return allowed.has(mapped as CoachPublicErrorCode)
      ? (mapped as CoachPublicErrorCode)
      : 'INTERNAL_ERROR';
  }
}
