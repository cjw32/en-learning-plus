import { Inject, Injectable } from '@nestjs/common';
import type {
  PronunciationAssessmentStatus,
  PronunciationConfidenceTier,
  PronunciationExerciseType,
} from '@en/common/pronunciation';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import { redactPronunciationPayload } from './pronunciation-redaction';

export const PRONUNCIATION_TRACE_REPOSITORY = Symbol(
  'PRONUNCIATION_TRACE_REPOSITORY',
);

export type PronunciationTraceStepName =
  | 'UPLOAD'
  | 'VALIDATE_AUDIO'
  | 'QUEUE'
  | 'PROVIDER'
  | 'VALIDATE_RESULT'
  | 'SAVE_LEARNING'
  | 'PURGE';
export type PronunciationTraceStepStatus =
  | 'STARTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export type PronunciationTraceStart = Readonly<{
  traceId: string;
  assessmentId: string;
  traceSubjectId: string;
  exerciseType: PronunciationExerciseType;
  targetWordCount: number;
  targetCharacterCount: number;
  estimatedCostMicros: number;
  currency: string;
  expiresAt: Date;
  versions: Readonly<{
    resultSchema?: string;
    providerAdapter?: string;
    providerApi?: string;
    normalization?: string;
    alignment?: string;
    assessmentRule?: string;
    confidencePolicy?: string;
    learningMapping?: string;
    scheduler?: string;
    budget?: string;
    price?: string;
  }>;
}>;

export type PronunciationProviderCallStart = Readonly<{
  assessmentId: string;
  attemptNo: number;
  provider: string;
  modelVersion: string;
  providerAdapterVersion: string;
  apiContractVersion: string;
  capabilityVersion: string;
  applicationConnectionId: string;
  inputHash: string;
  startedAt: Date;
  currency: string;
  priceVersion: string;
}>;

