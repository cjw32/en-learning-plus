import type { PronunciationResult } from '@en/common/pronunciation';
import type {
  PronunciationSourceRightsService,
  PronunciationTargetService,
} from '@libs/learning';
import { PronunciationAssessmentService } from '../../src/pronunciation/application/pronunciation-assessment.service';
import type {
  OwnedPronunciationAssessment,
  PronunciationRepository,
} from '../../src/pronunciation/application/pronunciation.repository';
import type { PronunciationRuntimeConfig } from '../../src/pronunciation/governance/pronunciation-config.schema';

const result: PronunciationResult = {
  schemaVersion: 'pronunciation-result.v1',
  assessmentId: 'assessment_1',
  referenceText: 'hello',
  recognizedText: 'hello',
  scores: {
    overall: 90,
    accuracy: 90,
    completeness: 100,
    fluency: 88,
    prosody: null,
  },
  confidence: 0.8,
  confidenceTier: 'RELIABLE',
  words: [
    {
      sequence: 0,
      targetPosition: 0,
      word: 'hello',
      normalizedWord: 'hello',
      startMs: 0,
      endMs: 500,
      score: 90,
      status: 'correct',
      feedback: null,
    },
  ],
  summary: '发音清晰。',
  suggestions: ['继续练习。'],
  nextAction: 'continue',
  provider: 'fake',
  modelVersion: 'fake-v1',
  learningUpdate: { status: 'NOT_ELIGIBLE', changedItems: [] },
  audio: { available: true, expiresAt: '2026-09-11T00:00:00.000Z' },
  versions: {
    providerAdapter: 'fake-adapter.v1',
    providerApi: 'fake-api.v1',
    normalization: 'pronunciation-normalization.v1',
    alignment: 'pronunciation-alignment.v1',
    assessmentRule: 'pronunciation-assessment.v1',
    confidencePolicy: 'pronunciation-confidence.v1',
    learningMapping: 'pronunciation-quality.v1',
    scheduler: 'SM2_V1',
    budget: 'budget-v1',
    price: 'price-v1',
  },
  traceId: 'trace_1',
};

const owned: OwnedPronunciationAssessment = {
  assessment: {
    id: 'assessment_1',
    subjectId: 'user-a',
    clientIdempotencyKey: 'create-key-000001',
    requestBodyHash: 'request-hash',
    status: 'PROCESSING',
    exerciseType: 'WORD',
    deadlineAt: new Date('2026-09-10T00:01:00.000Z'),
    cancelRequestedAt: null,
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
    updatedAt: new Date('2026-09-10T00:00:00.000Z'),
  },
  target: {
    sourceType: 'WORD_BOOK',
    languageTag: 'en-US',
    referenceText: 'hello',
    normalizedTokens: ['hello'],
    targetHash: 'target-hash',
    wordId: 'word-1',
    courseId: null,
    knowledgeCitationId: null,
    coachRequestId: null,
    exerciseId: null,
    itemId: null,
    sourceRecordType: 'WORD_BOOK',
    sourceRecordId: 'word-1',
    sourceVersion: 'source-v1',
    sourceContentHash: 'content-hash',
    sourceRightsVersion: null,
    authorizedAt: new Date('2026-09-10T00:00:00.000Z'),
    expiresAt: null,
  },
  audio: {
    objectKey: 'private',
    declaredMediaType: 'audio/webm',
    detectedMediaType: 'audio/wav',
    byteSize: 10,
    durationMs: 1_000,
    sha256: 'a'.repeat(64),
    status: 'READY',
    expiresAt: new Date('2026-09-11T00:00:00.000Z'),
  },
};

