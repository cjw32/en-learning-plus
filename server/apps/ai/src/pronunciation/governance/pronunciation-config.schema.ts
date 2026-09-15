import { z } from '@en/common/coach/zod';
import { AZURE_MANAGED_MODEL_IDENTITY } from '../provider/azure-pronunciation.identity';

export const PRONUNCIATION_RUNTIME_CONFIG = Symbol(
  'PRONUNCIATION_RUNTIME_CONFIG',
);

const forbiddenApprovalValues = new Set([
  '',
  'unknown',
  'placeholder',
  'replace-me',
  'todo',
  'tbd',
]);

const booleanTextSchema = z.enum(['true', 'false']).optional();
const optionalTextSchema = z.string().optional();

const pronunciationEnvironmentSchema = z
  .object({
    PRONUNCIATION_CAPTURE_ENABLED: booleanTextSchema,
    PRONUNCIATION_UPLOAD_ENABLED: booleanTextSchema,
    PRONUNCIATION_PROVIDER_ENABLED: booleanTextSchema,
    PRONUNCIATION_RESULT_DISPLAY_ENABLED: booleanTextSchema,
    PRONUNCIATION_LEARNING_SHADOW_ENABLED: booleanTextSchema,
    PRONUNCIATION_LEARNING_WRITE_ENABLED: booleanTextSchema,
    PRONUNCIATION_COACH_SUMMARY_ENABLED: booleanTextSchema,
    PRONUNCIATION_AUDIO_RUNTIME_APPROVED: booleanTextSchema,
    PRONUNCIATION_STORAGE_APPROVED: booleanTextSchema,
    PRONUNCIATION_PROVIDER_APPROVED: booleanTextSchema,
    PRONUNCIATION_PROVIDER_MODEL_VERSION: optionalTextSchema,
    PRONUNCIATION_MODEL_IDENTITY_MODE: z
      .enum(['AZURE_MANAGED', 'VENDOR_ATTESTED'])
      .optional(),
    PRONUNCIATION_PROVIDER_REGION: optionalTextSchema,
    PRONUNCIATION_PRIVACY_EVIDENCE_VERSION: optionalTextSchema,
    PRONUNCIATION_PRICE_VERSION: optionalTextSchema,
    PRONUNCIATION_BUDGET_POLICY_VERSION: optionalTextSchema,
    PRONUNCIATION_EVALUATION_APPROVAL_VERSION: optionalTextSchema,
    PRONUNCIATION_MAX_CALL_COST_MICROS: optionalTextSchema,
    PRONUNCIATION_SUBJECT_DAILY_BUDGET_MICROS: optionalTextSchema,
    PRONUNCIATION_SYSTEM_DAILY_BUDGET_MICROS: optionalTextSchema,
    PRONUNCIATION_SYSTEM_MONTHLY_BUDGET_MICROS: optionalTextSchema,
  })
  .passthrough();

export type PronunciationRuntimeConfig = Readonly<{
  captureEnabled: boolean;
  uploadEnabled: boolean;
  providerEnabled: boolean;
  resultDisplayEnabled: boolean;
  learningShadowEnabled: boolean;
  learningWriteEnabled: boolean;
  coachSummaryEnabled: boolean;
  audioRuntimeApproved: boolean;
  storageApproved: boolean;
  providerApproved: boolean;
  providerModelVersion: string | null;
  providerRegion: string | null;
  privacyEvidenceVersion: string | null;
  priceVersion: string | null;
  budgetPolicyVersion: string | null;
  evaluationApprovalVersion: string | null;
  maxCallCostMicros: number | null;
  subjectDailyBudgetMicros: number | null;
  systemDailyBudgetMicros: number | null;
  systemMonthlyBudgetMicros: number | null;
}>;

function enabled(value: 'true' | 'false' | undefined): boolean {
  return value === 'true';
}

function approvedText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function requireApprovedText(name: string, value: string | null): void {
  if (!value || forbiddenApprovalValues.has(value.toLowerCase())) {
    throw new Error(`${name} must be an approved non-placeholder value`);
  }
}

