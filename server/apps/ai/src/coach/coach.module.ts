import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { nanoid } from 'nanoid';
import {
  AttemptService,
  ExerciseService,
  ExerciseTargetingService,
  LearnerProfileService,
  LearningDataDeletionService,
  LearningMaterialService,
  OwnedGradingService,
  ReviewScheduleService,
  LearningModule,
  CitationProjectionService,
  RAG_LEARNING_MATERIAL_SEARCH,
  type RagLearningMaterialSearchPort,
} from '@libs/learning';
import { AuthGuard, SharedModule } from '@libs/shared';
import { CoachApiService } from './api/coach-api.service';
import { CoachController } from './api/coach.controller';
import { CoachRequestRepository } from './api/coach-request.repository';
import { CoachRequestService } from './api/coach-request.service';
import {
  COACH_REQUEST_EXECUTOR,
  CoachProcessor,
} from './queue/coach.processor';
import { COACH_QUEUE_NAME, CoachQueueService } from './queue/coach.queue';
import { CoachRedisModule } from './streaming/coach-redis.module';
import {
  COACH_EVENT_STORE,
  CoachEventStreamService,
  RedisCoachEventStore,
} from './streaming/coach-event-stream.service';
import {
  COACH_SSE_ACCESS_REPOSITORY,
  CoachSseSessionService,
  type CoachSseAccessRepository,
} from './streaming/coach-sse-session.service';
import { CoachSseController } from './streaming/coach-sse.controller';
import {
  coachResultSchema,
  publicCoachResultV2Schema,
  storedCoachResultV2Schema,
} from '@en/common/coach';
import {
  COACH_CANCELLATION_REPOSITORY,
  COACH_CANCELLATION_SIGNAL_STORE,
  CoachCancellationService,
  PrismaCoachCancellationRepository,
  RedisCoachCancellationSignalStore,
} from './governance/coach-cancellation.service';
import { CoachRetryService } from './governance/coach-retry.service';
import {
  CoachFeedbackService,
  PrismaCoachFeedbackRepository,
} from './observability/coach-feedback.service';
import {
  CheckpointPurgeService,
  LazyPostgresCheckpointStore,
} from './observability/checkpoint-purge.service';
import {
  CoachRetentionService,
  PrismaCoachRetentionRepository,
  RedisCoachEphemeralDataStore,
} from './observability/coach-retention.service';
import { CoachRetentionProcessor } from './observability/coach-retention.processor';
import {
  CoachTraceQueryService,
  PrismaCoachTraceRepository,
} from './observability/coach-trace-query.service';
import { GetLearnerProfileTool } from './tools/get-learner-profile.tool';
import { GetDueWordsTool } from './tools/get-due-words.tool';
import { SearchLearningMaterialsTool } from './tools/search-learning-materials.tool';
import { CreateExerciseTool } from './tools/create-exercise.tool';
import { GradeAnswerTool } from './tools/grade-answer.tool';
import { SaveAttemptTool } from './tools/save-attempt.tool';
import { CoachModelGateway } from './workflow/coach-model.gateway';
import { ConfiguredCoachStructuredModel } from './workflow/coach-structured-model.provider';
import {
  CoachModelExerciseGenerator,
  EnvironmentCoachExerciseBudgetGate,
} from './workflow/coach-exercise-generator';
import { EnvironmentCoachRuntimeBudgetFactory } from './governance/coach-runtime-budget.factory';
import { CoachRuntimeWorkflowService } from './workflow/coach-runtime.workflow';
import {
  CoachWorkflowExecutor,
  EnvironmentCoachTraceFactory,
} from './workflow/coach-workflow.executor';
import {
  CoachAdmissionService,
  RedisCoachGovernanceStore,
} from './governance/coach-admission.service';
import { CoachEnabledGuard } from './governance/coach-enabled.guard';
import { resolveRagRuntimeConfig } from './governance/coach-config.schema';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
  imports: [
    SharedModule,
    LearningModule,
    KnowledgeModule,
    CoachRedisModule,
    BullModule.registerQueue({ name: COACH_QUEUE_NAME }),
  ],
  controllers: [CoachController, CoachSseController],
  providers: [
    AuthGuard,
    CoachEnabledGuard,
    CoachRequestRepository,
    RedisCoachEventStore,
    { provide: COACH_EVENT_STORE, useExisting: RedisCoachEventStore },
    CoachEventStreamService,
    {
      provide: COACH_SSE_ACCESS_REPOSITORY,
      inject: [CoachRequestRepository, CitationProjectionService],
      useFactory: (
        repository: CoachRequestRepository,
        citationProjection: CitationProjectionService,
      ): CoachSseAccessRepository => ({
        async findOwned(subjectId, requestId) {
          const request = await repository.findOwnedRequest(
            subjectId,
            requestId,
          );
          if (!request) return null;
          const v1 = coachResultSchema.safeParse(request.finalResult);
          const storedV2 = storedCoachResultV2Schema.safeParse(
            request.finalResult,
          );
          const publicV2 = publicCoachResultV2Schema.safeParse(
            request.finalResult,
          );
          const result = v1.success
            ? v1.data
            : storedV2.success
              ? await citationProjection.projectResult(subjectId, storedV2.data)
              : publicV2.success
                ? await citationProjection.projectResult(
                    subjectId,
                    publicV2.data,
                  )
                : null;
          return {
            id: request.id,
            status: request.status,
            finalResult: result,
          };
        },
      }),
    },
    CoachSseSessionService,
    PrismaCoachCancellationRepository,
    RedisCoachCancellationSignalStore,
    {
      provide: COACH_CANCELLATION_REPOSITORY,
      useExisting: PrismaCoachCancellationRepository,
    },
    {
      provide: COACH_CANCELLATION_SIGNAL_STORE,
      useExisting: RedisCoachCancellationSignalStore,
    },
    CoachCancellationService,
    RedisCoachGovernanceStore,
    {
      provide: CoachAdmissionService,
      inject: [RedisCoachGovernanceStore],
      useFactory: (store: RedisCoachGovernanceStore) =>
        new CoachAdmissionService(store, store),
    },
    CoachRetryService,
    PrismaCoachFeedbackRepository,
    {
      provide: CoachFeedbackService,
      inject: [PrismaCoachFeedbackRepository],
      useFactory: (repository: PrismaCoachFeedbackRepository) =>
        new CoachFeedbackService(repository),
    },
    PrismaCoachTraceRepository,
    {
      provide: CoachTraceQueryService,
      inject: [PrismaCoachTraceRepository],
      useFactory: (repository: PrismaCoachTraceRepository) =>
        new CoachTraceQueryService(repository),
    },
    LazyPostgresCheckpointStore,
    {
      provide: CheckpointPurgeService,
      inject: [LazyPostgresCheckpointStore],
      useFactory: (store: LazyPostgresCheckpointStore) =>
        new CheckpointPurgeService(store),
    },
    PrismaCoachRetentionRepository,
    RedisCoachEphemeralDataStore,
    {
      provide: CoachRetentionService,
      inject: [
        PrismaCoachRetentionRepository,
        RedisCoachEphemeralDataStore,
        CheckpointPurgeService,
        LearningDataDeletionService,
        CoachRetentionProcessor,
      ],
      useFactory: (
        repository: PrismaCoachRetentionRepository,
        ephemeral: RedisCoachEphemeralDataStore,
        checkpoints: CheckpointPurgeService,
        learningDeletion: LearningDataDeletionService,
        deletionProcessor: CoachRetentionProcessor,
      ) =>
        new CoachRetentionService(
          repository,
          ephemeral,
          checkpoints,
          learningDeletion,
          undefined,
          deletionProcessor,
        ),
    },
    {
      provide: CoachRetentionProcessor,
      inject: [
        PrismaCoachRetentionRepository,
        CheckpointPurgeService,
        LearningDataDeletionService,
      ],
      useFactory: (
        repository: PrismaCoachRetentionRepository,
        checkpoints: CheckpointPurgeService,
        learningDeletion: LearningDataDeletionService,
      ) =>
        new CoachRetentionProcessor(repository, checkpoints, learningDeletion),
    },
    {
      provide: CoachRequestService,
      inject: [CoachRequestRepository],
      useFactory: (repository: CoachRequestRepository) =>
        new CoachRequestService(repository, () => nanoid(21)),
    },
    GetLearnerProfileTool,
    {
      provide: GetDueWordsTool,
      inject: [ReviewScheduleService],
      useFactory: (schedules: ReviewScheduleService) =>
        new GetDueWordsTool(schedules),
    },
    {
      provide: SearchLearningMaterialsTool,
      inject: [LearningMaterialService, RAG_LEARNING_MATERIAL_SEARCH],
      useFactory: (
        materials: LearningMaterialService,
        ragSearch: RagLearningMaterialSearchPort,
      ) => {
        const rag = resolveRagRuntimeConfig(process.env);
        return new SearchLearningMaterialsTool(
          materials,
          rag.enabled || rag.shadowEnabled,
          ragSearch,
        );
      },
    },
    SaveAttemptTool,
    ConfiguredCoachStructuredModel,
    {
      provide: CoachModelGateway,
      inject: [ConfiguredCoachStructuredModel],
      useFactory: (model: ConfiguredCoachStructuredModel) =>
        new CoachModelGateway(model),
    },
    {
      provide: GradeAnswerTool,
      inject: [OwnedGradingService, CoachModelGateway],
      useFactory: (grading: OwnedGradingService, model: CoachModelGateway) =>
        new GradeAnswerTool(grading, model),
    },
    {
      provide: CoachModelExerciseGenerator,
      inject: [ConfiguredCoachStructuredModel],
      useFactory: (model: ConfiguredCoachStructuredModel) =>
        new CoachModelExerciseGenerator(model),
    },
    EnvironmentCoachExerciseBudgetGate,
    {
      provide: CreateExerciseTool,
      inject: [
        ExerciseService,
        CoachModelExerciseGenerator,
        EnvironmentCoachExerciseBudgetGate,
      ],
      useFactory: (
        exercises: ExerciseService,
        generator: CoachModelExerciseGenerator,
        budget: EnvironmentCoachExerciseBudgetGate,
      ) => new CreateExerciseTool(exercises, generator, budget),
    },
    {
      provide: EnvironmentCoachRuntimeBudgetFactory,
      useFactory: () => new EnvironmentCoachRuntimeBudgetFactory(),
    },
    {
      provide: CoachRuntimeWorkflowService,
      inject: [
        CoachEventStreamService,
        CoachCancellationService,
        EnvironmentCoachRuntimeBudgetFactory,
        CoachModelGateway,
        GetLearnerProfileTool,
        GetDueWordsTool,
        SearchLearningMaterialsTool,
        ExerciseTargetingService,
        CreateExerciseTool,
        GradeAnswerTool,
        SaveAttemptTool,
      ],
      useFactory: (
        stream: CoachEventStreamService,
        cancellation: CoachCancellationService,
        budgets: EnvironmentCoachRuntimeBudgetFactory,
        model: CoachModelGateway,
        profiles: GetLearnerProfileTool,
        dueWords: GetDueWordsTool,
        materials: SearchLearningMaterialsTool,
        targeting: ExerciseTargetingService,
        exercises: CreateExerciseTool,
        grading: GradeAnswerTool,
        attempts: SaveAttemptTool,
      ) =>
        new CoachRuntimeWorkflowService(
          stream,
          cancellation,
          budgets,
          model,
          profiles,
          dueWords,
          materials,
          targeting,
          exercises,
          grading,
          attempts,
        ),
    },
    {
      provide: EnvironmentCoachTraceFactory,
      useFactory: () => new EnvironmentCoachTraceFactory(),
    },
    {
      provide: CoachWorkflowExecutor,
      inject: [
        CoachRequestRepository,
        CoachEventStreamService,
        CoachRuntimeWorkflowService,
        PrismaCoachTraceRepository,
        EnvironmentCoachTraceFactory,
        CoachAdmissionService,
      ],
      useFactory: (
        repository: CoachRequestRepository,
        stream: CoachEventStreamService,
        runtime: CoachRuntimeWorkflowService,
        traces: PrismaCoachTraceRepository,
        traceFactory: EnvironmentCoachTraceFactory,
        admission: CoachAdmissionService,
      ) =>
        new CoachWorkflowExecutor(
          repository,
          stream,
          runtime,
          traces,
          traceFactory,
          undefined,
          admission,
        ),
    },
    { provide: COACH_REQUEST_EXECUTOR, useExisting: CoachWorkflowExecutor },
    CoachQueueService,
    CoachProcessor,
    CoachApiService,
  ],
  exports: [CoachRequestRepository, CoachRequestService, CoachQueueService],
})
export class CoachModule {}
