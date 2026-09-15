import { AzurePronunciationAssessmentProvider } from '../provider/azure-pronunciation.provider';
import { FfmpegPronunciationAudioInspector } from '../audio/ffmpeg-pronunciation-audio-inspector';
import { MinioPronunciationAudioStorage } from '../storage/minio-pronunciation-audio.storage';
import { PronunciationRuntimeAdapters } from './pronunciation-runtime.adapters';
import { resolvePronunciationRuntimeConfig } from '../governance/pronunciation-config.schema';
import { PronunciationCapabilitiesController } from '../api/pronunciation-capabilities.controller';
import { pronunciationCapabilitiesSchema } from '@en/common/pronunciation';

describe('pronunciation runtime capability discovery', () => {
  it('composes without credentials and never probes external services while off', async () => {
    const minio = { getClient: jest.fn() };
    const redis = { assertReady: jest.fn() };
    const adapters = new PronunciationRuntimeAdapters(
      { get: () => undefined } as never,
      resolvePronunciationRuntimeConfig({}),
      minio as never,
      {} as never,
      redis as never,
    );
    const result = await new PronunciationCapabilitiesController(
      adapters,
    ).get();
    expect(pronunciationCapabilitiesSchema.parse(result.data)).toMatchObject({
      available: false,
      reason: 'FEATURE_DISABLED',
      learningWrite: false,
    });
    expect(minio.getClient).not.toHaveBeenCalled();
    expect(redis.assertReady).not.toHaveBeenCalled();
  });
  it('does not advertise availability when private storage or conversion is unavailable', async () => {
    const adapters = new PronunciationRuntimeAdapters(
      { get: () => undefined } as never,
      {
        ...resolvePronunciationRuntimeConfig({}),
        captureEnabled: true,
        uploadEnabled: true,
        resultDisplayEnabled: true,
      } as never,
      {} as never,
      {} as never,
      { assertReady: async () => undefined } as never,
    );
    Object.defineProperty(adapters, 'config', {
      value: { ...adapters.config, providerEnabled: true },
    });
    expect(await adapters.capabilities()).toMatchObject({
      available: false,
      reason: 'SERVICE_UNAVAILABLE',
    });
  });
  it('rejects a partially configured approved runtime at startup', () => {
    expect(
      () =>
        new PronunciationRuntimeAdapters(
          { get: () => undefined } as never,
          {
            ...resolvePronunciationRuntimeConfig({}),
            audioRuntimeApproved: true,
          },
          {} as never,
          {} as never,
          {} as never,
        ),
    ).toThrow('PRONUNCIATION_FFMPEG_PATH');
  });
  it.each([false, true])('selects real adapters without calling paid services (regional endpoint: %s)', (regional) => {
    const env: Record<string, string> = {
      AZURE_SPEECH_RESOURCE_NAME: 'local-test-resource', AZURE_SPEECH_KEY: 'synthetic-test-key', AZURE_SPEECH_REGION: 'eastasia',
      PRONUNCIATION_AUDIO_BUCKET: 'private-test-bucket', PRONUNCIATION_TRACE_PEPPER: 'synthetic-test-pepper',
      PRONUNCIATION_FFMPEG_PATH: '/test/ffmpeg', PRONUNCIATION_FFPROBE_PATH: '/test/ffprobe',
      PRONUNCIATION_CURRENCY: 'USD', PRONUNCIATION_PRICE_MICROS_PER_SECOND: '10', PRONUNCIATION_MINIMUM_BILLABLE_MS: '1000',
      PRONUNCIATION_PRICE_VALID_FROM: '2026-01-01T00:00:00Z', PRONUNCIATION_PRICE_VALID_UNTIL: '2027-01-01T00:00:00Z',
      PRONUNCIATION_PROVIDER_MODEL_VERSION: 'synthetic-model-v1', PRONUNCIATION_PROVIDER_REGION: 'eastasia',
    };
    if (regional) {
      delete env.AZURE_SPEECH_RESOURCE_NAME;
      env.AZURE_SPEECH_ENDPOINT = 'https://eastasia.api.cognitive.microsoft.com/';
    }
    for (const flag of ['CAPTURE_ENABLED', 'UPLOAD_ENABLED', 'PROVIDER_ENABLED', 'RESULT_DISPLAY_ENABLED', 'AUDIO_RUNTIME_APPROVED', 'STORAGE_APPROVED', 'PROVIDER_APPROVED', 'MODEL_IDENTITY_VENDOR_ATTESTED', 'MODEL_IDENTITY_IMMUTABLE', 'MODEL_IDENTITY_QUERYABLE']) env[`PRONUNCIATION_${flag}`] = 'true';
    for (const version of ['MODEL_IDENTITY_EVIDENCE_VERSION', 'PRIVACY_EVIDENCE_VERSION', 'PRICE_VERSION', 'BUDGET_POLICY_VERSION']) env[`PRONUNCIATION_${version}`] = 'synthetic-test-v1';
    for (const cap of ['MAX_CALL_COST_MICROS', 'SUBJECT_DAILY_BUDGET_MICROS', 'SYSTEM_DAILY_BUDGET_MICROS', 'SYSTEM_MONTHLY_BUDGET_MICROS']) env[`PRONUNCIATION_${cap}`] = '100000';
    if (regional) {
      env.AZURE_SPEECH_TIER = 'F0';
      env.PRONUNCIATION_PRICE_MICROS_PER_SECOND = '0';
      env.PRONUNCIATION_MODEL_IDENTITY_MODE = 'AZURE_MANAGED';
      delete env.PRONUNCIATION_PROVIDER_MODEL_VERSION;
      delete env.PRONUNCIATION_MODEL_IDENTITY_EVIDENCE_VERSION;
      for (const flag of ['VENDOR_ATTESTED','IMMUTABLE','QUERYABLE']) env[`PRONUNCIATION_MODEL_IDENTITY_${flag}`] = 'false';
    }
    const redis = { assertReady: jest.fn() };
    const adapters = new PronunciationRuntimeAdapters({ get: (key: string) => env[key] } as never, resolvePronunciationRuntimeConfig(env), { getClient: () => ({}) } as never, {} as never, redis as never);
    expect(adapters.provider).toBeInstanceOf(AzurePronunciationAssessmentProvider);
    expect(adapters.inspector).toBeInstanceOf(FfmpegPronunciationAudioInspector);
    expect(adapters.storage).toBeInstanceOf(MinioPronunciationAudioStorage);
    expect(redis.assertReady).not.toHaveBeenCalled();
    if (regional) {
      const create = () => new PronunciationRuntimeAdapters({ get: (key: string) => env[key] } as never, resolvePronunciationRuntimeConfig(env), { getClient: () => ({}) } as never, {} as never, redis as never);
      env.PRONUNCIATION_PRICE_MICROS_PER_SECOND = '1';
      expect(create).toThrow('F0 requires zero');
      env.PRONUNCIATION_PRICE_MICROS_PER_SECOND = '0';
      env.PRONUNCIATION_MONTHLY_AUDIO_SECONDS = '18001';
      expect(create).toThrow('F0 audio quota exceeds');
    }
  });

});
