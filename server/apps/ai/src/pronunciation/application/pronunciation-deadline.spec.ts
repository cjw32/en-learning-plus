import type {
  PronunciationSourceRightsService,
  PronunciationTargetService,
} from '@libs/learning';
import type { PronunciationRuntimeConfig } from '../governance/pronunciation-config.schema';
import type { PronunciationRepository } from './pronunciation.repository';
import {
  PronunciationAssessmentService,
  type PronunciationExecutionBoundary,
} from './pronunciation-assessment.service';

describe('pronunciation 30-second durable deadline', () => {
  it.each([
    'UPLOAD',
    'QUEUE',
    'PRE_PROVIDER',
    'POST_PROVIDER',
    'PRE_LEARNING',
  ] as PronunciationExecutionBoundary[])(
    'times out at %s without a result or learning write',
    async (boundary) => {
      const deadline = new Date('2026-09-10T00:00:30.000Z');
      const repository = {
        findOwnedWithTarget: jest.fn(async () => ({
          assessment: {
            id: 'assessment-1',
            subjectId: 'subject-1',
            clientIdempotencyKey: 'key-0000000000001',
            requestBodyHash: 'hash',
            status: boundary === 'UPLOAD' ? 'CREATED' : 'PROCESSING',
            exerciseType: 'WORD',
            deadlineAt: deadline,
            cancelRequestedAt: null,
            createdAt: new Date('2026-09-10T00:00:00.000Z'),
            updatedAt: new Date('2026-09-10T00:00:00.000Z'),
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
            authorizedAt: deadline,
            expiresAt: null,
          },
          audio: null,
        })),
        transitionOwned: jest.fn(async () => true),
        persistResult: jest.fn(),
      } as unknown as PronunciationRepository;
      const config = {
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
        maxCallCostMicros: 1,
        subjectDailyBudgetMicros: 2,
        systemDailyBudgetMicros: 3,
        systemMonthlyBudgetMicros: 4,
      } satisfies PronunciationRuntimeConfig;
      const service = new PronunciationAssessmentService(
        repository,
        {} as PronunciationTargetService,
        {} as PronunciationSourceRightsService,
        config,
        () => 'id',
        undefined,
        () => deadline,
      );

      await expect(
        service.assertExecutionBoundary({
          subjectId: 'subject-1',
          assessmentId: 'assessment-1',
          boundary,
        }),
      ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
      expect((repository as any).transitionOwned).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'TIMED_OUT' }),
      );
      expect((repository as any).persistResult).not.toHaveBeenCalled();
    },
  );
});
