import {
  createPronunciationAssessmentSchema,
  pronunciationResultSchema,
  type CreatePronunciationAssessment,
  type PronunciationAssessmentResource,
  type PronunciationAssessmentStatus,
  type PronunciationLearningUpdate,
  type PronunciationResult,
} from '@en/common/pronunciation';
import {
  pronunciationEvidenceFromWords,
  PronunciationSourceRightsService,
  PronunciationTargetService,
  type PronunciationLearningEvidence,
  type ResolvedPronunciationTarget,
} from '@libs/learning';
import type { PronunciationRuntimeConfig } from '../governance/pronunciation-config.schema';
import {
  mapPronunciationFailure,
  PronunciationFailureError,
} from '../observability/pronunciation-failure.mapper';
import {
  hashPronunciationContent,
  PronunciationIdempotencyConflictError,
  PronunciationRepository,
  type OwnedPronunciationAssessment,
} from './pronunciation.repository';

export class PronunciationAssessmentRuleError extends Error {
  constructor(
    readonly code:
      | 'FEATURE_DISABLED'
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'STATE_CONFLICT'
      | 'SOURCE_UNAVAILABLE'
      | 'REQUEST_TIMEOUT'
      | 'CANCELLED'
      | 'STORAGE_NOT_APPROVED'
      | 'PROVIDER_NOT_APPROVED'
      | 'PRICE_UNKNOWN'
      | 'BUDGET_NOT_APPROVED',
  ) {
    super(code);
    this.name = 'PronunciationAssessmentRuleError';
  }
}

export type PronunciationExecutionBoundary =
  | 'UPLOAD'
  | 'QUEUE'
  | 'PRE_PROVIDER'
  | 'POST_PROVIDER'
  | 'PRE_LEARNING';

export interface PronunciationSubmitAdmission {
  assertCanSubmit(subjectId: string, assessmentId: string): Promise<void>;
}

const noOpAdmission: PronunciationSubmitAdmission = {
  async assertCanSubmit() {},
};

const submittedStatuses: readonly PronunciationAssessmentStatus[] = [
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'REFERENCE_ONLY',
  'UNRECOGNIZABLE',
  'REJECTED',
  'CANCELLED',
  'TIMED_OUT',
  'FAILED',
];

export interface PronunciationLearningWorkflow {
  project(
    input: Readonly<{
      subjectId: string;
      timezone: string;
      reviewedAt: Date;
      evidence: readonly PronunciationLearningEvidence[];
    }>,
  ): Promise<PronunciationLearningUpdate>;
  save(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      sourceValid: boolean;
      reviewedAt: Date;
    }>,
  ): Promise<
    Readonly<{
      status: 'saved' | 'replayed' | 'not_eligible';
      changedItems: PronunciationLearningUpdate['changedItems'];
    }>
  >;
}

function audioView(owned: OwnedPronunciationAssessment) {
  if (!owned.audio) {
    return { status: 'MISSING' as const, available: false, expiresAt: null };
  }
  const status =
    owned.audio.status === 'UPLOADING' ||
    owned.audio.status === 'QUARANTINED' ||
    owned.audio.status === 'VALIDATING'
      ? ('VALIDATING' as const)
      : owned.audio.status;
  return {
    status,
    available:
      owned.audio.status === 'READY' && owned.audio.expiresAt > new Date(),
    expiresAt: owned.audio.expiresAt.toISOString(),
  };
}

export class PronunciationAssessmentService {
  constructor(
    private readonly repository: PronunciationRepository,
    private readonly targets: PronunciationTargetService,
    private readonly sourceRights: PronunciationSourceRightsService,
    private readonly config: PronunciationRuntimeConfig,
    private readonly createId: () => string,
    private readonly admission: PronunciationSubmitAdmission = noOpAdmission,
    private readonly now: () => Date = () => new Date(),
    private readonly learning?: PronunciationLearningWorkflow,
  ) {}

