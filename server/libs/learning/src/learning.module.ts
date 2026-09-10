import { Module } from '@nestjs/common';
import { PrismaModule, PrismaService } from '@libs/shared';
import { OwnedResourceService } from './common/owned-resource.service';
import {
  LEARNER_PROFILE_REPOSITORY,
  LearnerProfileService,
  PrismaLearnerProfileRepository,
} from './learner-profile/learner-profile.service';
import {
  CourseMaterialProvider,
  PrismaCourseMaterialRepository,
} from './materials/course-material.provider';
import { GrammarMaterialProvider } from './materials/grammar-material.provider';
import {
  LEARNING_MATERIAL_PROVIDERS,
  LearningMaterialService,
} from './materials/learning-material.service';
import {
  PrismaWordBookMaterialRepository,
  WordBookMaterialProvider,
} from './materials/word-book-material.provider';
import {
  PrismaReviewScheduleRepository,
  ReviewScheduleService,
} from './review/review-schedule.service';
import {
  ExerciseService,
  PrismaExerciseRepository,
} from './exercises/exercise.service';
import { ExerciseTargetingService } from './exercises/exercise-targeting.service';
import {
  GradingService,
  OwnedGradingService,
  PrismaGradingRepository,
} from './grading/grading.service';
import {
  AttemptService,
  PrismaAttemptRepository,
} from './attempts/attempt.service';
import { LegacyReviewInitializerService } from './review/legacy-review-initializer.service';
import {
  LearningDataDeletionService,
  PrismaLearningDataDeletionRepository,
} from './privacy/learning-data-deletion.service';
import {
  PrismaKnowledgeSourceRightsRepository,
  SourceRightsService,
} from './knowledge/ingestion/source-rights.service';
import {
  KnowledgeOutboxRepository,
  PrismaKnowledgeOutboxPersistence,
} from './knowledge/ingestion/knowledge-outbox.repository';
import { PrismaKnowledgeVectorRepository } from './knowledge/retrieval/vector.repository';
import { PrismaCitationRepository } from './knowledge/citations/citation.repository';
import { CitationProjectionService } from './knowledge/citations/citation-projection.service';
import {
  PrismaPronunciationTargetRepository,
  PronunciationTargetService,
} from './pronunciation/pronunciation-target.service';
import {
  PRONUNCIATION_SOURCE_RIGHTS_REPOSITORY,
  PronunciationSourceRightsService,
  UnavailablePronunciationSourceRightsRepository,
} from './pronunciation/pronunciation-source-rights.service';
import {
  NoopPronunciationLearningTraceSink,
  PrismaPronunciationLearningStateReader,
  PronunciationLearningShadowService,
} from './pronunciation/pronunciation-learning-shadow.service';
import {
  PrismaPronunciationLearningRepository,
  PronunciationLearningService,
} from './pronunciation/pronunciation-learning.service';
import {
  PrismaPronunciationContextRepository,
  PronunciationContextService,
} from './pronunciation/pronunciation-context.service';
import {
  PrismaPronunciationLearningDeletionRepository,
  PronunciationLearningDeletionService,
} from './pronunciation/pronunciation-deletion.service';
import { PrismaPronunciationSummaryInvalidation } from './knowledge/summaries/private-learning-summary.service';

