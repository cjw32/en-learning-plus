import { Injectable } from '@nestjs/common';
import type {
  PronunciationAssessmentStatus,
  PronunciationConfidenceTier,
  PronunciationLearningWriteStatus,
} from '@en/common/pronunciation';
import { PrismaService } from '@libs/shared';
import type {
  PronunciationTraceStepName,
  PronunciationTraceStepStatus,
} from './pronunciation-trace.service';

export type PronunciationTraceQueryRow = Readonly<{
  traceId: string;
  assessmentId: string;
  terminalStatus: PronunciationAssessmentStatus | null;
  uploadDurationMs: number | null;
  queueDurationMs: number | null;
  decodeDurationMs: number | null;
  providerDurationMs: number | null;
  totalDurationMs: number | null;
  estimatedCost: string;
  actualCost: string;
  currency: string;
  retryCount: number;
  cancelled: boolean;
  timedOut: boolean;
  degraded: boolean;
  confidence: string | null;
  confidenceTier: PronunciationConfidenceTier | null;
  learningWriteStatus: PronunciationLearningWriteStatus;
  learningWriteCount: number;
  versions: Readonly<{
    resultSchema: string | null;
    providerAdapter: string | null;
    providerApi: string | null;
    normalization: string | null;
    alignment: string | null;
    assessmentRule: string | null;
    confidencePolicy: string | null;
    learningMapping: string | null;
    scheduler: string | null;
    budget: string | null;
    price: string | null;
  }>;
  steps: readonly Readonly<{
    sequence: number;
    stepName: PronunciationTraceStepName;
    status: PronunciationTraceStepStatus;
    durationMs: number | null;
    errorCode: string | null;
  }>[];
}>;

export interface PronunciationTraceQueryRepository {
  findOwned(
    subjectId: string,
    assessmentId: string,
  ): Promise<PronunciationTraceQueryRow | null>;
}

@Injectable()
export class PrismaPronunciationTraceQueryRepository implements PronunciationTraceQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOwned(subjectId: string, assessmentId: string) {
    const row = await this.prisma.pronunciationTrace.findFirst({
      where: {
        assessmentId,
        assessment: { userId: subjectId, hiddenAt: null },
      },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
    if (!row) return null;
    return Object.freeze({
      traceId: row.id,
      assessmentId: row.assessmentId,
      terminalStatus: row.terminalStatus,
      uploadDurationMs: row.uploadDurationMs,
      queueDurationMs: row.queueDurationMs,
      decodeDurationMs: row.decodeDurationMs,
      providerDurationMs: row.providerDurationMs,
      totalDurationMs: row.totalDurationMs,
      estimatedCost: String(row.estimatedCost),
      actualCost: String(row.actualCost),
      currency: row.currency,
      retryCount: row.retryCount,
      cancelled: row.cancelled,
      timedOut: row.timedOut,
      degraded: row.degraded,
      confidence: row.confidence === null ? null : String(row.confidence),
      confidenceTier: row.confidenceTier,
      learningWriteStatus: row.learningWriteStatus,
      learningWriteCount: row.learningWriteCount,
      versions: Object.freeze({
        resultSchema: row.resultSchemaVersion,
        providerAdapter: row.providerAdapterVersion,
        providerApi: row.providerApiVersion,
        normalization: row.normalizationVersion,
        alignment: row.alignmentVersion,
        assessmentRule: row.assessmentRuleVersion,
        confidencePolicy: row.confidencePolicyVersion,
        learningMapping: row.learningMappingVersion,
        scheduler: row.schedulerVersion,
        budget: row.budgetVersion,
        price: row.priceVersion,
      }),
      steps: Object.freeze(
        row.steps.map((step) =>
          Object.freeze({
            sequence: step.sequence,
            stepName: step.stepName,
            status: step.status,
            durationMs: step.durationMs,
            errorCode: step.errorCode,
          }),
        ),
      ),
    });
  }
}

function micros(value: string): number {
  const parsed = Number(value);
  const result = Math.round(parsed * 1_000_000);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error('PRONUNCIATION_TRACE_COST_INVALID');
  }
  return result;
}

@Injectable()
export class PronunciationTraceQueryService {
  constructor(private readonly repository: PronunciationTraceQueryRepository) {}

  async get(subjectId: string, assessmentId: string) {
    const row = await this.repository.findOwned(subjectId, assessmentId);
    if (!row) return null;
    return Object.freeze({
      traceId: row.traceId,
      assessmentId: row.assessmentId,
      terminalStatus: row.terminalStatus,
      latencyMs: Object.freeze({
        upload: row.uploadDurationMs,
        queue: row.queueDurationMs,
        decode: row.decodeDurationMs,
        provider: row.providerDurationMs,
        total: row.totalDurationMs,
      }),
      cost: Object.freeze({
        estimatedMicros: micros(row.estimatedCost),
        actualMicros: micros(row.actualCost),
        currency: row.currency,
      }),
      retryCount: row.retryCount,
      flags: Object.freeze({
        cancelled: row.cancelled,
        timedOut: row.timedOut,
        degraded: row.degraded,
      }),
      confidence: row.confidence === null ? null : Number(row.confidence),
      confidenceTier: row.confidenceTier,
      learning: Object.freeze({
        status: row.learningWriteStatus,
        writeCount: row.learningWriteCount,
      }),
      versions: Object.freeze({ ...row.versions }),
      steps: Object.freeze(row.steps.map((step) => Object.freeze({ ...step }))),
    });
  }
}
