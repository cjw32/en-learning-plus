import { resolveCoachRuntimeConfig } from '../../src/coach/governance/coach-config.schema';
import { ServiceUnavailableException } from '@nestjs/common';
import { assertCoachEnabled } from '../../src/coach/governance/coach-enabled.guard';

describe('Coach runtime configuration', () => {
  it('keeps every capability disabled when configuration is absent', () => {
    expect(resolveCoachRuntimeConfig({})).toEqual({
      enabled: false,
      liveModelEnabled: false,
      writeEnabled: false,
      modelName: null,
      modelVersion: null,
      modelPriceVersion: null,
      budgetPolicyVersion: null,
      evaluationDatasetVersion: null,
    });
  });

  it('allows a read-only Coach without live model or write authority', () => {
    expect(resolveCoachRuntimeConfig({ COACH_ENABLED: 'true' })).toMatchObject({
      enabled: true,
      liveModelEnabled: false,
      writeEnabled: false,
    });
  });

  it('fails closed at the HTTP boundary while the master flag is disabled', () => {
    expect(() => assertCoachEnabled({})).toThrow(ServiceUnavailableException);
    expect(() => assertCoachEnabled({ COACH_ENABLED: 'true' })).not.toThrow();
  });

  it('requires approved versioned policy for live model use', () => {
    expect(() =>
      resolveCoachRuntimeConfig({
        COACH_ENABLED: 'true',
        COACH_LIVE_MODEL_ENABLED: 'true',
        COACH_MODEL_NAME: 'deepseek-chat',
        COACH_MODEL_VERSION: 'candidate-1',
        COACH_MODEL_PRICE_VERSION: 'placeholder',
        COACH_BUDGET_POLICY_VERSION: 'budget-v1',
        COACH_EVAL_DATASET_VERSION: 'eval-v1',
      }),
    ).toThrow('COACH_MODEL_PRICE_VERSION');
  });

  it('rejects write authority unless live model authority is enabled', () => {
    expect(() =>
      resolveCoachRuntimeConfig({
        COACH_ENABLED: 'true',
        COACH_WRITE_ENABLED: 'true',
      }),
    ).toThrow('COACH_WRITE_ENABLED requires COACH_LIVE_MODEL_ENABLED');
  });

  it('accepts fully versioned live and write configuration', () => {
    expect(
      resolveCoachRuntimeConfig({
        COACH_ENABLED: 'true',
        COACH_LIVE_MODEL_ENABLED: 'true',
        COACH_WRITE_ENABLED: 'true',
        COACH_MODEL_NAME: 'deepseek-chat',
        COACH_MODEL_VERSION: 'candidate-1',
        COACH_MODEL_PRICE_VERSION: 'price-v1',
        COACH_BUDGET_POLICY_VERSION: 'budget-v1',
        COACH_EVAL_DATASET_VERSION: 'eval-v1',
      }),
    ).toMatchObject({
      enabled: true,
      liveModelEnabled: true,
      writeEnabled: true,
    });
  });
});
