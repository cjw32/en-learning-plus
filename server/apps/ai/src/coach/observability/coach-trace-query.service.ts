import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import type {
  CoachTraceSnapshot,
  CoachTraceTerminalStatus,
  CoachTraceWriter,
} from './coach-trace.service';
import { redactRagTraceMetadata } from './coach-redaction';
import type { RetrievalTraceMetadata } from './rag-trace.types';

export interface CoachTraceRepository extends CoachTraceWriter {
  findOwned(
    traceSubjectId: string,
    traceId: string,
  ): Promise<CoachTraceSnapshot | null>;
}

export class InMemoryCoachTraceRepository implements CoachTraceRepository {
  private readonly traces = new Map<string, CoachTraceSnapshot>();
  private readonly requests = new Set<string>();
  private readonly feedback = new Map<string, 'UP' | 'DOWN'>();

  save(trace: CoachTraceSnapshot): Promise<void> {
    if (this.traces.has(trace.traceId) || this.requests.has(trace.requestId)) {
      throw new Error('Each request must have exactly one Trace');
    }
    this.traces.set(trace.traceId, trace);
    this.requests.add(trace.requestId);
    return Promise.resolve();
  }

  findOwned(traceSubjectId: string, traceId: string) {
    const trace = this.traces.get(traceId);
    return Promise.resolve(
      trace?.traceSubjectId === traceSubjectId
        ? Object.freeze({
            ...trace,
            feedback: this.feedback.get(traceId) ?? null,
          })
        : null,
    );
  }

  linkFeedback(traceId: string, rating: 'UP' | 'DOWN'): void {
    if (!this.traces.has(traceId)) throw new Error('Trace does not exist');
    this.feedback.set(traceId, rating);
  }
}

const stepNames = {
  classify_intent: 'CLASSIFY_INTENT',
  get_learner_profile: 'GET_LEARNER_PROFILE',
  get_due_words: 'GET_DUE_WORDS',
  search_learning_materials: 'SEARCH_LEARNING_MATERIALS',
  create_exercise: 'CREATE_EXERCISE',
  grade_answer: 'GRADE_ANSWER',
  save_attempt: 'SAVE_ATTEMPT',
  generate: 'GENERATE_ANSWER',
  generate_answer: 'GENERATE_ANSWER',
  recommend: 'RECOMMEND',
  validate_result: 'VALIDATE_RESULT',
  finalize: 'FINALIZE',
} as const;

const resultTypes = {
  answer: 'ANSWER',
  correction: 'CORRECTION',
  exercise: 'EXERCISE',
  grading: 'GRADING',
  recommendation: 'RECOMMENDATION',
  degraded: 'DEGRADED',
} as const;

