import { PRONUNCIATION_QUEUE_NAME } from '../../src/pronunciation/queue/pronunciation.queue';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { EmailService, PayService, PrismaService } from '@libs/shared';
import { MinioService } from '@libs/shared/minio/minio.service';
import { AiModule } from '../../src/ai.module';
import { CoachRedisConnection } from '../../src/coach/streaming/coach-redis.module';
import { PronunciationRedisConnection } from '../../src/pronunciation/governance/pronunciation-redis.module';
import { COACH_QUEUE_NAME } from '../../src/coach/queue/coach.queue';
import { KNOWLEDGE_INGESTION_QUEUE } from '../../src/knowledge/queue/knowledge-outbox.dispatcher';
import { digestQueueName } from '../../src/digest/digest.queue';
import { PronunciationAudioService } from '../../src/pronunciation/application/pronunciation-audio.service';
import { PRONUNCIATION_RUNTIME_CONFIG, resolvePronunciationRuntimeConfig } from '../../src/pronunciation/governance/pronunciation-config.schema';

describe('AI production provider composition', () => {
  it('resolves all application providers with external infrastructure replaced', async () => {
    const builder = Test.createTestingModule({ imports: [AiModule] });
    // Compile the real module graph, without running network lifecycle hooks.
    for (const token of [
      PrismaService,
      MinioService,
      PayService,
      EmailService,
      CoachRedisConnection,
      PronunciationRedisConnection,
    ]) {
      builder.overrideProvider(token).useValue({ client: {} });
    }
    builder.overrideProvider(ConfigService).useValue({ get: () => undefined });
    builder.overrideProvider(PRONUNCIATION_RUNTIME_CONFIG).useValue(resolvePronunciationRuntimeConfig({}));
    for (const name of [
      COACH_QUEUE_NAME,
      PRONUNCIATION_QUEUE_NAME,
      KNOWLEDGE_INGESTION_QUEUE,
      digestQueueName.name,
    ]) {
      builder.overrideProvider(getQueueToken(name)).useValue({});
    }
    const module = await builder.compile();
    expect(module.get(PronunciationAudioService)).toBeDefined();
    await module.close();
  });
});
