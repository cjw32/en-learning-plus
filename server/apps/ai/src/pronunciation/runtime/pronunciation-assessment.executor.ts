import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PrismaService } from '@libs/shared';
import { PRONUNCIATION_CONTRACT_VERSIONS as versions } from '@en/common/pronunciation';
import { PronunciationRepository } from '../application/pronunciation.repository';
import { PronunciationAssessmentService } from '../application/pronunciation-assessment.service';
import { PronunciationResultAssembler } from '../application/pronunciation-result.assembler';
import { PronunciationCancellationService } from '../governance/pronunciation-cancellation.service';
import { PronunciationSubmitAdmissionService } from '../governance/pronunciation-submit-admission';
import { PronunciationTraceService } from '../observability/pronunciation-trace.service';
import { mapPronunciationFailure } from '../observability/pronunciation-failure.mapper';
import { PronunciationProviderExecutor } from '../provider/pronunciation-provider.executor';
import { PronunciationRuntimeAdapters } from './pronunciation-runtime.adapters';

@Injectable()
export class PronunciationAssessmentWorkerExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PronunciationRepository,
    private readonly assessments: PronunciationAssessmentService,
    private readonly adapters: PronunciationRuntimeAdapters,
    private readonly cancellations: PronunciationCancellationService,
    private readonly admission: PronunciationSubmitAdmissionService,
    private readonly traces: PronunciationTraceService,
    private readonly environment: ConfigService,
  ) {}

  async executeAssessment(assessmentId: string): Promise<void> {
    const row = await this.prisma.pronunciationAssessment.findUnique({
      where: { id: assessmentId },
      select: { userId: true, queuedAt: true, startedAt: true },
    });
    if (!row) return;
    const subjectId = row.userId;
    const signal = this.cancellations.abortSignalFor(assessmentId);
    let observing = false;
    const timer = setInterval(() => {
      if (observing) return;
      observing = true;
      void this.cancellations.observe(assessmentId).finally(() => {
        observing = false;
      });
    }, 250);
    timer.unref();
    let traceCreated = false;
    let costMicros = 0;
    let attemptCount = 0;
    const started = Date.now();
    try {
      const owned = await this.assessments.assertExecutionBoundary({
        subjectId,
        assessmentId,
        boundary: 'PRE_PROVIDER',
        signal,
      });
      if (
        owned.assessment.status !== 'PROCESSING' ||
        owned.audio?.status !== 'READY' ||
        !owned.audio.durationMs ||
        owned.audio.expiresAt <= new Date()
      )
        throw Object.assign(new Error('Audio unavailable'), {
          code: 'AUDIO_INVALID',
        });
      const config = this.adapters.config;
      const pinned = {
        providerAdapter: versions.providerAdapter,
        providerApi: versions.providerApi,
        normalization: versions.normalization,
        alignment: versions.alignment,
        assessmentRule: versions.assessmentRule,
        confidencePolicy: versions.confidencePolicy,
        learningMapping: versions.learningMapping,
        scheduler: versions.scheduler,
        budget: config.budgetPolicyVersion!,
        price: config.priceVersion!,
      };
      const pepper = this.environment.get<string>('PRONUNCIATION_TRACE_PEPPER');
      if (!pepper) throw new Error('Trace configuration unavailable');
      await this.traces.createTrace({
        traceId: assessmentId,
        assessmentId,
        traceSubjectId: createHmac('sha256', pepper)
          .update(subjectId)
          .digest('hex'),
        exerciseType: owned.assessment.exerciseType,
        targetWordCount: owned.target.normalizedTokens.length,
        targetCharacterCount: owned.target.referenceText.length,
        estimatedCostMicros: config.maxCallCostMicros!,
        currency: this.adapters.currency,
        expiresAt: new Date(Date.now() + 30 * 86400000),
        versions: pinned,
      });
      traceCreated = true;
      await this.prisma.pronunciationTrace.update({
        where: { id: assessmentId },
        data: {
          audioMediaType: owned.audio.detectedMediaType,
          audioByteSize: owned.audio.byteSize,
          audioDurationMs: owned.audio.durationMs,
          provider: 'azure',
          modelVersion: config.providerModelVersion,
          queueDurationMs:
            row.queuedAt && row.startedAt
              ? Math.max(0, row.startedAt.getTime() - row.queuedAt.getTime())
              : null,
        },
      });
      const audio = await this.adapters.storage.read(owned.audio.objectKey);
      await this.cancellations.assertCanFinalize(
        subjectId,
        assessmentId,
        signal,
      );
      await this.assessments.assertExecutionBoundary({
        subjectId,
        assessmentId,
        boundary: 'PRE_PROVIDER',
        signal,
      });
      const provider = new PronunciationProviderExecutor(
        this.adapters.provider,
        {
          start: (input) => {
            attemptCount = input.attemptNo;
            return this.traces.startProviderCall(input);
          },
          finish: async (input) => {
            costMicros += input.actualCostMicros;
            return this.traces.finishProviderCall(input);
          },
        },
        {
          provider: 'azure',
          modelVersion: config.providerModelVersion!,
          adapterVersion: versions.providerAdapter,
          apiContractVersion: versions.providerApi,
          capabilityVersion: versions.providerCapability,
          currency: this.adapters.currency,
          priceVersion: config.priceVersion!,
          providerRequestsIdempotent: false,
        },
      );
      const result = await provider.execute(
        {
          assessmentId,
          referenceText: owned.target.referenceText,
          locale: owned.target.languageTag,
          canonicalAudio: audio,
          applicationConnectionId: assessmentId,
          deadlineAt: owned.assessment.deadlineAt,
        },
        signal,
      );
      await this.cancellations.assertCanFinalize(
        subjectId,
        assessmentId,
        signal,
      );
      await this.assessments.assertExecutionBoundary({
        subjectId,
        assessmentId,
        boundary: 'POST_PROVIDER',
        signal,
      });
      const assembled = new PronunciationResultAssembler().assemble({
        assessmentId,
        referenceText: owned.target.referenceText,
        targetTokens: owned.target.normalizedTokens,
        audioDurationMs: owned.audio.durationMs,
        providerResult: result,
        traceId: assessmentId,
        versions: pinned,
        audio: { available: true, expiresAt: owned.audio.expiresAt },
        sourceValid: true,
        audioValid: true,
        cancelled: false,
        timedOut: false,
        learningWriteEnabled: config.learningWriteEnabled,
      });
      const profile = await this.prisma.learnerProfile.findUnique({
        where: { userId: subjectId },
        select: { timezone: true },
      });
      await this.assessments.finalizeResult({
        subjectId,
        assessmentId,
        result: assembled,
        timezone: profile?.timezone ?? 'Asia/Shanghai',
      });
    } catch (error) {
      const failure = mapPronunciationFailure(error, {
        assessmentId,
        traceId: assessmentId,
      });
      const code = failure.code;
      const status =
        code === 'CANCELLED'
          ? 'CANCELLED'
          : code === 'REQUEST_TIMEOUT' || code === 'PROVIDER_TIMEOUT'
            ? 'TIMED_OUT'
            : code === 'SPEECH_UNRECOGNIZABLE'
              ? 'UNRECOGNIZABLE'
              : code.startsWith('AUDIO_') || code === 'SOURCE_UNAVAILABLE'
                ? 'REJECTED'
                : 'FAILED';
      await this.prisma.pronunciationAssessment.updateMany({
        where: {
          id: assessmentId,
          userId: subjectId,
          status: 'PROCESSING',
          hiddenAt: null,
          cancelRequestedAt: null,
        },
        data: {
          status,
          publicErrorCode: code,
          finishedAt: new Date(),
          learningWriteStatus: 'NOT_ELIGIBLE',
        },
      });
      // A cancellation may have won while a non-cancellable upstream call finished.
      if (signal.aborted)
        await this.prisma.pronunciationProviderCall.updateMany({
          where: { assessmentId, finishedAt: { not: null } },
          data: { lateResultDiscardedAt: new Date() },
        });
    } finally {
      clearInterval(timer);
      this.cancellations.clear(assessmentId);
      await this.admission
        .release(subjectId, assessmentId)
        .catch(() => undefined);
      if (traceCreated) {
        const final = await this.repository.findOwnedWithTarget(
          subjectId,
          assessmentId,
        );
        if (final)
          await this.traces.finishTrace({
            traceId: assessmentId,
            terminalStatus: final.assessment.status,
            totalDurationMs: Date.now() - started,
            actualCostMicros: costMicros,
            retryCount: Math.max(0, attemptCount - 1),
            confidence: final.result?.confidence,
            confidenceTier: final.result?.confidenceTier,
            cancelled: final.assessment.status === 'CANCELLED',
            timedOut: final.assessment.status === 'TIMED_OUT',
            degraded: final.assessment.status !== 'COMPLETED',
            learningWriteStatus: final.learningWriteStatus ?? 'NOT_ELIGIBLE',
            learningWriteCount: final.learningWriteStatus === 'SAVED' ? 1 : 0,
          });
      }
    }
  }
}
