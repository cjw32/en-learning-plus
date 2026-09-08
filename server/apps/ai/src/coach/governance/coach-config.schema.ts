export type CoachRuntimeConfig = Readonly<{
  enabled: boolean;
  liveModelEnabled: boolean;
  writeEnabled: boolean;
  modelName: string | null;
  modelVersion: string | null;
  modelPriceVersion: string | null;
  budgetPolicyVersion: string | null;
  evaluationDatasetVersion: string | null;
}>;

const forbiddenValues = new Set([
  '',
  'placeholder',
  'replace-me',
  'todo',
  'tbd',
  'unknown',
]);

function optionalVersion(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function assertApprovedValue(name: string, value: string | null): void {
  if (!value || forbiddenValues.has(value.toLowerCase())) {
    throw new Error(`${name} must be an approved non-placeholder value`);
  }
}

export function resolveCoachRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): CoachRuntimeConfig {
  const result: CoachRuntimeConfig = Object.freeze({
    enabled: enabled(environment.COACH_ENABLED),
    liveModelEnabled: enabled(environment.COACH_LIVE_MODEL_ENABLED),
    writeEnabled: enabled(environment.COACH_WRITE_ENABLED),
    modelName: optionalVersion(environment.COACH_MODEL_NAME),
    modelVersion: optionalVersion(environment.COACH_MODEL_VERSION),
    modelPriceVersion: optionalVersion(environment.COACH_MODEL_PRICE_VERSION),
    budgetPolicyVersion: optionalVersion(
      environment.COACH_BUDGET_POLICY_VERSION,
    ),
    evaluationDatasetVersion: optionalVersion(
      environment.COACH_EVAL_DATASET_VERSION,
    ),
  });

  if (result.liveModelEnabled && !result.enabled) {
    throw new Error('COACH_LIVE_MODEL_ENABLED requires COACH_ENABLED');
  }
  if (result.writeEnabled && !result.liveModelEnabled) {
    throw new Error('COACH_WRITE_ENABLED requires COACH_LIVE_MODEL_ENABLED');
  }

  if (result.liveModelEnabled || result.writeEnabled) {
    assertApprovedValue('COACH_MODEL_NAME', result.modelName);
    assertApprovedValue('COACH_MODEL_VERSION', result.modelVersion);
    assertApprovedValue('COACH_MODEL_PRICE_VERSION', result.modelPriceVersion);
    assertApprovedValue(
      'COACH_BUDGET_POLICY_VERSION',
      result.budgetPolicyVersion,
    );
    assertApprovedValue(
      'COACH_EVAL_DATASET_VERSION',
      result.evaluationDatasetVersion,
    );
  }

  return result;
}