export interface PronunciationTraceRepository {
  createTrace(input: PronunciationTraceStart): Promise<void>;
  startStep(
    input: Readonly<{
      traceId: string;
      sequence: number;
      stepName: PronunciationTraceStepName;
      metadata?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<void>;
  finishStep(
    input: Readonly<{
      traceId: string;
      sequence: number;
      status: Exclude<PronunciationTraceStepStatus, 'STARTED'>;
      durationMs: number;
      errorCode?: string | null;
      metadata?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<boolean>;
  startProviderCall(input: PronunciationProviderCallStart): Promise<void>;
  finishProviderCall(
    input: Readonly<{
      assessmentId: string;
      attemptNo: number;
      status:
        | 'SUCCEEDED'
        | 'UNRECOGNIZABLE'
        | 'TIMED_OUT'
        | 'RATE_LIMITED'
        | 'CANCELLED'
        | 'FAILED'
        | 'INVALID_RESPONSE';
      providerAccepted: boolean | null;
      providerRequestId?: string | null;
      finishedAt: Date;
      latencyMs: number;
      billableDurationMs: number;
      actualCostMicros: number;
      failureCode?: string | null;
      retryDecision:
        | 'NOT_NEEDED'
        | 'SAFE_NOT_ACCEPTED'
        | 'PROVIDER_IDEMPOTENT'
        | 'UNKNOWN_ACCEPTANCE_NO_RETRY'
        | 'LIMIT_REACHED';
      responseHash?: string | null;
      lateResultDiscardedAt?: Date | null;
    }>,
  ): Promise<boolean>;
  finishTrace(
    input: Readonly<{
      traceId: string;
      terminalStatus: PronunciationAssessmentStatus;
      totalDurationMs: number;
      actualCostMicros: number;
      confidence?: number | null;
      confidenceTier?: PronunciationConfidenceTier | null;
      retryCount: number;
      cancelled: boolean;
      timedOut: boolean;
      degraded: boolean;
      learningWriteStatus:
        | 'NOT_ELIGIBLE'
        | 'PENDING'
        | 'SAVED'
        | 'FAILED'
        | 'COMPENSATING'
        | 'COMPENSATED';
      learningWriteCount: number;
    }>,
  ): Promise<void>;
}

function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

@Injectable()
export class PrismaPronunciationTraceRepository implements PronunciationTraceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createTrace(input: PronunciationTraceStart): Promise<void> {
    assertCount(input.targetWordCount, 'targetWordCount');
    assertCount(input.targetCharacterCount, 'targetCharacterCount');
    assertCount(input.estimatedCostMicros, 'estimatedCostMicros');
    await this.prisma.pronunciationTrace.create({
      data: {
        id: input.traceId,
        assessmentId: input.assessmentId,
        traceSubjectId: input.traceSubjectId,
        exerciseType: input.exerciseType,
        targetWordCount: input.targetWordCount,
        targetCharacterCount: input.targetCharacterCount,
        estimatedCost: String(input.estimatedCostMicros / 1_000_000),
        actualCost: '0',
        currency: input.currency,
        expiresAt: input.expiresAt,
        resultSchemaVersion: input.versions.resultSchema,
        providerAdapterVersion: input.versions.providerAdapter,
        providerApiVersion: input.versions.providerApi,
        normalizationVersion: input.versions.normalization,
        alignmentVersion: input.versions.alignment,
        assessmentRuleVersion: input.versions.assessmentRule,
        confidencePolicyVersion: input.versions.confidencePolicy,
        learningMappingVersion: input.versions.learningMapping,
        schedulerVersion: input.versions.scheduler,
        budgetVersion: input.versions.budget,
        priceVersion: input.versions.price,
      },
    });
  }

  async startStep(
    input: Readonly<{
      traceId: string;
      sequence: number;
      stepName: PronunciationTraceStepName;
      metadata?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<void> {
    assertCount(input.sequence, 'sequence');
    const metadata = redactPronunciationPayload(input.metadata ?? {});
    await this.prisma.pronunciationTraceStep.create({
      data: {
        traceId: input.traceId,
        sequence: input.sequence,
        stepName: input.stepName,
        status: 'STARTED',
        redactedMetadata:
          Object.keys(metadata).length > 0
            ? (metadata as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });
  }

  async finishStep(
    input: Readonly<{
      traceId: string;
      sequence: number;
      status: Exclude<PronunciationTraceStepStatus, 'STARTED'>;
      durationMs: number;
      errorCode?: string | null;
      metadata?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<boolean> {
    assertCount(input.durationMs, 'durationMs');
    const metadata = redactPronunciationPayload(input.metadata ?? {});
    const updated = await this.prisma.pronunciationTraceStep.updateMany({
      where: {
        traceId: input.traceId,
        sequence: input.sequence,
        status: 'STARTED',
      },
      data: {
        status: input.status,
        durationMs: input.durationMs,
        errorCode: input.errorCode,
        redactedMetadata:
          Object.keys(metadata).length > 0
            ? (metadata as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });
    return updated.count === 1;
  }

  async startProviderCall(
    input: PronunciationProviderCallStart,
  ): Promise<void> {
    assertCount(input.attemptNo, 'attemptNo');
    await this.prisma.pronunciationProviderCall.create({
      data: {
        assessmentId: input.assessmentId,
        attemptNo: input.attemptNo,
        provider: input.provider,
        modelVersion: input.modelVersion,
        providerAdapterVersion: input.providerAdapterVersion,
        apiContractVersion: input.apiContractVersion,
        capabilityVersion: input.capabilityVersion,
        applicationConnectionId: input.applicationConnectionId,
        inputHash: input.inputHash,
        status: 'STARTED',
        startedAt: input.startedAt,
        cost: '0',
        currency: input.currency,
        priceVersion: input.priceVersion,
      },
    });
  }

  async finishProviderCall(
    input: Readonly<{
      assessmentId: string;
      attemptNo: number;
      status:
        | 'SUCCEEDED'
        | 'UNRECOGNIZABLE'
        | 'TIMED_OUT'
        | 'RATE_LIMITED'
        | 'CANCELLED'
        | 'FAILED'
        | 'INVALID_RESPONSE';
      providerAccepted: boolean | null;
      providerRequestId?: string | null;
      finishedAt: Date;
      latencyMs: number;
      billableDurationMs: number;
      actualCostMicros: number;
      failureCode?: string | null;
      retryDecision:
        | 'NOT_NEEDED'
        | 'SAFE_NOT_ACCEPTED'
        | 'PROVIDER_IDEMPOTENT'
        | 'UNKNOWN_ACCEPTANCE_NO_RETRY'
        | 'LIMIT_REACHED';
      responseHash?: string | null;
      lateResultDiscardedAt?: Date | null;
    }>,
  ): Promise<boolean> {
    assertCount(input.latencyMs, 'latencyMs');
    assertCount(input.billableDurationMs, 'billableDurationMs');
    assertCount(input.actualCostMicros, 'actualCostMicros');
    const updated = await this.prisma.pronunciationProviderCall.updateMany({
      where: {
        assessmentId: input.assessmentId,
        attemptNo: input.attemptNo,
        status: 'STARTED',
      },
      data: {
        status: input.status,
        providerAccepted: input.providerAccepted,
        providerRequestId: input.providerRequestId,
        finishedAt: input.finishedAt,
        latencyMs: input.latencyMs,
        billableDurationMs: input.billableDurationMs,
        cost: String(input.actualCostMicros / 1_000_000),
        failureCode: input.failureCode,
        retryDecision: input.retryDecision,
        responseHash: input.responseHash,
        lateResultDiscardedAt: input.lateResultDiscardedAt,
      },
    });
    return updated.count === 1;
  }

  async finishTrace(
    input: Readonly<{
      traceId: string;
      terminalStatus: PronunciationAssessmentStatus;
      totalDurationMs: number;
      actualCostMicros: number;
      confidence?: number | null;
      confidenceTier?: PronunciationConfidenceTier | null;
      retryCount: number;
      cancelled: boolean;
      timedOut: boolean;
      degraded: boolean;
      learningWriteStatus:
        | 'NOT_ELIGIBLE'
        | 'PENDING'
        | 'SAVED'
        | 'FAILED'
        | 'COMPENSATING'
        | 'COMPENSATED';
      learningWriteCount: number;
    }>,
  ): Promise<void> {
    for (const [name, value] of [
      ['totalDurationMs', input.totalDurationMs],
      ['actualCostMicros', input.actualCostMicros],
      ['retryCount', input.retryCount],
      ['learningWriteCount', input.learningWriteCount],
    ] as const)
      assertCount(value, name);
    await this.prisma.pronunciationTrace.update({
      where: { id: input.traceId },
      data: {
        terminalStatus: input.terminalStatus,
        totalDurationMs: input.totalDurationMs,
        actualCost: String(input.actualCostMicros / 1_000_000),
        confidence: input.confidence,
        confidenceTier: input.confidenceTier,
        retryCount: input.retryCount,
        cancelled: input.cancelled,
        timedOut: input.timedOut,
        degraded: input.degraded,
        learningWriteStatus: input.learningWriteStatus,
        learningWriteCount: input.learningWriteCount,
      },
    });
  }
}

@Injectable()
export class PronunciationTraceService {
  constructor(
    @Inject(PRONUNCIATION_TRACE_REPOSITORY)
    private readonly repository: PronunciationTraceRepository,
  ) {}

  createTrace(input: PronunciationTraceStart): Promise<void> {
    return this.repository.createTrace(input);
  }
  startStep(input: Parameters<PronunciationTraceRepository['startStep']>[0]) {
    return this.repository.startStep(input);
  }
  finishStep(input: Parameters<PronunciationTraceRepository['finishStep']>[0]) {
    return this.repository.finishStep(input);
  }
  startProviderCall(input: PronunciationProviderCallStart) {
    return this.repository.startProviderCall(input);
  }
  finishProviderCall(
    input: Parameters<PronunciationTraceRepository['finishProviderCall']>[0],
  ) {
    return this.repository.finishProviderCall(input);
  }
  finishTrace(
    input: Parameters<PronunciationTraceRepository['finishTrace']>[0],
  ) {
    return this.repository.finishTrace(input);
  }
}
