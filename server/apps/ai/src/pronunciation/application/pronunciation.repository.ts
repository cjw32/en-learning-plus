import { recordStudyDay } from '@libs/shared/study/study-day';
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import {
  pronunciationPublicErrorCodeSchema,
  pronunciationLocaleSchema,
  pronunciationResultSchema,
  pronunciationLearningItemChangeSchema,
  type PronunciationAssessmentStatus,
  type PronunciationPublicErrorCode,
  type PronunciationResult,
} from '@en/common/pronunciation';
import type { ResolvedPronunciationTarget } from '@libs/learning';
import { Prisma } from '@libs/shared/generated/prisma/client';

export class PronunciationIdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;

  constructor() {
    super('Idempotency key is already bound to different content');
    this.name = 'PronunciationIdempotencyConflictError';
  }
}

export type CreatePronunciationAssessmentRecord = Readonly<{
  id: string;
  subjectId: string;
  clientIdempotencyKey: string;
  requestBodyHash: string;
  exerciseType: 'WORD' | 'PHRASE' | 'SENTENCE';
  deadlineAt: Date;
  target?: ResolvedPronunciationTarget;
  retryOfAssessmentId?: string | null;
}>;

export type PronunciationAssessmentRecord = Readonly<{
  id: string;
  subjectId: string;
  clientIdempotencyKey: string;
  requestBodyHash: string;
  status: PronunciationAssessmentStatus;
  exerciseType: 'WORD' | 'PHRASE' | 'SENTENCE';
  deadlineAt: Date;
  cancelRequestedAt: Date | null;
  publicErrorCode?: PronunciationPublicErrorCode | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt?: Date | null;
}>;

export type IdempotentAssessmentCreate = Readonly<{
  disposition: 'CREATED' | 'REPLAYED';
  assessment: PronunciationAssessmentRecord;
}>;

export type PronunciationAudioIntentBinding =
  | 'BOUND'
  | 'REPLAYED'
  | 'RESOURCE_NOT_FOUND'
  | 'STATE_CONFLICT';

type PronunciationOwnedRowBase = Prisma.PronunciationAssessmentGetPayload<{
  include: {
    target: true;
    audioAsset: true;
    words: true;
    trace: true;
    learningAttempt: { include: { reviewEvents: true } };
  };
}>;

type PronunciationOwnedRow = PronunciationOwnedRowBase & {
  target: NonNullable<PronunciationOwnedRowBase['target']>;
};

export type StoredPronunciationTarget = Readonly<{
  sourceType: ResolvedPronunciationTarget['sourceType'];
  languageTag: ResolvedPronunciationTarget['languageTag'];
  referenceText: string;
  normalizedTokens: readonly string[];
  targetHash: string;
  wordId: string | null;
  courseId: string | null;
  knowledgeCitationId: string | null;
  coachRequestId: string | null;
  exerciseId: string | null;
  itemId: string | null;
  sourceRecordType: string | null;
  sourceRecordId: string | null;
  sourceVersion: string | null;
  sourceContentHash: string | null;
  sourceRightsVersion: string | null;
  authorizedAt: Date;
  expiresAt: Date | null;
}>;

export type StoredPronunciationAudio = Readonly<{
  objectKey: string;
  declaredMediaType: string;
  detectedMediaType: string | null;
  byteSize: number;
  durationMs: number | null;
  sha256: string;
  status:
    | 'UPLOADING'
    | 'QUARANTINED'
    | 'VALIDATING'
    | 'READY'
    | 'INVALID'
    | 'REVOKED'
    | 'PURGING'
    | 'PURGED';
  expiresAt: Date;
}>;

export type OwnedPronunciationAssessment = Readonly<{
  assessment: PronunciationAssessmentRecord;
  target: StoredPronunciationTarget;
  audio: StoredPronunciationAudio | null;
  result?: PronunciationResult | null;
  learningWriteStatus?:
    | 'NOT_ELIGIBLE'
    | 'PENDING'
    | 'SAVED'
    | 'FAILED'
    | 'COMPENSATING'
    | 'COMPENSATED';
  retryOfAssessmentId?: string | null;
}>;

const allowedTransitions: Readonly<
  Record<
    PronunciationAssessmentStatus,
    readonly PronunciationAssessmentStatus[]
  >