function fixture(shadow: boolean, write: boolean) {
  const repository = {
    findOwnedWithTarget: jest.fn().mockResolvedValue(owned),
    persistResult: jest.fn().mockResolvedValue(true),
    setLearningWriteStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<PronunciationRepository>;
  const targets = {
    resolve: jest.fn().mockResolvedValue({
      ...owned.target,
      exerciseType: 'WORD',
      wordCount: 1,
      characterCount: 5,
      normalizationVersion: 'pronunciation-normalization.v1',
    }),
  } as unknown as PronunciationTargetService;
  const sourceRights = {
    revalidate: jest.fn(),
  } as unknown as PronunciationSourceRightsService;
  const workflow = {
    project: jest.fn().mockResolvedValue({
      status: 'PROPOSED',
      changedItems: [
        {
          targetPosition: 0,
          word: 'hello',
          previousReviewState: 'NEW',
          nextReviewState: 'REVIEW',
          nextReviewAt: '2026-09-11T00:00:00.000Z',
        },
      ],
      message: '学习进度尚未写入，这是按当前规则计算的预览。',
    }),
    save: jest.fn().mockResolvedValue({
      status: 'saved',
      attemptId: 'attempt_1',
      changedItems: [
        {
          targetPosition: 0,
          word: 'hello',
          previousReviewState: 'NEW',
          nextReviewState: 'REVIEW',
          nextReviewAt: '2026-09-11T00:00:00.000Z',
        },
      ],
      reasons: [],
    }),
  };
  const config = {
    captureEnabled: true,
    uploadEnabled: true,
    providerEnabled: true,
    resultDisplayEnabled: true,
    learningShadowEnabled: shadow,
    learningWriteEnabled: write,
    coachSummaryEnabled: false,
    audioRuntimeApproved: true,
    storageApproved: true,
    providerApproved: true,
    providerModelVersion: 'model-v1',
    providerRegion: 'eastasia',
    privacyEvidenceVersion: 'privacy-v1',
    priceVersion: 'price-v1',
    budgetPolicyVersion: 'budget-v1',
    evaluationApprovalVersion: shadow ? 'eval-v1' : null,
    maxCallCostMicros: 100,
    subjectDailyBudgetMicros: 1_000,
    systemDailyBudgetMicros: 10_000,
    systemMonthlyBudgetMicros: 100_000,
  } as PronunciationRuntimeConfig;
  const service = new PronunciationAssessmentService(
    repository,
    targets,
    sourceRights,
    config,
    () => 'unused',
    undefined,
    () => new Date('2026-09-10T00:00:00.000Z'),
    workflow,
  );
  return { service, repository, workflow };
}

describe('pronunciation result-to-learning finalization', () => {
  it('persists a reliable result while learning gates remain off', async () => {
    const { service, repository, workflow } = fixture(false, false);
    await expect(
      service.finalizeResult({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        result,
        timezone: 'Asia/Shanghai',
      }),
    ).resolves.toMatchObject({
      learningUpdate: { status: 'NOT_ELIGIBLE', changedItems: [] },
    });
    expect(repository.persistResult).toHaveBeenCalledTimes(1);
    expect(workflow.project).not.toHaveBeenCalled();
    expect(workflow.save).not.toHaveBeenCalled();
  });

  it('returns a proposal in shadow mode without a learning write', async () => {
    const { service, workflow } = fixture(true, false);
    await expect(
      service.finalizeResult({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        result,
        timezone: 'Asia/Shanghai',
      }),
    ).resolves.toMatchObject({ learningUpdate: { status: 'PROPOSED' } });
    expect(workflow.project).toHaveBeenCalledTimes(1);
    expect(workflow.save).not.toHaveBeenCalled();
  });

  it('writes once behind the write gate and reports failure independently', async () => {
    const saved = fixture(true, true);
    await expect(
      saved.service.finalizeResult({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        result,
        timezone: 'Asia/Shanghai',
      }),
    ).resolves.toMatchObject({ learningUpdate: { status: 'SAVED' } });

    const failed = fixture(true, true);
    failed.workflow.save.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      failed.service.finalizeResult({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        result,
        timezone: 'Asia/Shanghai',
      }),
    ).resolves.toMatchObject({
      scores: { overall: 90 },
      learningUpdate: { status: 'FAILED', changedItems: [] },
    });
    expect(failed.repository.setLearningWriteStatus).toHaveBeenCalledWith(
      'user-a',
      'assessment_1',
      'FAILED',
    );
  });

  it('keeps the result and exposes a failed learning state when shadow projection fails', async () => {
    const failed = fixture(true, false);
    failed.workflow.project.mockRejectedValueOnce(
      new Error('projection failed'),
    );

    await expect(
      failed.service.finalizeResult({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        result,
        timezone: 'Asia/Shanghai',
      }),
    ).resolves.toMatchObject({
      scores: { overall: 90 },
      learningUpdate: { status: 'FAILED', changedItems: [] },
    });
    expect(failed.repository.setLearningWriteStatus).toHaveBeenCalledWith(
      'user-a',
      'assessment_1',
      'FAILED',
    );
  });

  it('revalidates immediately before a learning write and fails closed on cancellation', async () => {
    const cancelled = fixture(true, true);
    cancelled.repository.findOwnedWithTarget
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce({
        ...owned,
        assessment: {
          ...owned.assessment,
          status: 'COMPLETED',
          cancelRequestedAt: new Date('2026-09-10T00:00:00.000Z'),
        },
      });

    await expect(
      cancelled.service.finalizeResult({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        result,
        timezone: 'Asia/Shanghai',
      }),
    ).resolves.toMatchObject({
      learningUpdate: { status: 'NOT_ELIGIBLE', changedItems: [] },
    });
    expect(cancelled.workflow.save).not.toHaveBeenCalled();
    expect(cancelled.repository.setLearningWriteStatus).toHaveBeenCalledWith(
      'user-a',
      'assessment_1',
      'NOT_ELIGIBLE',
    );
  });
});
