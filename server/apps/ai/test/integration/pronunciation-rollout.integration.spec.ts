import type {
  PronunciationSourceRightsService,
  PronunciationTargetService,
} from '@libs/learning';
import { PronunciationAssessmentService } from '../../src/pronunciation/application/pronunciation-assessment.service';
import type { PronunciationRepository } from '../../src/pronunciation/application/pronunciation.repository';
import { resolvePronunciationRuntimeConfig } from '../../src/pronunciation/governance/pronunciation-config.schema';
import { PronunciationCleanupProcessor } from '../../src/pronunciation/queue/pronunciation-cleanup.processor';

const approvedProvider = {
  PRONUNCIATION_CAPTURE_ENABLED: 'true',
  PRONUNCIATION_UPLOAD_ENABLED: 'true',
  PRONUNCIATION_AUDIO_RUNTIME_APPROVED: 'true',
  PRONUNCIATION_STORAGE_APPROVED: 'true',
  PRONUNCIATION_PROVIDER_ENABLED: 'true',
  PRONUNCIATION_PROVIDER_APPROVED: 'true',
  PRONUNCIATION_PROVIDER_MODEL_VERSION: 'model-v1',
  PRONUNCIATION_PROVIDER_REGION: 'eastasia',
  PRONUNCIATION_PRIVACY_EVIDENCE_VERSION: 'privacy-v1',
  PRONUNCIATION_PRICE_VERSION: 'price-v1',
  PRONUNCIATION_BUDGET_POLICY_VERSION: 'budget-v1',
  PRONUNCIATION_MAX_CALL_COST_MICROS: '100',
  PRONUNCIATION_SUBJECT_DAILY_BUDGET_MICROS: '1000',
  PRONUNCIATION_SYSTEM_DAILY_BUDGET_MICROS: '10000',
  PRONUNCIATION_SYSTEM_MONTHLY_BUDGET_MICROS: '100000',
} as const;

describe('pronunciation progressive rollout gates', () => {
  it.each([
    [
      'recording',
      { PRONUNCIATION_CAPTURE_ENABLED: 'true' },
      ['captureEnabled'],
    ],
    [
      'private upload',
      {
        PRONUNCIATION_CAPTURE_ENABLED: 'true',
        PRONUNCIATION_UPLOAD_ENABLED: 'true',
        PRONUNCIATION_AUDIO_RUNTIME_APPROVED: 'true',
        PRONUNCIATION_STORAGE_APPROVED: 'true',
      },
      [
        'captureEnabled',
        'uploadEnabled',
        'audioRuntimeApproved',
        'storageApproved',
      ],
    ],
    [
      'Provider hidden-result',
      approvedProvider,
      [
        'captureEnabled',
        'uploadEnabled',
        'providerEnabled',
        'audioRuntimeApproved',
        'storageApproved',
        'providerApproved',
      ],
    ],
    [
      'result display',
      { ...approvedProvider, PRONUNCIATION_RESULT_DISPLAY_ENABLED: 'true' },
      [
        'captureEnabled',
        'uploadEnabled',
        'providerEnabled',
        'resultDisplayEnabled',
        'audioRuntimeApproved',
        'storageApproved',
        'providerApproved',
      ],
    ],
    [
      'learning write',
      {
        ...approvedProvider,
        PRONUNCIATION_RESULT_DISPLAY_ENABLED: 'true',
        PRONUNCIATION_LEARNING_SHADOW_ENABLED: 'true',
        PRONUNCIATION_LEARNING_WRITE_ENABLED: 'true',
        PRONUNCIATION_EVALUATION_APPROVAL_VERSION: 'eval-v1',
      },
      [
        'captureEnabled',
        'uploadEnabled',
        'providerEnabled',
        'resultDisplayEnabled',
        'learningShadowEnabled',
        'learningWriteEnabled',
        'audioRuntimeApproved',
        'storageApproved',
        'providerApproved',
      ],
    ],
    [
      'Coach summary',
      {
        ...approvedProvider,
        PRONUNCIATION_RESULT_DISPLAY_ENABLED: 'true',
        PRONUNCIATION_COACH_SUMMARY_ENABLED: 'true',
        PRONUNCIATION_EVALUATION_APPROVAL_VERSION: 'eval-v1',
      },
      [
        'captureEnabled',
        'uploadEnabled',
        'providerEnabled',
        'resultDisplayEnabled',
        'coachSummaryEnabled',
        'audioRuntimeApproved',
        'storageApproved',
        'providerApproved',
      ],
    ],
  ])(
    'enables only the documented %s capabilities',
    (_stage, environment, enabled) => {
      const config = resolvePronunciationRuntimeConfig(environment);
      expect(
        Object.entries(config)
          .filter(([, value]) => value === true)
          .map(([key]) => key),
      ).toEqual(enabled);
    },
  );

  it('rollback blocks new work while deletion/expiry cleanup continues', async () => {
    const config = resolvePronunciationRuntimeConfig({});
    const repository = {
      createIdempotent: jest.fn(),
    } as unknown as PronunciationRepository;
    const service = new PronunciationAssessmentService(
      repository,
      {} as PronunciationTargetService,
      {} as PronunciationSourceRightsService,
      config,
      () => 'assessment-id',
    );
    await expect(
      service.create({
        subjectId: 'subject-1',
        idempotencyKey: 'create-key-00000001',
        body: {
          locale: 'en-US',
          target: { sourceType: 'MANUAL', text: 'hello' },
        },
      }),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    expect((repository as any).createIdempotent).not.toHaveBeenCalled();

    const cleanupRepository = {
      claimDue: jest.fn(async () => [
        {
          tombstoneId: 'delete-1',
          objectKey: 'opaque-key',
          purgeDeadline: new Date('2026-09-10T01:00:00Z'),
        },
      ]),
      complete: jest.fn(),
      retry: jest.fn(),
    };
    const storage = { purge: jest.fn() };
    await new PronunciationCleanupProcessor(
      cleanupRepository,
      storage,
    ).processDue(new Date('2026-09-10T00:00:00Z'));
    expect(storage.purge).toHaveBeenCalledWith('opaque-key');
    expect(cleanupRepository.complete).toHaveBeenCalledTimes(1);
  });
});
