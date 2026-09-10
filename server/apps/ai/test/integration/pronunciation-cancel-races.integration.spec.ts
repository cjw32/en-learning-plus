import {
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  type PronunciationProviderAssessmentInput,
} from '@en/common/pronunciation';
import type {
  PronunciationSourceRightsService,
  PronunciationTargetService,
} from '@libs/learning';
import {
  PronunciationAssessmentService,
  type PronunciationExecutionBoundary,
} from '../../src/pronunciation/application/pronunciation-assessment.service';
import type {
  OwnedPronunciationAssessment,
  PronunciationRepository,
} from '../../src/pronunciation/application/pronunciation.repository';
import type { PronunciationRuntimeConfig } from '../../src/pronunciation/governance/pronunciation-config.schema';
import { PronunciationProviderExecutor } from '../../src/pronunciation/provider/pronunciation-provider.executor';

const now = new Date('2026-09-10T00:00:30.000Z');
const config: PronunciationRuntimeConfig = {
  captureEnabled: true,
  uploadEnabled: true,
  providerEnabled: true,
  resultDisplayEnabled: true,
  learningShadowEnabled: true,
  learningWriteEnabled: true,
  coachSummaryEnabled: false,
  audioRuntimeApproved: true,
  storageApproved: true,
  providerApproved: true,
  providerModelVersion: 'model-v1',
  providerRegion: 'eastasia',
  privacyEvidenceVersion: 'privacy-v1',
  priceVersion: 'price-v1',
  budgetPolicyVersion: 'budget-v1',
  evaluationApprovalVersion: 'eval-v1',
  maxCallCostMicros: 100,
  subjectDailyBudgetMicros: 1_000,
  systemDailyBudgetMicros: 10_000,
  systemMonthlyBudgetMicros: 100_000,
};

function owned(
  status: OwnedPronunciationAssessment['assessment']['status'] = 'PROCESSING',
  overrides: Partial<OwnedPronunciationAssessment['assessment']> = {},
): OwnedPronunciationAssessment {
  return {
    assessment: {
      id: 'assessment-1',
      subjectId: 'subject-1',
      clientIdempotencyKey: 'create-key-00000001',
      requestBodyHash: 'request-hash',
      status,
      exerciseType: 'WORD',
      deadlineAt: new Date('2026-09-10T00:00:31.000Z'),
      cancelRequestedAt: null,
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
      updatedAt: new Date('2026-09-10T00:00:00.000Z'),
      ...overrides,
    },
    target: {
      sourceType: 'MANUAL',
      languageTag: 'en-US',
      referenceText: 'hello',
      normalizedTokens: ['hello'],
      targetHash: 'target-hash',
      wordId: null,
      courseId: null,
      knowledgeCitationId: null,
      coachRequestId: null,
      exerciseId: null,
      itemId: null,
      sourceRecordType: null,
      sourceRecordId: null,
      sourceVersion: null,
      sourceContentHash: null,
      sourceRightsVersion: null,
      authorizedAt: new Date('2026-09-10T00:00:00.000Z'),
      expiresAt: null,
    },
    audio: {
      objectKey: 'private/audio.wav',
      declaredMediaType: 'audio/wav',
      detectedMediaType: 'audio/wav',
      byteSize: 3,
      durationMs: 1_000,
      sha256: 'a'.repeat(64),
      status: 'READY',
      expiresAt: new Date('2026-09-11T00:00:00.000Z'),
    },
  };
}

function serviceFor(row: OwnedPronunciationAssessment) {
  const repository = {
    findOwnedWithTarget: jest.fn(
      async (subjectId: string, assessmentId: string) =>
        subjectId === row.assessment.subjectId &&
        assessmentId === row.assessment.id
          ? row
          : null,
    ),
    transitionOwned: jest.fn(async () => true),
    attachAudioMetadata: jest.fn(async () => true),
    persistResult: jest.fn(async () => true),
    setLearningWriteStatus: jest.fn(),
  } as unknown as PronunciationRepository;
  const learning = { project: jest.fn(), save: jest.fn() };
  const service = new PronunciationAssessmentService(
    repository,
    {} as PronunciationTargetService,
    {} as PronunciationSourceRightsService,
    config,
    () => 'new-id',
    undefined,
    () => now,
    learning as never,
  );
  return { service, repository: repository as any, learning };
}

