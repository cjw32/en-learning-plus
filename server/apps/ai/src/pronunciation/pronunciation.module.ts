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
import {
  PRONUNCIATION_AUDIO_INSPECTOR,
  UnavailablePronunciationAudioInspector,
} from './audio/pronunciation-audio-inspector';
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
import {
  PRONUNCIATION_ASSESSMENT_PROVIDER,
  UnavailablePronunciationAssessmentProvider,
} from './provider/pronunciation-assessment.provider';
import {
  PRONUNCIATION_AUDIO_STORAGE,
  UnavailablePronunciationAudioStorage,
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
  imports: [SharedModule, LearningModule, PronunciationRedisModule],
  controllers: [PronunciationController, PronunciationAudioController],
  providers: [
    AuthGuard,
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
      useClass: UnavailablePronunciationAudioStorage,
    },
    {
      provide: PRONUNCIATION_AUDIO_INSPECTOR,
      useClass: UnavailablePronunciationAudioInspector,
    },
    {
      provide: PRONUNCIATION_ASSESSMENT_PROVIDER,
      useClass: UnavailablePronunciationAssessmentProvider,
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
        storage: UnavailablePronunciationAudioStorage,
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
        storage: UnavailablePronunciationAudioStorage,
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
        storage: UnavailablePronunciationAudioStorage,
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
        storage: UnavailablePronunciationAudioStorage,
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
      ],
      useFactory: (
        repository: PronunciationRepository,
        targets: PronunciationTargetService,
        sourceRights: PronunciationSourceRightsService,
        config: PronunciationRuntimeConfig,
        shadow: PronunciationLearningShadowService,
        learning: PronunciationLearningService,
      ) =>
        new PronunciationAssessmentService(
          repository,
          targets,
          sourceRights,
          config,
          randomUUID,
          undefined,
          undefined,
          {
            project: (input) => shadow.project(input),
            save: (input) => learning.save(input),
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
