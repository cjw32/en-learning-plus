import { PronunciationCapabilitiesController } from './api/pronunciation-capabilities.controller';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { PronunciationRedisConnection } from './governance/pronunciation-redis.module';
import { PronunciationRuntimeAdapters } from './runtime/pronunciation-runtime.adapters';
import { PronunciationAssessmentWorkerExecutor } from './runtime/pronunciation-assessment.executor';
import { PronunciationLifecycleService } from './runtime/pronunciation-lifecycle.service';
import { PronunciationSubmitAdmissionService } from './governance/pronunciation-submit-admission';
import {
  PronunciationQueueService,
  PRONUNCIATION_QUEUE_NAME,
} from './queue/pronunciation.queue';
import {
  PronunciationProcessor,
  PRONUNCIATION_ASSESSMENT_EXECUTOR,
} from './queue/pronunciation.processor';
import { PronunciationOutboxDispatcher } from './queue/pronunciation-outbox.dispatcher';
import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LearningModule } from '@libs/learning';
import {
  PronunciationLearningService,
  PronunciationLearningDeletionService,
  PronunciationLearningShadowService,
  PronunciationSourceRightsService,
  PronunciationTargetService,
} from '@libs/learning';
import { AuthGuard, SharedModule } from '@libs/shared';
import { PronunciationAssessmentService } from './application/pronunciation-assessment.service';
import { PronunciationAudioService } from './application/pronunciation-audio.service';
import { PronunciationRepository } from './application/pronunciation.repository';
import {
  PRONUNCIATION_AUDIO_UPLOAD_WORKFLOW,
  PronunciationController,
  UnavailablePronunciationAudioUploadWorkflow,
} from './api/pronunciation.controller';
import { PRONUNCIATION_AUDIO_INSPECTOR } from './audio/pronunciation-audio-inspector';
import {
  PRONUNCIATION_CANCELLATION_REPOSITORY,
  PRONUNCIATION_CANCELLATION_SIGNAL_STORE,
  PrismaPronunciationCancellationRepository,
  PronunciationCancellationService,
  RedisPronunciationCancellationSignalStore,
} from './governance/pronunciation-cancellation.service';
import {
  PRONUNCIATION_RUNTIME_CONFIG,
  type PronunciationRuntimeConfig,
  resolvePronunciationRuntimeConfig,
} from './governance/pronunciation-config.schema';
import {
  PronunciationUploadAdmissionService,
  PronunciationUploadGuard,
} from './api/pronunciation-upload.guard';
import { PronunciationRedisModule } from './governance/pronunciation-redis.module';
import {
  PRONUNCIATION_TRACE_REPOSITORY,
  PrismaPronunciationTraceRepository,
  PronunciationTraceService,
} from './observability/pronunciation-trace.service';
import { PRONUNCIATION_ASSESSMENT_PROVIDER } from './provider/pronunciation-assessment.provider';
import {
  PRONUNCIATION_AUDIO_STORAGE,
  type PronunciationAudioStorage,
} from './storage/pronunciation-audio.storage';
import {
  PrismaPronunciationAudioAccessRepository,
  PronunciationAudioAccessService,
  PronunciationAudioController,
} from './api/pronunciation-audio.controller';
import {
  PrismaPronunciationDeletionRepository,
  PronunciationDeletionService,
} from './privacy/pronunciation-deletion.service';
import {
  PrismaPronunciationCleanupRepository,
  PronunciationCleanupProcessor,
} from './queue/pronunciation-cleanup.processor';
import { PronunciationAccountCleanupService } from './privacy/pronunciation-account-cleanup.service';
import { LearningDataDeletionService } from '@libs/learning';
import { PrismaService } from '@libs/shared';
import {
  PrismaPronunciationTraceQueryRepository,
  PronunciationTraceQueryService,
} from './observability/pronunciation-trace-query.service';
import { PronunciationRetryService } from './application/pronunciation-retry.service';

