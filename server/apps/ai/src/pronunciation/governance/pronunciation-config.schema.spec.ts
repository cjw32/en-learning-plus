import { resolvePronunciationRuntimeConfig } from './pronunciation-config.schema';

const approvedProviderEnvironment: NodeJS.ProcessEnv = {
  PRONUNCIATION_CAPTURE_ENABLED: 'true',
  PRONUNCIATION_UPLOAD_ENABLED: 'true',
  PRONUNCIATION_PROVIDER_ENABLED: 'true',
  PRONUNCIATION_AUDIO_RUNTIME_APPROVED: 'true',
  PRONUNCIATION_STORAGE_APPROVED: 'true',
  PRONUNCIATION_PROVIDER_APPROVED: 'true',
  PRONUNCIATION_PROVIDER_MODEL_VERSION: 'vendor-engine-2026-09',
  PRONUNCIATION_PROVIDER_REGION: 'approved-test-region',
  PRONUNCIATION_PRIVACY_EVIDENCE_VERSION: 'privacy-review-2026-09',
  PRONUNCIATION_PRICE_VERSION: 'price-review-2026-09',
  PRONUNCIATION_BUDGET_POLICY_VERSION: 'budget-review-2026-09',
  PRONUNCIATION_MAX_CALL_COST_MICROS: '1000',
  PRONUNCIATION_SUBJECT_DAILY_BUDGET_MICROS: '10000',
  PRONUNCIATION_SYSTEM_DAILY_BUDGET_MICROS: '100000',
  PRONUNCIATION_SYSTEM_MONTHLY_BUDGET_MICROS: '1000000',
};

describe('pronunciation runtime config', () => {
  it('keeps every behavior gate closed by default', () => {
    const config = resolvePronunciationRuntimeConfig({});

    expect(config).toMatchObject({
      captureEnabled: false,
      uploadEnabled: false,
      providerEnabled: false,
      resultDisplayEnabled: false,
      learningShadowEnabled: false,
      learningWriteEnabled: false,
      coachSummaryEnabled: false,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([['TRUE'], ['1'], ['yes']])(
    'rejects malformed boolean value %s',
    (value) => {
      expect(() =>
        resolvePronunciationRuntimeConfig({
          PRONUNCIATION_CAPTURE_ENABLED: value,
        }),
      ).toThrow();
    },
  );

  it('rejects opening upload without approved runtime and storage', () => {
    expect(() =>
      resolvePronunciationRuntimeConfig({
        PRONUNCIATION_CAPTURE_ENABLED: 'true',
        PRONUNCIATION_UPLOAD_ENABLED: 'true',
      }),
    ).toThrow(/audio runtime and storage/);
  });

  it.each([
    ['PRONUNCIATION_PROVIDER_MODEL_VERSION', 'unknown'],
    ['PRONUNCIATION_PRIVACY_EVIDENCE_VERSION', 'placeholder'],
    ['PRONUNCIATION_PRICE_VERSION', 'tbd'],
    ['PRONUNCIATION_BUDGET_POLICY_VERSION', ''],
  ])('rejects missing or unapproved %s', (name, value) => {
    expect(() =>
      resolvePronunciationRuntimeConfig({
        ...approvedProviderEnvironment,
        [name]: value,
      }),
    ).toThrow(/approved non-placeholder value/);
  });

  it('rejects unknown, absent or non-positive budgets', () => {
    expect(() =>
      resolvePronunciationRuntimeConfig({
        ...approvedProviderEnvironment,
        PRONUNCIATION_MAX_CALL_COST_MICROS: '0',
      }),
    ).toThrow(/positive safe integer/);
    expect(() =>
      resolvePronunciationRuntimeConfig({
        ...approvedProviderEnvironment,
        PRONUNCIATION_SYSTEM_MONTHLY_BUDGET_MICROS: undefined,
      }),
    ).toThrow(/four pronunciation budget caps/);
  });

  it('requires progressive gate ordering and evaluation approval', () => {
    expect(() =>
      resolvePronunciationRuntimeConfig({
        ...approvedProviderEnvironment,
        PRONUNCIATION_RESULT_DISPLAY_ENABLED: 'true',
        PRONUNCIATION_LEARNING_SHADOW_ENABLED: 'true',
        PRONUNCIATION_LEARNING_WRITE_ENABLED: 'true',
      }),
    ).toThrow(/EVALUATION_APPROVAL_VERSION/);
    expect(
      resolvePronunciationRuntimeConfig({
        ...approvedProviderEnvironment,
        PRONUNCIATION_RESULT_DISPLAY_ENABLED: 'true',
        PRONUNCIATION_LEARNING_SHADOW_ENABLED: 'true',
        PRONUNCIATION_LEARNING_WRITE_ENABLED: 'true',
        PRONUNCIATION_COACH_SUMMARY_ENABLED: 'true',
        PRONUNCIATION_EVALUATION_APPROVAL_VERSION: 'evaluation-review-2026-09',
      }),
    ).toMatchObject({
      providerEnabled: true,
      resultDisplayEnabled: true,
      learningWriteEnabled: true,
      coachSummaryEnabled: true,
    });
  });
});