  async create(
    input: Readonly<{
      subjectId: string;
      idempotencyKey: string;
      body: unknown;
    }>,
  ): Promise<PronunciationAssessmentResource> {
    this.requireEnabled(this.config.captureEnabled);
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) {
      throw new PronunciationAssessmentRuleError('VALIDATION_FAILED');
    }
    const parsed = createPronunciationAssessmentSchema.safeParse(input.body);
    if (!parsed.success) {
      throw new PronunciationAssessmentRuleError('VALIDATION_FAILED');
    }
    const requestBodyHash = hashPronunciationContent(parsed.data);
    const existing = await this.repository.findByOwnerAndKey(
      input.subjectId,
      input.idempotencyKey,
    );
    if (existing) {
      if (existing.requestBodyHash !== requestBodyHash) {
        throw new PronunciationIdempotencyConflictError();
      }
      return this.get(input.subjectId, existing.id);
    }

    const target = await this.resolveTarget(input.subjectId, parsed.data);
    const created = await this.repository.createIdempotent({
      id: this.createId(),
      subjectId: input.subjectId,
      clientIdempotencyKey: input.idempotencyKey,
      requestBodyHash,
      exerciseType: target.exerciseType,
      deadlineAt: new Date(this.now().getTime() + 15 * 60_000),
      target,
    });
    return this.get(input.subjectId, created.assessment.id);
  }

  async uploadMetadata(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      objectKey: string;
      declaredMediaType: string;
      byteSize: number;
      sha256: string;
      expiresAt: Date;
    }>,
  ): Promise<PronunciationAssessmentResource> {
    const owned = await this.assertExecutionBoundary({
      subjectId: input.subjectId,
      assessmentId: input.assessmentId,
      boundary: 'UPLOAD',
    });
    if (!['CREATED', 'AUDIO_VALIDATING'].includes(owned.assessment.status)) {
      throw new PronunciationAssessmentRuleError('STATE_CONFLICT');
    }
    if (owned.assessment.status === 'CREATED') {
      const transitioned = await this.repository.transitionOwned({
        subjectId: input.subjectId,
        assessmentId: input.assessmentId,
        from: ['CREATED'],
        to: 'AUDIO_VALIDATING',
      });
      if (!transitioned)
        throw new PronunciationAssessmentRuleError('STATE_CONFLICT');
    }
    const attached = await this.repository.attachAudioMetadata(input);
    if (!attached) throw new PronunciationAssessmentRuleError('STATE_CONFLICT');
    return this.get(input.subjectId, input.assessmentId);
  }

  async submit(
    subjectId: string,
    assessmentId: string,
  ): Promise<PronunciationAssessmentResource> {
    const existing = await this.repository.findOwnedWithTarget(
      subjectId,
      assessmentId,
    );
    if (!existing) this.notFound();
    if (submittedStatuses.includes(existing.assessment.status)) {
      return this.toResource(existing);
    }
    const owned = await this.assertExecutionBoundary({
      subjectId,
      assessmentId,
      boundary: 'QUEUE',
    });
    if (submittedStatuses.includes(owned.assessment.status)) {
      return this.toResource(owned);
    }
    if (
      owned.assessment.status !== 'AUDIO_READY' ||
      owned.audio?.status !== 'READY'
    ) {
      throw new PronunciationAssessmentRuleError('STATE_CONFLICT');
    }
    await this.admission.assertCanSubmit(subjectId, assessmentId);
    const transitioned = await this.repository.transitionOwned({
      subjectId,
      assessmentId,
      from: ['AUDIO_READY'],
      to: 'QUEUED',
      deadlineAt: new Date(this.now().getTime() + 60_000),
    });
    if (!transitioned) {
      const raced = await this.repository.findOwnedWithTarget(
        subjectId,
        assessmentId,
      );
      if (raced && submittedStatuses.includes(raced.assessment.status)) {
        return this.toResource(raced);
      }
      throw new PronunciationAssessmentRuleError('STATE_CONFLICT');
    }
    return this.get(subjectId, assessmentId);
  }

  async get(
    subjectId: string,
    assessmentId: string,
  ): Promise<PronunciationAssessmentResource> {
    const owned = await this.repository.findOwnedWithTarget(
      subjectId,
      assessmentId,
    );
    if (!owned) this.notFound();
    return this.toResource(owned);
  }

  async list(
    input: Readonly<{
      subjectId: string;
      cursor?: string;
      limit?: number;
    }>,
  ): Promise<
    Readonly<{
      items: readonly PronunciationAssessmentResource[];
      nextCursor: string | null;
    }>
  > {
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new PronunciationAssessmentRuleError('VALIDATION_FAILED');
    }
    const page = await this.repository.listOwnedWithTargets({
      subjectId: input.subjectId,
      cursor: input.cursor,
      limit,
    });
    return Object.freeze({
      items: Object.freeze(page.items.map((item) => this.toResource(item))),
      nextCursor: page.nextCursor,
    });
  }

  async finalizeResult(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      result: PronunciationResult;
      timezone: string;
    }>,
  ): Promise<PronunciationResult> {
    const result = pronunciationResultSchema.parse(input.result);
    if (result.assessmentId !== input.assessmentId) {
      throw new PronunciationAssessmentRuleError('VALIDATION_FAILED');
    }
    const owned = await this.assertExecutionBoundary({
      subjectId: input.subjectId,
      assessmentId: input.assessmentId,
      boundary: 'POST_PROVIDER',
    });
    const evidence = pronunciationEvidenceFromWords(
      result.words.map((word) => ({
        targetPosition: word.targetPosition,
        word: word.word,
        wordId:
          owned.target.wordId && word.targetPosition === 0
            ? owned.target.wordId
            : null,
        status: word.status,
        score: word.score,
        alignmentReliable:
          result.confidenceTier === 'RELIABLE' &&
          word.status !== 'uncertain' &&
          word.status !== 'inserted',
      })),
    );
    const canShadow =
      result.confidenceTier === 'RELIABLE' &&
      evidence.length > 0 &&
      this.config.learningShadowEnabled &&
      this.learning;
    if (canShadow) {
      await this.assertExecutionBoundary({
        subjectId: input.subjectId,
        assessmentId: input.assessmentId,
        boundary: 'PRE_LEARNING',
      });
    }
    const persisted = await this.repository.persistResult({
      subjectId: input.subjectId,
      assessmentId: input.assessmentId,
      result,
      learningWriteStatus: canShadow ? 'PENDING' : 'NOT_ELIGIBLE',
    });
    if (!persisted) {
      throw new PronunciationAssessmentRuleError('STATE_CONFLICT');
    }
    if (!canShadow || !this.learning) {
      return pronunciationResultSchema.parse({
        ...result,
        learningUpdate: { status: 'NOT_ELIGIBLE', changedItems: [] },
      });
    }
    const reviewedAt = this.now();
    let proposal: PronunciationLearningUpdate;
    try {
      proposal = await this.learning.project({
        subjectId: input.subjectId,
        timezone: input.timezone,
        reviewedAt,
        evidence,
      });
    } catch {
      await this.repository.setLearningWriteStatus(
        input.subjectId,
        input.assessmentId,
        'FAILED',
      );
      return pronunciationResultSchema.parse({
        ...result,
        learningUpdate: {
          status: 'FAILED',
          changedItems: [],
          message: '评测结果已保留，但学习进度暂未保存。',
        },
      });
    }
    if (!this.config.learningWriteEnabled) {
      return pronunciationResultSchema.parse({
        ...result,
        learningUpdate: proposal,
      });
    }
    try {
      await this.assertExecutionBoundary({
        subjectId: input.subjectId,
        assessmentId: input.assessmentId,
        boundary: 'PRE_LEARNING',
      });
      const saved = await this.learning.save({
        subjectId: input.subjectId,
        assessmentId: input.assessmentId,
        sourceValid: true,
        reviewedAt,
      });
      if (saved.status === 'not_eligible') {
        await this.repository.setLearningWriteStatus(
          input.subjectId,
          input.assessmentId,
          'NOT_ELIGIBLE',
        );
        return pronunciationResultSchema.parse({
          ...result,
          learningUpdate: { status: 'NOT_ELIGIBLE', changedItems: [] },
        });
      }
      return pronunciationResultSchema.parse({
        ...result,
        learningUpdate: {
          status: 'SAVED',
          changedItems: saved.changedItems,
        },
      });
    } catch (error) {
      const noLongerEligible =
        error instanceof PronunciationAssessmentRuleError &&
        [
          'CANCELLED',
          'REQUEST_TIMEOUT',
          'SOURCE_UNAVAILABLE',
          'FEATURE_DISABLED',
          'PROVIDER_NOT_APPROVED',
          'PRICE_UNKNOWN',
          'BUDGET_NOT_APPROVED',
        ].includes(error.code);
      await this.repository.setLearningWriteStatus(
        input.subjectId,
        input.assessmentId,
        noLongerEligible ? 'NOT_ELIGIBLE' : 'FAILED',
      );
      return pronunciationResultSchema.parse({
        ...result,
        learningUpdate: noLongerEligible
          ? { status: 'NOT_ELIGIBLE', changedItems: [] }
          : {
              status: 'FAILED',
              changedItems: [],
              message: '评测结果已保留，但学习进度暂未保存。',
            },
      });
    }
  }

  async recoverLearning(
    subjectId: string,
    assessmentId: string,
  ): Promise<void> {
    if (!this.config.learningWriteEnabled || !this.learning) return;
    const owned = await this.repository.findOwnedWithTarget(
      subjectId,
      assessmentId,
    );
    if (
      !owned ||
      owned.assessment.status !== 'COMPLETED' ||
      !['PENDING', 'FAILED'].includes(owned.learningWriteStatus ?? '')
    )
      return;
    try {
      await this.assertExecutionBoundary({
        subjectId,
        assessmentId,
        boundary: 'PRE_LEARNING',
      });
      const result = await this.learning.save({
        subjectId,
        assessmentId,
        sourceValid: true,
        reviewedAt: owned.assessment.finishedAt ?? owned.assessment.updatedAt,
      });
      await this.repository.setLearningWriteStatus(
        subjectId,
        assessmentId,
        result.status === 'not_eligible' ? 'NOT_ELIGIBLE' : 'SAVED',
      );
    } catch (error) {
      const code = mapPronunciationFailure(error).code;
      await this.repository.setLearningWriteStatus(
        subjectId,
        assessmentId,
        ['SOURCE_UNAVAILABLE', 'CANCELLED', 'RESOURCE_NOT_FOUND'].includes(code)
          ? 'NOT_ELIGIBLE'
          : 'FAILED',
      );
    }
  }

  /**
   * Re-reads authoritative state at every externally meaningful boundary.
   * Callers must never carry an earlier authorization or rollout decision
   * across upload, queue, Provider or learning side effects.
   */
  async assertExecutionBoundary(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      boundary: PronunciationExecutionBoundary;
      signal?: AbortSignal;
    }>,
  ): Promise<OwnedPronunciationAssessment> {
    const owned = await this.repository.findOwnedWithTarget(
      input.subjectId,
      input.assessmentId,
    );
    if (!owned) this.notFound();
    if (
      input.signal?.aborted ||
      owned.assessment.cancelRequestedAt ||
      owned.assessment.status === 'CANCELLED'
    ) {
      throw new PronunciationAssessmentRuleError('CANCELLED');
    }
    if (
      this.now().getTime() >= owned.assessment.deadlineAt.getTime() &&
      !['COMPLETED', 'REFERENCE_ONLY'].includes(owned.assessment.status)
    ) {
      await this.repository.transitionOwned({
        subjectId: input.subjectId,
        assessmentId: input.assessmentId,
        from: [owned.assessment.status],
        to: 'TIMED_OUT',
        at: this.now(),
      });
      throw new PronunciationAssessmentRuleError('REQUEST_TIMEOUT');
    }

    this.assertBoundaryGates(input.boundary);
    if (input.boundary !== 'UPLOAD') {
      await this.revalidateSource(input.subjectId, owned.target);
    }
    return owned;
  }

  private async resolveTarget(
    subjectId: string,
    input: CreatePronunciationAssessment,
  ): Promise<ResolvedPronunciationTarget> {
    return input.target.sourceType === 'COURSE_WORD' ||
      input.target.sourceType === 'RAG_CITATION'
      ? this.sourceRights.resolve({
          subjectId,
          locale: input.locale,
          target: input.target,
        })
      : this.targets.resolve({
          subjectId,
          locale: input.locale,
          target: input.target,
        });
  }

  private assertBoundaryGates(boundary: PronunciationExecutionBoundary): void {
    if (boundary === 'UPLOAD') {
      this.requireEnabled(
        this.config.captureEnabled && this.config.uploadEnabled,
      );
      if (!this.config.audioRuntimeApproved || !this.config.storageApproved) {
        throw new PronunciationAssessmentRuleError('STORAGE_NOT_APPROVED');
      }
      return;
    }
    this.requireEnabled(this.config.providerEnabled);
    if (!this.config.providerApproved) {
      throw new PronunciationAssessmentRuleError('PROVIDER_NOT_APPROVED');
    }
    if (!this.config.priceVersion) {
      throw new PronunciationAssessmentRuleError('PRICE_UNKNOWN');
    }
    if (
      !this.config.budgetPolicyVersion ||
      !this.config.maxCallCostMicros ||
      !this.config.subjectDailyBudgetMicros ||
      !this.config.systemDailyBudgetMicros ||
      !this.config.systemMonthlyBudgetMicros
    ) {
      throw new PronunciationAssessmentRuleError('BUDGET_NOT_APPROVED');
    }
    if (
      (boundary === 'POST_PROVIDER' || boundary === 'PRE_LEARNING') &&
      !this.config.resultDisplayEnabled
    ) {
      throw new PronunciationAssessmentRuleError('FEATURE_DISABLED');
    }
    if (boundary === 'PRE_LEARNING' && !this.config.learningShadowEnabled) {
      throw new PronunciationAssessmentRuleError('FEATURE_DISABLED');
    }
  }

  private async revalidateSource(
    subjectId: string,
    target: OwnedPronunciationAssessment['target'],
  ): Promise<void> {
    if (target.sourceType === 'MANUAL') return;
    if (
      target.sourceType === 'COURSE_WORD' ||
      target.sourceType === 'RAG_CITATION'
    ) {
      if (
        !target.sourceVersion ||
        !target.sourceContentHash ||
        !target.sourceRightsVersion
      ) {
        throw new PronunciationAssessmentRuleError('SOURCE_UNAVAILABLE');
      }
      await this.sourceRights.revalidate({
        subjectId,
        sourceType: target.sourceType,
        courseId: target.courseId,
        wordId: target.wordId,
        knowledgeCitationId: target.knowledgeCitationId,
        expected: {
          sourceVersion: target.sourceVersion,
          sourceContentHash: target.sourceContentHash,
          sourceRightsVersion: target.sourceRightsVersion,
        },
      });
      return;
    }
    const intent =
      target.sourceType === 'WORD_BOOK' && target.wordId
        ? { sourceType: 'WORD_BOOK' as const, wordId: target.wordId }
        : target.sourceType === 'COACH_EXERCISE' &&
            target.coachRequestId &&
            target.exerciseId &&
            target.itemId
          ? {
              sourceType: 'COACH_EXERCISE' as const,
              coachRequestId: target.coachRequestId,
              exerciseId: target.exerciseId,
              itemId: target.itemId,
            }
          : null;
    if (!intent)
      throw new PronunciationAssessmentRuleError('SOURCE_UNAVAILABLE');
    const current = await this.targets.resolve({
      subjectId,
      locale: target.languageTag,
      target: intent,
    });
    if (
      current.targetHash !== target.targetHash ||
      current.sourceVersion !== target.sourceVersion ||
      current.sourceContentHash !== target.sourceContentHash
    ) {
      throw new PronunciationAssessmentRuleError('SOURCE_UNAVAILABLE');
    }
  }

  private toResource(
    owned: OwnedPronunciationAssessment,
  ): PronunciationAssessmentResource {
    const failure = owned.assessment.publicErrorCode
      ? mapPronunciationFailure(
          new PronunciationFailureError(owned.assessment.publicErrorCode),
          {
            assessmentId: owned.assessment.id,
            traceId: owned.assessment.id,
          },
        )
      : null;
    return {
      assessmentId: owned.assessment.id,
      status: owned.assessment.status,
      exerciseType: owned.assessment.exerciseType,
      locale: owned.target.languageTag,
      referenceText: owned.target.referenceText,
      retryOfAssessmentId: owned.retryOfAssessmentId ?? null,
      result: owned.result ?? null,
      diagnostic: failure
        ? {
            code: failure.code,
            message: failure.message,
            retryable: failure.retryable,
          }
        : null,
      learningWriteStatus: owned.learningWriteStatus ?? 'NOT_ELIGIBLE',
      audio: audioView(owned),
      createdAt: owned.assessment.createdAt.toISOString(),
      updatedAt: owned.assessment.updatedAt.toISOString(),
      traceId: owned.assessment.id,
    };
  }

  private requireEnabled(enabled: boolean): void {
    if (!enabled)
      throw new PronunciationAssessmentRuleError('FEATURE_DISABLED');
  }

  private notFound(): never {
    throw new PronunciationAssessmentRuleError('RESOURCE_NOT_FOUND');
  }
}
