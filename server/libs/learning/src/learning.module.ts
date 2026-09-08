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
  ],
})
export class LearningModule {}