function budgetMicros(name: string, value: string | undefined): number | null {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function requireGate(
  enabledGate: boolean,
  prerequisite: boolean,
  message: string,
): void {
  if (enabledGate && !prerequisite) throw new Error(message);
}

export function resolvePronunciationRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): PronunciationRuntimeConfig {
  const parsed = pronunciationEnvironmentSchema.parse(environment);
  const config: PronunciationRuntimeConfig = Object.freeze({
    captureEnabled: enabled(parsed.PRONUNCIATION_CAPTURE_ENABLED),
    uploadEnabled: enabled(parsed.PRONUNCIATION_UPLOAD_ENABLED),
    providerEnabled: enabled(parsed.PRONUNCIATION_PROVIDER_ENABLED),
    resultDisplayEnabled: enabled(parsed.PRONUNCIATION_RESULT_DISPLAY_ENABLED),
    learningShadowEnabled: enabled(
      parsed.PRONUNCIATION_LEARNING_SHADOW_ENABLED,
    ),
    learningWriteEnabled: enabled(parsed.PRONUNCIATION_LEARNING_WRITE_ENABLED),
    coachSummaryEnabled: enabled(parsed.PRONUNCIATION_COACH_SUMMARY_ENABLED),
    audioRuntimeApproved: enabled(parsed.PRONUNCIATION_AUDIO_RUNTIME_APPROVED),
    storageApproved: enabled(parsed.PRONUNCIATION_STORAGE_APPROVED),
    providerApproved: enabled(parsed.PRONUNCIATION_PROVIDER_APPROVED),
    providerModelVersion:
      parsed.PRONUNCIATION_MODEL_IDENTITY_MODE === 'AZURE_MANAGED'
        ? AZURE_MANAGED_MODEL_IDENTITY
        : approvedText(parsed.PRONUNCIATION_PROVIDER_MODEL_VERSION),
    providerRegion: approvedText(parsed.PRONUNCIATION_PROVIDER_REGION),
    privacyEvidenceVersion: approvedText(
      parsed.PRONUNCIATION_PRIVACY_EVIDENCE_VERSION,
    ),
    priceVersion: approvedText(parsed.PRONUNCIATION_PRICE_VERSION),
    budgetPolicyVersion: approvedText(
      parsed.PRONUNCIATION_BUDGET_POLICY_VERSION,
    ),
    evaluationApprovalVersion: approvedText(
      parsed.PRONUNCIATION_EVALUATION_APPROVAL_VERSION,
    ),
    maxCallCostMicros: budgetMicros(
      'PRONUNCIATION_MAX_CALL_COST_MICROS',
      parsed.PRONUNCIATION_MAX_CALL_COST_MICROS,
    ),
    subjectDailyBudgetMicros: budgetMicros(
      'PRONUNCIATION_SUBJECT_DAILY_BUDGET_MICROS',
      parsed.PRONUNCIATION_SUBJECT_DAILY_BUDGET_MICROS,
    ),
    systemDailyBudgetMicros: budgetMicros(
      'PRONUNCIATION_SYSTEM_DAILY_BUDGET_MICROS',
      parsed.PRONUNCIATION_SYSTEM_DAILY_BUDGET_MICROS,
    ),
    systemMonthlyBudgetMicros: budgetMicros(
      'PRONUNCIATION_SYSTEM_MONTHLY_BUDGET_MICROS',
      parsed.PRONUNCIATION_SYSTEM_MONTHLY_BUDGET_MICROS,
    ),
  });

  requireGate(
    config.uploadEnabled,
    config.captureEnabled &&
      config.audioRuntimeApproved &&
      config.storageApproved,
    'upload requires capture plus approved audio runtime and storage',
  );
  requireGate(
    config.providerEnabled,
    config.uploadEnabled && config.providerApproved,
    'provider requires upload and explicit Provider approval',
  );
  requireGate(
    config.resultDisplayEnabled,
    config.providerEnabled,
    'result display requires the Provider gate',
  );
  requireGate(
    config.learningShadowEnabled,
    config.resultDisplayEnabled,
    'learning shadow requires result display',
  );
  requireGate(
    config.learningWriteEnabled,
    config.learningShadowEnabled,
    'learning write requires learning shadow',
  );
  requireGate(
    config.coachSummaryEnabled,
    config.resultDisplayEnabled,
    'Coach summary requires result display',
  );

  if (config.providerEnabled) {
    requireApprovedText(
      'PRONUNCIATION_PROVIDER_MODEL_VERSION',
      config.providerModelVersion,
    );
    requireApprovedText('PRONUNCIATION_PROVIDER_REGION', config.providerRegion);
    requireApprovedText(
      'PRONUNCIATION_PRIVACY_EVIDENCE_VERSION',
      config.privacyEvidenceVersion,
    );
    requireApprovedText('PRONUNCIATION_PRICE_VERSION', config.priceVersion);
    requireApprovedText(
      'PRONUNCIATION_BUDGET_POLICY_VERSION',
      config.budgetPolicyVersion,
    );
    if (
      !config.maxCallCostMicros ||
      !config.subjectDailyBudgetMicros ||
      !config.systemDailyBudgetMicros ||
      !config.systemMonthlyBudgetMicros
    ) {
      throw new Error('all four pronunciation budget caps are required');
    }
  }

  if (config.learningWriteEnabled || config.coachSummaryEnabled) {
    requireApprovedText(
      'PRONUNCIATION_EVALUATION_APPROVAL_VERSION',
      config.evaluationApprovalVersion,
    );
  }

  return config;
}