> = Object.freeze({
  CREATED: ['AUDIO_VALIDATING', 'CANCELLED', 'TIMED_OUT', 'DELETING'],
  AUDIO_VALIDATING: [
    'AUDIO_READY',
    'REJECTED',
    'CANCELLED',
    'TIMED_OUT',
    'DELETING',
  ],
  AUDIO_READY: ['QUEUED', 'REJECTED', 'CANCELLED', 'TIMED_OUT', 'DELETING'],
  QUEUED: ['PROCESSING', 'CANCELLED', 'TIMED_OUT', 'FAILED', 'DELETING'],
  PROCESSING: [
    'COMPLETED',
    'REFERENCE_ONLY',
    'UNRECOGNIZABLE',
    'REJECTED',
    'CANCELLED',
    'TIMED_OUT',
    'FAILED',
    'DELETING',
  ],
  COMPLETED: ['DELETING'],
  REFERENCE_ONLY: ['DELETING'],
  UNRECOGNIZABLE: ['DELETING'],
  REJECTED: ['DELETING'],
  CANCELLED: ['DELETING'],
  TIMED_OUT: ['DELETING'],
  FAILED: ['DELETING'],
  DELETING: ['DELETED'],
  DELETED: [],
});

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function hashPronunciationContent(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function toRecord(row: {
  id: string;
  userId: string;
  clientIdempotencyKey: string;
  requestBodyHash: string;
  status: PronunciationAssessmentStatus;
  exerciseType: 'WORD' | 'PHRASE' | 'SENTENCE';
  deadlineAt: Date;
  cancelRequestedAt: Date | null;
  publicErrorCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt?: Date | null;
}): PronunciationAssessmentRecord {
  return Object.freeze({
    id: row.id,
    subjectId: row.userId,
    clientIdempotencyKey: row.clientIdempotencyKey,
    requestBodyHash: row.requestBodyHash,
    status: row.status,
    exerciseType: row.exerciseType,
    deadlineAt: row.deadlineAt,
    cancelRequestedAt: row.cancelRequestedAt,
    publicErrorCode:
      pronunciationPublicErrorCodeSchema.safeParse(row.publicErrorCode).data ??
      null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  });
}

@Injectable()
export class PronunciationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOwned(
    subjectId: string,
    assessmentId: string,
  ): Promise<PronunciationAssessmentRecord | null> {
    const row = await this.prisma.pronunciationAssessment.findFirst({
      where: { id: assessmentId, userId: subjectId, hiddenAt: null },
    });
    return row ? toRecord(row) : null;
  }

  async findByOwnerAndKey(
    subjectId: string,
    clientIdempotencyKey: string,
  ): Promise<PronunciationAssessmentRecord | null> {
    const row = await this.prisma.pronunciationAssessment.findUnique({
      where: {
        userId_clientIdempotencyKey: {
          userId: subjectId,
          clientIdempotencyKey,
        },
      },
    });
    return row ? toRecord(row) : null;
  }

  async createIdempotent(
    input: CreatePronunciationAssessmentRecord,
  ): Promise<IdempotentAssessmentCreate> {
    const existing = await this.findByOwnerAndKey(
      input.subjectId,
      input.clientIdempotencyKey,
    );
    if (existing) return this.replayOrConflict(existing, input.requestBodyHash);

    try {
      const created = await this.prisma.pronunciationAssessment.create({
        data: {
          id: input.id,
          userId: input.subjectId,
          clientIdempotencyKey: input.clientIdempotencyKey,
          requestBodyHash: input.requestBodyHash,
          status: 'CREATED',
          exerciseType: input.exerciseType,
          deadlineAt: input.deadlineAt,
          retryOfAssessmentId: input.retryOfAssessmentId ?? null,
          ...(input.target
            ? {
                target: {
                  create: {
                    userId: input.subjectId,
                    sourceType: input.target.sourceType,
                    exerciseType: input.target.exerciseType,
                    languageTag: input.target.languageTag,
                    referenceText: input.target.referenceText,
                    normalizedTokens: input.target
                      .normalizedTokens as Prisma.InputJsonValue,
                    targetHash: input.target.targetHash,
                    wordId: input.target.wordId,
                    courseId: input.target.courseId,
                    knowledgeCitationId: input.target.knowledgeCitationId,
                    coachRequestId: input.target.coachRequestId,
                    exerciseId: input.target.exerciseId,
                    itemId: input.target.itemId,
                    sourceRecordType: input.target.sourceRecordType,
                    sourceRecordId: input.target.sourceRecordId,
                    sourceVersion: input.target.sourceVersion,
                    sourceContentHash: input.target.sourceContentHash,
                    sourceRightsVersion: input.target.sourceRightsVersion,
                    authorizedAt: input.target.authorizedAt,
                    expiresAt: input.target.expiresAt,
                  },
                },
              }
            : {}),
        },
      });
      return Object.freeze({
        disposition: 'CREATED',
        assessment: toRecord(created),
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raced = await this.findByOwnerAndKey(
        input.subjectId,
        input.clientIdempotencyKey,
      );
      if (!raced) throw error;
      return this.replayOrConflict(raced, input.requestBodyHash);
    }
  }

  async findOwnedWithTarget(
    subjectId: string,
    assessmentId: string,
  ): Promise<OwnedPronunciationAssessment | null> {
    const row = await this.prisma.pronunciationAssessment.findFirst({
      where: { id: assessmentId, userId: subjectId, hiddenAt: null },
      include: {
        target: true,
        audioAsset: true,
        words: true,
        trace: true,
        learningAttempt: { include: { reviewEvents: true } },
      },
    });
    return row?.target ? this.toOwned({ ...row, target: row.target }) : null;
  }

  async listOwnedWithTargets(
    input: Readonly<{
      subjectId: string;
      cursor?: string;
      limit: number;
    }>,
  ): Promise<
    Readonly<{
      items: readonly OwnedPronunciationAssessment[];
      nextCursor: string | null;
    }>
  > {
    const rows = await this.prisma.pronunciationAssessment.findMany({
      where: { userId: input.subjectId, hiddenAt: null },
      include: {
        target: true,
        audioAsset: true,
        words: true,
        trace: true,
        learningAttempt: { include: { reviewEvents: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const visible = rows
      .filter((row): row is PronunciationOwnedRow => row.target !== null)
      .slice(0, input.limit);
    return Object.freeze({
      items: Object.freeze(visible.map((row) => this.toOwned(row))),
      nextCursor:
        rows.length > input.limit ? (visible.at(-1)?.id ?? null) : null,
    });
  }

  async bindAudioIntent(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      idempotencyKey: string;
      declaredMediaType: string;
      byteSize: number;
      sha256: string;
    }>,
  ): Promise<PronunciationAudioIntentBinding> {
    const load = () =>
      this.prisma.pronunciationAssessment.findFirst({
        where: {
          id: input.assessmentId,
          userId: input.subjectId,
          hiddenAt: null,
        },
        select: {
          status: true,
          contentFingerprint: true,
          target: { select: { targetHash: true } },
        },
      });
    const owned = await load();
    if (!owned?.target) return 'RESOURCE_NOT_FOUND';

    const fingerprint = hashPronunciationContent({
      version: 'pronunciation-audio-intent-v1',
      targetHash: owned.target.targetHash,
      audioSha256: input.sha256,
      byteSize: input.byteSize,
      declaredMediaType: input.declaredMediaType,
      idempotencyKeyHash: hashPronunciationContent(input.idempotencyKey),
    });
    if (owned.contentFingerprint) {
      if (owned.contentFingerprint !== fingerprint) {
        throw new PronunciationIdempotencyConflictError();
      }
      return 'REPLAYED';
    }
    if (owned.status !== 'CREATED') return 'STATE_CONFLICT';

    const bound = await this.prisma.pronunciationAssessment.updateMany({
      where: {
        id: input.assessmentId,
        userId: input.subjectId,
        hiddenAt: null,
        status: 'CREATED',
        contentFingerprint: null,
      },
      data: {
        contentFingerprint: fingerprint,
        status: 'AUDIO_VALIDATING',
      },
    });
    if (bound.count === 1) return 'BOUND';

    const raced = await load();
    if (!raced?.target) return 'RESOURCE_NOT_FOUND';
    if (!raced.contentFingerprint) return 'STATE_CONFLICT';
    if (raced.contentFingerprint !== fingerprint) {
      throw new PronunciationIdempotencyConflictError();
    }
    return 'REPLAYED';
  }

  async attachAudioMetadata(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      objectKey: string;
      declaredMediaType: string;
      byteSize: number;
      sha256: string;
      expiresAt: Date;
    }>,
  ): Promise<boolean> {
    const owned = await this.prisma.pronunciationAssessment.findFirst({
      where: {
        id: input.assessmentId,
        userId: input.subjectId,
        hiddenAt: null,
        status: { in: ['CREATED', 'AUDIO_VALIDATING'] },
      },
      select: { id: true },
    });
    if (!owned) return false;
    await this.prisma.pronunciationAudioAsset.upsert({
      where: { assessmentId: input.assessmentId },
      create: {
        assessmentId: input.assessmentId,
        userId: input.subjectId,
        objectKey: input.objectKey,
        declaredMediaType: input.declaredMediaType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        status: 'QUARANTINED',
        expiresAt: input.expiresAt,
      },
      update: {
        objectKey: input.objectKey,
        declaredMediaType: input.declaredMediaType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        status: 'QUARANTINED',
        expiresAt: input.expiresAt,
      },
    });
    return true;
  }

  async markAudioReady(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      rawObjectKey: string;
      canonicalObjectKey: string;
      byteSize: number;
      sha256: string;
      detectedMediaType: string;
      container: string;
      codec: string;
      durationMs: number;
      sampleRate: number;
      channelCount: number;
      qualityStatus: string;
      expiresAt: Date;
    }>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const audio = await transaction.pronunciationAudioAsset.updateMany({
        where: {
          assessmentId: input.assessmentId,
          userId: input.subjectId,
          objectKey: input.rawObjectKey,
          status: { in: ['QUARANTINED', 'VALIDATING'] },
        },
        data: {
          objectKey: input.canonicalObjectKey,
          detectedMediaType: input.detectedMediaType,
          container: input.container,
          codec: input.codec,
          byteSize: input.byteSize,
          durationMs: input.durationMs,
          sampleRate: input.sampleRate,
          channelCount: input.channelCount,
          sha256: input.sha256,
          qualityStatus: input.qualityStatus,
          status: 'READY',
          expiresAt: input.expiresAt,
        },
      });
      if (audio.count !== 1) return false;
      const assessment = await transaction.pronunciationAssessment.updateMany({
        where: {
          id: input.assessmentId,
          userId: input.subjectId,
          status: 'AUDIO_VALIDATING',
          hiddenAt: null,
        },
        data: { status: 'AUDIO_READY' },
      });
      if (assessment.count !== 1) {
        throw new Error('Pronunciation assessment audio transition conflict');
      }
      return true;
    });
  }

  async markAudioInvalid(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      qualityStatus: string;
      publicErrorCode: PronunciationPublicErrorCode;
    }>,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.pronunciationAudioAsset.updateMany({
        where: {
          assessmentId: input.assessmentId,
          userId: input.subjectId,
          status: { in: ['UPLOADING', 'QUARANTINED', 'VALIDATING'] },
        },
        data: { status: 'INVALID', qualityStatus: input.qualityStatus },
      }),
      this.prisma.pronunciationAssessment.updateMany({
        where: {
          id: input.assessmentId,
          userId: input.subjectId,
          status: 'AUDIO_VALIDATING',
        },
        data: {
          status: 'REJECTED',
          publicErrorCode: input.publicErrorCode,
          finishedAt: new Date(),
        },
      }),
    ]);
  }

  async persistResult(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      result: PronunciationResult;
      learningWriteStatus: 'NOT_ELIGIBLE' | 'PENDING';
    }>,
  ): Promise<boolean> {
    const result = pronunciationResultSchema.parse(input.result);
    if (result.assessmentId !== input.assessmentId) return false;
    return this.prisma.$transaction(async (transaction) => {
      const target = await transaction.pronunciationTarget.findFirst({
        where: {
          assessmentId: input.assessmentId,
          userId: input.subjectId,
        },
        select: { wordId: true },
      });
      if (!target) return false;
      const updated = await transaction.pronunciationAssessment.updateMany({
        where: {
          id: input.assessmentId,
          userId: input.subjectId,
          status: 'PROCESSING',
          cancelRequestedAt: null,
          hiddenAt: null,
          deadlineAt: { gt: new Date() },
        },
        data: {
          status:
            result.confidenceTier === 'RELIABLE'
              ? 'COMPLETED'
              : 'REFERENCE_ONLY',
          confidenceTier: result.confidenceTier,
          recognizedText: result.recognizedText,
          overallScore: result.scores.overall,
          accuracyScore: result.scores.accuracy,
          completenessScore: result.scores.completeness,
          fluencyScore: result.scores.fluency,
          prosodyScore: result.scores.prosody,
          confidence: result.confidence,
          summary: result.summary,
          suggestions: result.suggestions as Prisma.InputJsonValue,
          nextAction: result.nextAction.toUpperCase() as
            | 'RETRY'
            | 'REVIEW'
            | 'CONTINUE',
          resultSchemaVersion: result.schemaVersion,
          resultHash: hashPronunciationContent(result),
          provider: result.provider,
          modelVersion: result.modelVersion,
          providerAdapterVersion: result.versions.providerAdapter,
          providerApiVersion: result.versions.providerApi,
          assessmentRuleVersion: result.versions.assessmentRule,
          normalizationVersion: result.versions.normalization,
          alignmentVersion: result.versions.alignment,
          confidencePolicyVersion: result.versions.confidencePolicy,
          weaknessMappingVersion: result.versions.learningMapping,
          schedulerVersion: result.versions.scheduler,
          budgetVersion: result.versions.budget,
          priceVersion: result.versions.price,
          learningWriteStatus: input.learningWriteStatus,
          finishedAt: new Date(),
        },
      });
      if (updated.count !== 1) return false;
      await transaction.pronunciationWordAssessment.deleteMany({
        where: { assessmentId: input.assessmentId },
      });
      if (result.words.length > 0) {
        await transaction.pronunciationWordAssessment.createMany({
          data: result.words.map((word) => ({
            assessmentId: input.assessmentId,
            sequence: word.sequence,
            targetPosition: word.targetPosition,
            insertionAfterPosition:
              word.status === 'inserted' ? word.targetPosition : null,
            word: word.word,
            normalizedWord: word.normalizedWord,
            startMs: word.startMs,
            endMs: word.endMs,
            score: word.score,
            status: word.status.toUpperCase() as
              | 'CORRECT'
              | 'MISPRONOUNCED'
              | 'OMITTED'
              | 'INSERTED'
              | 'UNCERTAIN',
            feedback: word.feedback,
            wordId:
              target.wordId && word.targetPosition === 0 ? target.wordId : null,
            alignmentConfidence: result.confidence,
            alignmentReliable:
              result.confidenceTier === 'RELIABLE' &&
              word.targetPosition !== null &&
              word.status !== 'inserted' &&
              word.status !== 'uncertain',
            mappingVersion: result.versions.learningMapping,
          })),
        });
      }
      if (result.confidenceTier === 'RELIABLE') await recordStudyDay(transaction, input.subjectId);
      return true;
    });
  }

  async setLearningWriteStatus(
    subjectId: string,
    assessmentId: string,
    status: 'NOT_ELIGIBLE' | 'PENDING' | 'SAVED' | 'FAILED',
  ): Promise<void> {
    await this.prisma.pronunciationAssessment.updateMany({
      where: { id: assessmentId, userId: subjectId, hiddenAt: null },
      data: { learningWriteStatus: status },
    });
  }

  async findQueuedAssessmentIds(limit: number): Promise<readonly string[]> {
    const rows = await this.prisma.pronunciationAssessment.findMany({
      where: { status: 'QUEUED', hiddenAt: null },
      orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    return Object.freeze(rows.map((row) => row.id));
  }

  async claimQueuedForProcessing(
    assessmentId: string,
    startedAt = new Date(),
  ): Promise<boolean> {
    const updated = await this.prisma.pronunciationAssessment.updateMany({
      where: {
        id: assessmentId,
        status: 'QUEUED',
        cancelRequestedAt: null,
        hiddenAt: null,
        deadlineAt: { gt: startedAt },
      },
      data: { status: 'PROCESSING', startedAt },
    });
    return updated.count === 1;
  }

  async markProcessingFailed(
    assessmentId: string,
    finishedAt = new Date(),
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const assessment = await transaction.pronunciationAssessment.updateMany({
        where: {
          id: assessmentId,
          status: 'PROCESSING',
          hiddenAt: null,
        },
        data: {
          status: 'FAILED',
          publicErrorCode: 'INTERNAL_ERROR',
          finishedAt,
        },
      });
      if (assessment.count !== 1) return false;
      await transaction.pronunciationTrace.updateMany({
        where: { assessmentId, terminalStatus: null },
        data: {
          terminalStatus: 'FAILED',
          degraded: true,
          learningWriteStatus: 'NOT_ELIGIBLE',
          learningWriteCount: 0,
        },
      });
      return true;
    });
  }

  async transitionOwned(input: {
    subjectId: string;
    assessmentId: string;
    from: readonly PronunciationAssessmentStatus[];
    to: PronunciationAssessmentStatus;
    at?: Date;
    deadlineAt?: Date;
  }): Promise<boolean> {
    if (
      input.from.length === 0 ||
      input.from.some(
        (status) => !allowedTransitions[status].includes(input.to),
      )
    ) {
      return false;
    }
    const at = input.at ?? new Date();
    const timestamp =
      input.to === 'QUEUED'
        ? { queuedAt: at }
        : input.to === 'PROCESSING'
          ? { startedAt: at }
          : [
                'COMPLETED',
                'REFERENCE_ONLY',
                'UNRECOGNIZABLE',
                'REJECTED',
                'CANCELLED',
                'TIMED_OUT',
                'FAILED',
              ].includes(input.to)
            ? { finishedAt: at }
            : input.to === 'DELETING'
              ? { hiddenAt: at }
              : input.to === 'DELETED'
                ? { deletedAt: at }
                : {};
    const publicErrorCode = {
      CANCELLED: 'CANCELLED',
      TIMED_OUT: 'REQUEST_TIMEOUT',
      FAILED: 'INTERNAL_ERROR',
    }[input.to] as PronunciationPublicErrorCode | undefined;
    const updated = await this.prisma.pronunciationAssessment.updateMany({
      where: {
        id: input.assessmentId,
        userId: input.subjectId,
        status: { in: [...input.from] },
      },
      data: {
        status: input.to,
        ...timestamp,
        ...(input.to === 'QUEUED' && input.deadlineAt
          ? { deadlineAt: input.deadlineAt }
          : {}),
        ...(publicErrorCode ? { publicErrorCode } : {}),
      },
    });
    return updated.count === 1;
  }

  private replayOrConflict(
    existing: PronunciationAssessmentRecord,
    requestBodyHash: string,
  ): IdempotentAssessmentCreate {
    if (existing.requestBodyHash !== requestBodyHash) {
      throw new PronunciationIdempotencyConflictError();
    }
    return Object.freeze({
      disposition: 'REPLAYED',
      assessment: existing,
    });
  }

  private isUniqueConflict(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002',
    );
  }

  private toOwned(row: PronunciationOwnedRow): OwnedPronunciationAssessment {
    const learningStatus = row.learningWriteStatus as
      | 'NOT_ELIGIBLE'
      | 'PENDING'
      | 'SAVED'
      | 'FAILED'
      | 'COMPENSATING'
      | 'COMPENSATED';
    const learningUpdateStatus =
      learningStatus === 'PENDING'
        ? 'PROPOSED'
        : learningStatus === 'COMPENSATING'
          ? 'NOT_ELIGIBLE'
          : learningStatus;
    const resultCandidate = row.resultSchemaVersion
      ? pronunciationResultSchema.safeParse({
          schemaVersion: row.resultSchemaVersion,
          assessmentId: row.id,
          referenceText: row.target.referenceText,
          recognizedText: row.recognizedText ?? '',
          scores: {
            overall: Number(row.overallScore),
            accuracy: Number(row.accuracyScore),
            completeness: Number(row.completenessScore),
            fluency: Number(row.fluencyScore),
            prosody:
              row.prosodyScore === null ? null : Number(row.prosodyScore),
          },
          confidence: Number(row.confidence),
          confidenceTier: row.confidenceTier,
          words: [...(row.words ?? [])]
            .sort((left, right) => left.sequence - right.sequence)
            .map((word) => ({
              sequence: word.sequence,
              targetPosition: word.targetPosition,
              word: word.word,
              normalizedWord: word.normalizedWord,
              startMs: word.startMs,
              endMs: word.endMs,
              score: word.score === null ? null : Number(word.score),
              status: word.status.toLowerCase(),
              feedback: word.feedback,
            })),
          summary: row.summary,
          suggestions: Array.isArray(row.suggestions) ? row.suggestions : [],
          nextAction: row.nextAction?.toLowerCase(),
          provider: row.provider,
          modelVersion: row.modelVersion,
          learningUpdate: {
            status: learningUpdateStatus,
            changedItems:
              learningUpdateStatus === 'SAVED'
                ? (row.learningAttempt?.reviewEvents ?? []).flatMap((event) => {
                    if (event.voidedAt || event.userId !== row.userId)
                      return [];
                    const word = row.words.find(
                      (word) =>
                        word.wordId === event.targetKey &&
                        word.targetPosition !== null,
                    );
                    const previous = event.previousState as Record<
                      string,
                      unknown
                    > | null;
                    const next = event.nextState as Record<
                      string,
                      unknown
                    > | null;
                    const parsed =
                      pronunciationLearningItemChangeSchema.safeParse({
                        targetPosition: word?.targetPosition,
                        word: word?.word,
                        previousReviewState: previous?.reviewState,
                        nextReviewState: next?.reviewState,
                        nextReviewAt: next?.dueAt,
                      });
                    return parsed.success ? [parsed.data] : [];
                  })
                : [],
            ...(learningUpdateStatus === 'PROPOSED'
              ? {
                  message: '学习进度尚未写入，这是按当前规则计算的预览。',
                }
              : {}),
          },
          audio: {
            available:
              row.audioAsset?.status === 'READY' &&
              row.audioAsset.expiresAt > new Date(),
            expiresAt: row.audioAsset?.expiresAt?.toISOString() ?? null,
          },
          versions: {
            providerAdapter: row.providerAdapterVersion,
            providerApi: row.providerApiVersion,
            normalization: row.normalizationVersion,
            alignment: row.alignmentVersion,
            assessmentRule: row.assessmentRuleVersion,
            confidencePolicy: row.confidencePolicyVersion,
            learningMapping: row.weaknessMappingVersion,
            scheduler: row.schedulerVersion,
            budget: row.budgetVersion,
            price: row.priceVersion,
          },
          traceId: row.trace?.id ?? row.id,
        })
      : null;
    return Object.freeze({
      assessment: toRecord(row),
      target: Object.freeze({
        sourceType: row.target.sourceType,
        languageTag: pronunciationLocaleSchema.parse(row.target.languageTag),
        referenceText: row.target.referenceText,
        normalizedTokens: Object.freeze(
          Array.isArray(row.target.normalizedTokens)
            ? row.target.normalizedTokens.filter(
                (value: unknown): value is string => typeof value === 'string',
              )
            : [],
        ),
        targetHash: row.target.targetHash,
        wordId: row.target.wordId,
        courseId: row.target.courseId,
        knowledgeCitationId: row.target.knowledgeCitationId,
        coachRequestId: row.target.coachRequestId,
        exerciseId: row.target.exerciseId,
        itemId: row.target.itemId,
        sourceRecordType: row.target.sourceRecordType,
        sourceRecordId: row.target.sourceRecordId,
        sourceVersion: row.target.sourceVersion,
        sourceContentHash: row.target.sourceContentHash,
        sourceRightsVersion: row.target.sourceRightsVersion,
        authorizedAt: row.target.authorizedAt,
        expiresAt: row.target.expiresAt,
      }),
      audio: row.audioAsset
        ? Object.freeze({
            objectKey: row.audioAsset.objectKey,
            declaredMediaType: row.audioAsset.declaredMediaType,
            detectedMediaType: row.audioAsset.detectedMediaType,
            byteSize: row.audioAsset.byteSize,
            durationMs: row.audioAsset.durationMs,
            sha256: row.audioAsset.sha256,
            status: row.audioAsset.status,
            expiresAt: row.audioAsset.expiresAt,
          })
        : null,
      result: resultCandidate?.success ? resultCandidate.data : null,
      learningWriteStatus: learningStatus,
      retryOfAssessmentId: row.retryOfAssessmentId,
    });
  }
}
