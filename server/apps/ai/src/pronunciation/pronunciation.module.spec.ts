import { MODULE_METADATA } from '@nestjs/common/constants';
import { LearningModule } from '@libs/learning';
import { SharedModule } from '@libs/shared';
import { AiModule } from '../ai.module';
import { resolvePronunciationRuntimeConfig } from './governance/pronunciation-config.schema';
import { PronunciationRedisModule } from './governance/pronunciation-redis.module';
import { UnavailablePronunciationAssessmentProvider } from './provider/pronunciation-assessment.provider';
import { UnavailablePronunciationAudioStorage } from './storage/pronunciation-audio.storage';
import { PronunciationModule } from './pronunciation.module';

describe('PronunciationModule default-off registration', () => {
  it('registers the existing shared/learning modules and lazy queue connection', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      PronunciationModule,
    ) as unknown[];
    expect(imports).toEqual(
      expect.arrayContaining([
        SharedModule,
        LearningModule,
        PronunciationRedisModule,
      ]),
    );
    const aiImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AiModule,
    ) as unknown[];
    expect(aiImports).toContain(PronunciationModule);
  });

  it('keeps all capabilities off when pronunciation settings are absent', () => {
    const config = resolvePronunciationRuntimeConfig({});
    expect(
      Object.entries(config).filter(([, value]) => value === true),
    ).toEqual([]);
  });

  it('uses unavailable adapters that cannot mutate a bucket or call a Provider', async () => {
    const storage = new UnavailablePronunciationAudioStorage();
    const provider = new UnavailablePronunciationAssessmentProvider();
    await expect(storage.assertPrivateLifecycleReady()).rejects.toMatchObject({
      code: 'STORAGE_NOT_APPROVED',
    });
    await expect(
      provider.assess({
        assessmentId: 'assessment-1',
        referenceText: 'hello',
        locale: 'en-US',
        canonicalAudio: new Uint8Array(),
        applicationConnectionId: 'connection-1',
        deadlineAt: new Date('2030-01-01T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_APPROVED' });
  });
});