@Module({
  imports: [PrismaModule],
  providers: [
    OwnedResourceService,
    PrismaLearnerProfileRepository,
    {
      provide: LEARNER_PROFILE_REPOSITORY,
      useExisting: PrismaLearnerProfileRepository,
    },
    {
      provide: LearnerProfileService,
      inject: [LEARNER_PROFILE_REPOSITORY],
      useFactory: (repository: PrismaLearnerProfileRepository) =>
        new LearnerProfileService(repository),
    },
    PrismaWordBookMaterialRepository,
    PrismaCourseMaterialRepository,
    {
      provide: WordBookMaterialProvider,
      inject: [PrismaWordBookMaterialRepository],
      useFactory: (repository: PrismaWordBookMaterialRepository) =>
        new WordBookMaterialProvider(repository),
    },
    {
      provide: CourseMaterialProvider,
      inject: [PrismaCourseMaterialRepository],
      useFactory: (repository: PrismaCourseMaterialRepository) =>
        new CourseMaterialProvider(repository),
    },
    GrammarMaterialProvider,
    {
      provide: LEARNING_MATERIAL_PROVIDERS,
      inject: [
        WordBookMaterialProvider,
        CourseMaterialProvider,
        GrammarMaterialProvider,
      ],
      useFactory: (
        words: WordBookMaterialProvider,
        courses: CourseMaterialProvider,
        grammar: GrammarMaterialProvider,
      ) => [words, courses, grammar],
    },
    LearningMaterialService,
    PrismaReviewScheduleRepository,
    {
      provide: ReviewScheduleService,
      inject: [PrismaReviewScheduleRepository],
      useFactory: (repository: PrismaReviewScheduleRepository) =>
        new ReviewScheduleService(repository),
    },
    PrismaExerciseRepository,
    {
      provide: ExerciseService,
      inject: [PrismaExerciseRepository],
      useFactory: (repository: PrismaExerciseRepository) =>
        new ExerciseService(repository),
    },
    ExerciseTargetingService,
    {
      provide: GradingService,
      useFactory: () => new GradingService(),
    },
    PrismaGradingRepository,
    {
      provide: OwnedGradingService,
      inject: [PrismaGradingRepository, GradingService],
      useFactory: (
        repository: PrismaGradingRepository,
        grading: GradingService,
      ) => new OwnedGradingService(repository, grading),
    },
    PrismaAttemptRepository,
    {
      provide: AttemptService,
      inject: [PrismaAttemptRepository],
      useFactory: (repository: PrismaAttemptRepository) =>
        new AttemptService(repository),
    },
    {
      provide: LegacyReviewInitializerService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new LegacyReviewInitializerService(prisma),
    },
    PrismaLearningDataDeletionRepository,
    {
      provide: LearningDataDeletionService,
      inject: [PrismaLearningDataDeletionRepository],
      useFactory: (repository: PrismaLearningDataDeletionRepository) =>
        new LearningDataDeletionService(repository),
    },
    {
      provide: SourceRightsService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new SourceRightsService(
          new PrismaKnowledgeSourceRightsRepository(prisma),
        ),
    },
    {
      provide: KnowledgeOutboxRepository,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new KnowledgeOutboxRepository(
          new PrismaKnowledgeOutboxPersistence(prisma),
        ),
    },
    {
      provide: PrismaKnowledgeVectorRepository,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PrismaKnowledgeVectorRepository(prisma),
    },
    {
      provide: PrismaCitationRepository,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PrismaCitationRepository(prisma),
    },
    {
      provide: CitationProjectionService,
      inject: [PrismaCitationRepository],
      useFactory: (repository: PrismaCitationRepository) =>
        new CitationProjectionService(repository),
    },
    PrismaPronunciationTargetRepository,
    {
      provide: PronunciationTargetService,
      inject: [PrismaPronunciationTargetRepository],
      useFactory: (repository: PrismaPronunciationTargetRepository) =>
        new PronunciationTargetService(repository),
    },
    UnavailablePronunciationSourceRightsRepository,
    {
      provide: PRONUNCIATION_SOURCE_RIGHTS_REPOSITORY,
      useExisting: UnavailablePronunciationSourceRightsRepository,
    },
    {
      provide: PronunciationSourceRightsService,
      inject: [PRONUNCIATION_SOURCE_RIGHTS_REPOSITORY],
      useFactory: (repository: UnavailablePronunciationSourceRightsRepository) =>
        new PronunciationSourceRightsService(repository, false),
    },
    PrismaPronunciationLearningStateReader,
    NoopPronunciationLearningTraceSink,
    {
      provide: PronunciationLearningShadowService,
      inject: [
        PrismaPronunciationLearningStateReader,
        NoopPronunciationLearningTraceSink,
      ],
      useFactory: (
        states: PrismaPronunciationLearningStateReader,
        trace: NoopPronunciationLearningTraceSink,
      ) => new PronunciationLearningShadowService(states, trace),
    },
    PrismaPronunciationLearningRepository,
    {
      provide: PronunciationLearningService,
      inject: [PrismaPronunciationLearningRepository],
      useFactory: (repository: PrismaPronunciationLearningRepository) =>
        new PronunciationLearningService(repository),
    },
    PrismaPronunciationContextRepository,
    {
      provide: PronunciationContextService,
      inject: [
        PrismaPronunciationContextRepository,
        PronunciationSourceRightsService,
      ],
      useFactory: (
        repository: PrismaPronunciationContextRepository,
        sourceRights: PronunciationSourceRightsService,
      ) => new PronunciationContextService(repository, sourceRights),
    },
    PrismaPronunciationLearningDeletionRepository,
    PrismaPronunciationSummaryInvalidation,
    {
      provide: PronunciationLearningDeletionService,
      inject: [
        PrismaPronunciationLearningDeletionRepository,
        PrismaPronunciationSummaryInvalidation,
      ],
      useFactory: (
        repository: PrismaPronunciationLearningDeletionRepository,
        invalidation: PrismaPronunciationSummaryInvalidation,
      ) => new PronunciationLearningDeletionService(repository, invalidation),
    },
  ],
  exports: [
    OwnedResourceService,
    LearnerProfileService,
    LearningMaterialService,
    ReviewScheduleService,
    ExerciseService,
    ExerciseTargetingService,
    GradingService,
    OwnedGradingService,
    AttemptService,
    LegacyReviewInitializerService,
    LearningDataDeletionService,
    SourceRightsService,
    KnowledgeOutboxRepository,
    PrismaKnowledgeVectorRepository,
    PrismaCitationRepository,
    CitationProjectionService,
    PronunciationTargetService,
    PronunciationSourceRightsService,
    PronunciationLearningShadowService,
    PronunciationLearningService,
    PronunciationContextService,
    PronunciationLearningDeletionService,
  ],
})
export class LearningModule {}