@Injectable()
export class PrismaCoachTraceRepository implements CoachTraceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSubject(subjectId: string, traceSubjectId: string) {
    await this.prisma.traceSubjectMapping.upsert({
      where: { userId: subjectId },
      create: { userId: subjectId, traceSubjectId },
      update: { traceSubjectId },
    });
  }

  async save(trace: CoachTraceSnapshot): Promise<void> {
    if (!trace.terminalStatus)
      throw new Error('Terminal Trace status is required');
    const resultType = trace.resultType
      ? resultTypes[trace.resultType as keyof typeof resultTypes]
      : null;
    if (trace.resultType && !resultType)
      throw new Error('Invalid Trace result type');
    await this.prisma.coachTrace.create({
      data: {
        id: trace.traceId,
        requestId: trace.requestId,
        traceSubjectId: trace.traceSubjectId,
        promptVersion: trace.promptVersion,
        promptHash: trace.promptHash,
        modelProvider: trace.modelProvider,
        modelName: trace.modelName,
        modelVersion: trace.modelVersion,
        resultSchemaVersion: trace.resultSchemaVersion,
        budgetVersion: trace.budgetVersion,
        ttftMs: trace.ttftMs,
        totalDurationMs: trace.totalDurationMs,
        inputTokens: trace.inputTokens,
        outputTokens: trace.outputTokens,
        estimatedCost: String(trace.estimatedCostMicros / 1_000_000),
        currency: 'USD',
        schemaFailureCount: trace.schemaFailureCount,
        retryCount: trace.retryCount,
        terminalStatus: trace.terminalStatus,
        resultType,
        recommendation: trace.recommendation
          ? (trace.recommendation as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        createdAt: new Date(trace.startedAtMs),
        expiresAt: new Date(trace.startedAtMs + 180 * 24 * 60 * 60 * 1_000),
        steps: {
          create: trace.steps.map((step) => {
            const stepName = stepNames[step.stepName as keyof typeof stepNames];
            if (!stepName) throw new Error('Invalid Trace step name');
            return {
              sequence: step.sequence,
              stepName,
              status: step.status,
              durationMs: step.durationMs,
              redactedMetadata: step.metadata as Prisma.InputJsonValue,
            };
          }),
        },
      },
    });
  }

  async findOwned(subjectId: string, traceId: string) {
    const trace = await this.prisma.coachTrace.findFirst({
      where: { id: traceId, traceSubject: { userId: subjectId } },
      include: {
        steps: { orderBy: { sequence: 'asc' } },
        request: {
          include: { feedback: { orderBy: { updatedAt: 'desc' }, take: 1 } },
        },
      },
    });
    if (!trace?.traceSubjectId) return null;
    const terminalStatuses = new Set<CoachTraceTerminalStatus>([
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'TIMED_OUT',
      'BUDGET_EXCEEDED',
    ]);
    if (
      !terminalStatuses.has(trace.terminalStatus as CoachTraceTerminalStatus)
    ) {
      return null;
    }
    const ragStep = trace.steps.find(
      (step) =>
        step.stepName === 'SEARCH_LEARNING_MATERIALS' &&
        step.redactedMetadata &&
        typeof step.redactedMetadata === 'object' &&
        !Array.isArray(step.redactedMetadata) &&
        'rag' in step.redactedMetadata,
    );
    const rag = ragStep
      ? redactRagTraceMetadata(
          (ragStep.redactedMetadata as Record<string, unknown>).rag,
        )
      : null;
    return {
      traceId: trace.id,
      traceSubjectId: trace.traceSubjectId,
      requestId: trace.requestId,
      promptVersion: trace.promptVersion,
      promptHash: trace.promptHash,
      modelProvider: trace.modelProvider,
      modelName: trace.modelName,
      modelVersion: trace.modelVersion,
      resultSchemaVersion: trace.resultSchemaVersion,
      budgetVersion: trace.budgetVersion,
      startedAtMs: (trace.request.startedAt ?? trace.createdAt).getTime(),
      ttftMs: trace.ttftMs,
      totalDurationMs: trace.totalDurationMs,
      inputTokens: trace.inputTokens,
      outputTokens: trace.outputTokens,
      estimatedCostMicros: Math.round(Number(trace.estimatedCost) * 1_000_000),
      schemaFailureCount: trace.schemaFailureCount,
      retryCount: trace.retryCount,
      terminalStatus: trace.terminalStatus as CoachTraceTerminalStatus,
      resultType: trace.resultType?.toLowerCase() ?? null,
      steps: trace.steps.map((step) => ({
        sequence: step.sequence,
        stepName: step.stepName.toLowerCase(),
        status: step.status,
        startedAtMs: trace.createdAt.getTime(),
        durationMs: step.durationMs,
        metadata:
          step.redactedMetadata && typeof step.redactedMetadata === 'object'
            ? (step.redactedMetadata as Record<string, unknown>)
            : {},
      })),
      recommendation:
        trace.recommendation &&
        typeof trace.recommendation === 'object' &&
        !Array.isArray(trace.recommendation)
          ? (trace.recommendation as unknown as CoachTraceSnapshot['recommendation'])
          : null,
      rag: rag as RetrievalTraceMetadata | null,
      feedback: trace.request.feedback[0]?.rating ?? null,
    };
  }
}

@Injectable()
export class CoachTraceQueryService {
  constructor(private readonly repository: CoachTraceRepository) {}

  async getOwned(traceSubjectId: string, traceId: string) {
    const trace = await this.repository.findOwned(traceSubjectId, traceId);
    if (!trace) throw new NotFoundException('Trace 不存在或不可访问');
    const { traceSubjectId: _hiddenSubject, ...safe } = trace;
    return Object.freeze(safe);
  }
}