export { PRONUNCIATION_RUNTIME_CONFIG } from './governance/pronunciation-config.schema';

@Module({
  imports: [
    SharedModule,
    LearningModule,
    PronunciationRedisModule,
    BullModule.registerQueueAsync({
      name: PRONUNCIATION_QUEUE_NAME,
      inject: [PronunciationRedisConnection, ConfigService],
      useFactory: (
        redis: PronunciationRedisConnection,
        config: ConfigService,
      ) =>
        config.get('PRONUNCIATION_PROVIDER_ENABLED') === 'true'
          ? { connection: redis.getBullConnectionOptions() }
          : {},
    }),
  ],
  controllers: [
    PronunciationController,
    PronunciationAudioController,
    PronunciationCapabilitiesController,
  ],
  providers: [
    AuthGuard,
    PronunciationRuntimeAdapters,
    PronunciationSubmitAdmissionService,
    PronunciationQueueService,
    PronunciationOutboxDispatcher,
    PronunciationAssessmentWorkerExecutor,
    {
      provide: PRONUNCIATION_ASSESSMENT_EXECUTOR,
      useExisting: PronunciationAssessmentWorkerExecutor,
    },
    PronunciationProcessor,
    PronunciationLifecycleService,
    PronunciationRepository,
    PronunciationUploadAdmissionService,
    PronunciationUploadGuard,
    {
      provide: PRONUNCIATION_RUNTIME_CONFIG,
      useFactory: (): PronunciationRuntimeConfig =>
        resolvePronunciationRuntimeConfig(process.env),
    },
    {
      provide: PRONUNCIATION_AUDIO_STORAGE,
      inject: [PronunciationRuntimeAdapters],
      useFactory: (adapters: PronunciationRuntimeAdapters) => adapters.storage,
    },
    {
      provide: PRONUNCIATION_AUDIO_INSPECTOR,
      inject: [PronunciationRuntimeAdapters],
      useFactory: (adapters: PronunciationRuntimeAdapters) =>
        adapters.inspector,
    },
    {
      provide: PRONUNCIATION_ASSESSMENT_PROVIDER,
      inject: [PronunciationRuntimeAdapters],
      useFactory: (adapters: PronunciationRuntimeAdapters) => adapters.provider,
    },
    UnavailablePronunciationAudioUploadWorkflow,
    PronunciationAudioService,
    PrismaPronunciationAudioAccessRepository,
    {
      provide: PronunciationAudioAccessService,
      inject: [
        PrismaPronunciationAudioAccessRepository,
        PRONUNCIATION_AUDIO_STORAGE,
      ],
      useFactory: (
        repository: PrismaPronunciationAudioAccessRepository,
        storage: PronunciationAudioStorage,
      ) => new PronunciationAudioAccessService(repository, storage),
    },
    PrismaPronunciationDeletionRepository,
    {
      provide: PronunciationDeletionService,
      inject: [
        PrismaPronunciationDeletionRepository,
        PRONUNCIATION_AUDIO_STORAGE,
        PronunciationLearningDeletionService,
      ],
      useFactory: (
        repository: PrismaPronunciationDeletionRepository,
        storage: PronunciationAudioStorage,
        learning: PronunciationLearningDeletionService,
      ) => new PronunciationDeletionService(repository, storage, learning),
    },
    PrismaPronunciationCleanupRepository,
    {
      provide: PronunciationCleanupProcessor,
      inject: [
        PrismaPronunciationCleanupRepository,
        PRONUNCIATION_AUDIO_STORAGE,
      ],
      useFactory: (
        repository: PrismaPronunciationCleanupRepository,
        storage: PronunciationAudioStorage,
      ) => new PronunciationCleanupProcessor(repository, storage),
    },
    {
      provide: PronunciationAccountCleanupService,
      inject: [
        LearningDataDeletionService,
        PrismaService,
        PRONUNCIATION_AUDIO_STORAGE,
      ],
      useFactory: (
        learningDeletion: LearningDataDeletionService,
        prisma: PrismaService,
        storage: PronunciationAudioStorage,
      ) =>
        new PronunciationAccountCleanupService(
          learningDeletion,
          prisma,
          storage,
        ),
    },
    {
      provide: PRONUNCIATION_AUDIO_UPLOAD_WORKFLOW,
      useExisting: PronunciationAudioService,
    },
    {
      provide: PronunciationAssessmentService,
      inject: [
        PronunciationRepository,
        PronunciationTargetService,
        PronunciationSourceRightsService,
        PRONUNCIATION_RUNTIME_CONFIG,
        PronunciationLearningShadowService,
        PronunciationLearningService,
        PronunciationSubmitAdmissionService,
      ],
      useFactory: (
        repository: PronunciationRepository,
        targets: PronunciationTargetService,
        sourceRights: PronunciationSourceRightsService,
        config: PronunciationRuntimeConfig,
        shadow: PronunciationLearningShadowService,
        learning: PronunciationLearningService,
        admission: PronunciationSubmitAdmissionService,
      ) =>
        new PronunciationAssessmentService(
          repository,
          targets,
          sourceRights,
          config,
          randomUUID,
          admission,
          undefined,
          {
            project: async (input) => {
              const result = await shadow.project(input);
              return { ...result, changedItems: [...result.changedItems] };
            },
            save: async (input) => {
              const result = await learning.save(input);
              return { ...result, changedItems: [...result.changedItems] };
            },
          },
        ),
    },
    {
      provide: PronunciationRetryService,
      inject: [PronunciationRepository, PRONUNCIATION_RUNTIME_CONFIG],
      useFactory: (
        repository: PronunciationRepository,
        config: PronunciationRuntimeConfig,
      ) => new PronunciationRetryService(repository, config, randomUUID),
    },
    PrismaPronunciationCancellationRepository,
    RedisPronunciationCancellationSignalStore,
    {
      provide: PRONUNCIATION_CANCELLATION_REPOSITORY,
      useExisting: PrismaPronunciationCancellationRepository,
    },
    {
      provide: PRONUNCIATION_CANCELLATION_SIGNAL_STORE,
      useExisting: RedisPronunciationCancellationSignalStore,
    },
    {
      provide: PronunciationCancellationService,
      inject: [
        PRONUNCIATION_CANCELLATION_REPOSITORY,
        PRONUNCIATION_CANCELLATION_SIGNAL_STORE,
      ],
      useFactory: (
        repository: PrismaPronunciationCancellationRepository,
        signals: RedisPronunciationCancellationSignalStore,
      ) => new PronunciationCancellationService(repository, signals),
    },
    PrismaPronunciationTraceRepository,
    {
      provide: PRONUNCIATION_TRACE_REPOSITORY,
      useExisting: PrismaPronunciationTraceRepository,
    },
    {
      provide: PronunciationTraceService,
      inject: [PRONUNCIATION_TRACE_REPOSITORY],
      useFactory: (repository: PrismaPronunciationTraceRepository) =>
        new PronunciationTraceService(repository),
    },
    PrismaPronunciationTraceQueryRepository,
    {
      provide: PronunciationTraceQueryService,
      inject: [PrismaPronunciationTraceQueryRepository],
      useFactory: (repository: PrismaPronunciationTraceQueryRepository) =>
        new PronunciationTraceQueryService(repository),
    },
  ],
  exports: [
    PRONUNCIATION_RUNTIME_CONFIG,
    PronunciationRepository,
    PronunciationRuntimeAdapters,
    PronunciationAssessmentService,
    PronunciationRetryService,
    PronunciationCancellationService,
    PronunciationTraceService,
    PronunciationTraceQueryService,
    PronunciationAudioService,
    PronunciationAudioAccessService,
    PronunciationDeletionService,
    PronunciationCleanupProcessor,
  ],
})
export class PronunciationModule {}