describe('pronunciation cancellation boundaries', () => {
  it.each([
    'UPLOAD',
    'QUEUE',
    'PRE_PROVIDER',
    'POST_PROVIDER',
    'PRE_LEARNING',
  ] as PronunciationExecutionBoundary[])(
    'rejects cancellation at the %s boundary with zero learning writes',
    async (boundary) => {
      const { service, repository, learning } = serviceFor(owned());
      const controller = new AbortController();
      controller.abort('CANCELLED');
      await expect(
        service.assertExecutionBoundary({
          subjectId: 'subject-1',
          assessmentId: 'assessment-1',
          boundary,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(repository.persistResult).not.toHaveBeenCalled();
      expect(learning.save).not.toHaveBeenCalled();
    },
  );

  it('discards a late Provider result while retaining its unavoidable cost ledger', async () => {
    const providerResult = {
      schemaVersion: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
      provider: 'fake',
      modelVersion: 'model-v1',
      adapterVersion: 'adapter-v1',
      apiContractVersion: 'api-v1',
      capabilityVersion: 'cap-v1',
      providerAccepted: true as const,
      providerRequestId: 'request-1',
      latencyMs: 10,
      billableDurationMs: 1_000,
      cost: 0.00001,
      currency: 'USD',
      priceVersion: 'price-v1',
      outcome: 'SUCCESS' as const,
      recognizedText: 'hello',
      recognitionConfidence: 0.99,
      scores: {
        overall: 99,
        accuracy: 99,
        completeness: 100,
        fluency: 98,
        prosody: null,
      },
      words: [],
    };
    const finish = jest.fn(async () => true);
    const executor = new PronunciationProviderExecutor(
      { assess: jest.fn(async () => providerResult) },
      { start: jest.fn(), finish },
      {
        provider: 'fake',
        modelVersion: 'model-v1',
        adapterVersion: 'adapter-v1',
        apiContractVersion: 'api-v1',
        capabilityVersion: 'cap-v1',
        currency: 'USD',
        priceVersion: 'price-v1',
        providerRequestsIdempotent: false,
      },
      { createConnectionId: () => 'connection-1', now: () => now },
    );
    const providerInput: PronunciationProviderAssessmentInput = {
      assessmentId: 'assessment-1',
      referenceText: 'hello',
      locale: 'en-US',
      canonicalAudio: Uint8Array.from([1, 2, 3]),
      applicationConnectionId: 'unused',
      deadlineAt: new Date('2026-09-10T00:00:31.000Z'),
    };
    await executor.execute(providerInput);

    const cancelled = owned('PROCESSING', { cancelRequestedAt: now });
    const { service, repository, learning } = serviceFor(cancelled);
    await expect(
      service.assertExecutionBoundary({
        subjectId: 'subject-1',
        assessmentId: 'assessment-1',
        boundary: 'POST_PROVIDER',
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ actualCostMicros: 10 }),
    );
    expect(repository.persistResult).not.toHaveBeenCalled();
    expect(learning.save).not.toHaveBeenCalled();
  });

  it('uses the same not-found result for a cross-owner boundary check', async () => {
    const { service } = serviceFor(owned());
    await expect(
      service.assertExecutionBoundary({
        subjectId: 'subject-2',
        assessmentId: 'assessment-1',
        boundary: 'PRE_PROVIDER',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      service.assertExecutionBoundary({
        subjectId: 'subject-2',
        assessmentId: 'random-id',
        boundary: 'PRE_PROVIDER',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
