import { config as loadEnv } from 'dotenv';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolvePronunciationRuntimeConfig } from '../apps/ai/src/pronunciation/governance/pronunciation-config.schema';
import { resolveAzurePronunciationEndpoint } from '../apps/ai/src/pronunciation/provider/azure-pronunciation.endpoint';

// Read-only local diagnosis: never prints values, sends audio, or contacts a provider.
loadEnv({ path: process.env.PRONUNCIATION_ENV_FILE ?? '.env', quiet: true });
const required = [
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_REGION',
  'PRONUNCIATION_AUDIO_BUCKET',
  'PRONUNCIATION_TRACE_PEPPER',
  'PRONUNCIATION_REDIS_DB',
  'REDIS_HOST',
  'REDIS_PORT',
  'MINIO_ENDPOINT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'PRONUNCIATION_FFMPEG_PATH',
  'PRONUNCIATION_FFPROBE_PATH',
  'PRONUNCIATION_PROVIDER_MODEL_VERSION',
  'PRONUNCIATION_PROVIDER_REGION',
  'PRONUNCIATION_MODEL_IDENTITY_EVIDENCE_VERSION',
  'PRONUNCIATION_PRIVACY_EVIDENCE_VERSION',
  'PRONUNCIATION_PRICE_VERSION',
  'PRONUNCIATION_BUDGET_POLICY_VERSION',
  'PRONUNCIATION_CURRENCY',
  'PRONUNCIATION_PRICE_MICROS_PER_SECOND',
  'PRONUNCIATION_MINIMUM_BILLABLE_MS',
  'PRONUNCIATION_PRICE_VALID_FROM',
  'PRONUNCIATION_PRICE_VALID_UNTIL',
  'PRONUNCIATION_MAX_CALL_COST_MICROS',
  'PRONUNCIATION_SUBJECT_DAILY_BUDGET_MICROS',
  'PRONUNCIATION_SYSTEM_DAILY_BUDGET_MICROS',
  'PRONUNCIATION_SYSTEM_MONTHLY_BUDGET_MICROS',
];
async function main() {
  let configurationValid = false;
  let featureEnabled = false;
  try {
    const config = resolvePronunciationRuntimeConfig(process.env);
    configurationValid = true;
    featureEnabled = config.providerEnabled && config.resultDisplayEnabled;
  } catch {
    /* Do not emit environment values from validation errors. */
  }
  const managed = process.env.PRONUNCIATION_MODEL_IDENTITY_MODE === 'AZURE_MANAGED';
  const missing = required.filter((key) => !(managed && ['PRONUNCIATION_PROVIDER_MODEL_VERSION', 'PRONUNCIATION_MODEL_IDENTITY_EVIDENCE_VERSION'].includes(key)) && !process.env[key]?.trim());
  if (!process.env.AZURE_SPEECH_ENDPOINT?.trim() && !process.env.AZURE_SPEECH_RESOURCE_NAME?.trim()) {
    missing.push('AZURE_SPEECH_ENDPOINT or AZURE_SPEECH_RESOURCE_NAME');
  }
  const azureEndpointValid = Boolean(resolveAzurePronunciationEndpoint({
    endpoint: process.env.AZURE_SPEECH_ENDPOINT,
    resourceName: process.env.AZURE_SPEECH_RESOURCE_NAME,
    region: process.env.AZURE_SPEECH_REGION ?? null,
  }));
  const azureRegionMatches = process.env.AZURE_SPEECH_REGION === process.env.PRONUNCIATION_PROVIDER_REGION;
  const tier = process.env.AZURE_SPEECH_TIER ?? 'S0';
  const azureTierValid = ['F0', 'S0'].includes(tier) &&
    (tier !== 'F0' || (process.env.PRONUNCIATION_PRICE_MICROS_PER_SECOND?.trim() === '0' &&
      Number(process.env.PRONUNCIATION_MONTHLY_AUDIO_SECONDS || 14400) <= 18000));
  const modelIdentityValid = managed || (
    process.env.PRONUNCIATION_MODEL_IDENTITY_VENDOR_ATTESTED === 'true' &&
    process.env.PRONUNCIATION_MODEL_IDENTITY_IMMUTABLE === 'true' &&
    process.env.PRONUNCIATION_MODEL_IDENTITY_QUERYABLE === 'true');
  const executables: Record<string, boolean> = {};
  for (const key of [
    'PRONUNCIATION_FFMPEG_PATH',
    'PRONUNCIATION_FFPROBE_PATH',
  ]) {
    try {
      await access(process.env[key] ?? '', constants.X_OK);
      executables[key] = true;
    } catch {
      executables[key] = false;
    }
  }
  console.log(
    JSON.stringify(
      {
        configurationValid,
        featureEnabled,
        azureEndpointValid,
        azureRegionMatches,
        azureTierValid,
        modelIdentityValid,
        missing,
        executables,
        externalServicesChecked: false,
      },
      null,
      2,
    ),
  );
  if (
    !configurationValid ||
    !azureEndpointValid ||
    !azureRegionMatches || !azureTierValid || !modelIdentityValid ||
    !featureEnabled ||
    missing.length ||
    Object.values(executables).some((value) => !value)
  )
    process.exitCode = 2;
}
void main();
