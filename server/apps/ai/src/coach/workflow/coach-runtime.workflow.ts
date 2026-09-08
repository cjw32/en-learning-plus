import { Injectable } from '@nestjs/common';
import {
  COACH_RESULT_SCHEMA_VERSION,
  COACH_TOOL_SCHEMA_VERSION,
  coachResultSchema,
  type GetDueWordsOutput,
  type GetLearnerProfileOutput,
  type SearchLearningMaterialsOutput,
} from '@en/common/coach';
import { ExerciseTargetingService } from '@libs/learning';
import { resolveCoachRuntimeConfig } from '../governance/coach-config.schema';
import { EnvironmentCoachRuntimeBudgetFactory } from '../governance/coach-runtime-budget.factory';
import type { CoachBudgetService } from '../governance/coach-budget.service';
import { CoachCancellationService } from '../governance/coach-cancellation.service';
import { CoachEventStreamService } from '../streaming/coach-event-stream.service';
import { CreateExerciseTool } from '../tools/create-exercise.tool';
import { GetDueWordsTool } from '../tools/get-due-words.tool';
import { GetLearnerProfileTool } from '../tools/get-learner-profile.tool';
import { GradeAnswerTool } from '../tools/grade-answer.tool';
import { SaveAttemptTool } from '../tools/save-attempt.tool';
import { SearchLearningMaterialsTool } from '../tools/search-learning-materials.tool';
import type { CoachTraceService } from '../observability/coach-trace.service';
import {
  CoachAnswerWorkflow,
  CoachControlledStepRunner,
  CoachExerciseWorkflow,
  CoachGradingWorkflow,
  runControlledCoachRuntimeGraph,
} from './coach.graph';
import { CoachModelGateway } from './coach-model.gateway';
import type {
  CoachRuntimeIntent,
  CoachRuntimeWorkflow,
} from './coach-workflow.executor';
import {
  COACH_WORKFLOW_PROMPT_HASH,
  COACH_WORKFLOW_PROMPT_VERSION,
} from '../prompts/coach-prompt.manifest';
import {
  decideNextAction,
  deterministicNextActionReason,
  type NextActionDecision,
  type ProfileSignalState,
} from './next-action.policy';
import { buildSafeDegradedResult } from './final-result.validator';
import type { CoachPromptMaterial } from '../prompts/answer.prompt';

type RuntimeInput = Parameters<CoachRuntimeWorkflow['run']>[0];
type ProfileSuccess = Extract<GetLearnerProfileOutput, { ok: true }>;
type DueSuccess = Extract<GetDueWordsOutput, { ok: true }>;
type MaterialSuccess = Extract<SearchLearningMaterialsOutput, { ok: true }>;

function toolError(output: { ok: boolean; code?: string; message?: string }) {
  return Object.assign(new Error(output.message ?? 'Coach tool failed'), {
    code: output.code ?? 'INTERNAL_ERROR',
  });
}

function localDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

@Injectable()
export class CoachRuntimeWorkflowService implements CoachRuntimeWorkflow {
  constructor(
    private readonly stream: CoachEventStreamService,
    private readonly cancellation: CoachCancellationService,
    private readonly budgets: EnvironmentCoachRuntimeBudgetFactory,
    private readonly model: CoachModelGateway,
    private readonly profiles: GetLearnerProfileTool,
    private readonly dueWords: GetDueWordsTool,
    private readonly materials: SearchLearningMaterialsTool,
    private readonly targeting: ExerciseTargetingService,
    private readonly exercises: CreateExerciseTool,
    private readonly grading: GradeAnswerTool,
    private readonly attempts: SaveAttemptTool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  metadata() {
    const config = resolveCoachRuntimeConfig(process.env);
    return {
      promptVersion: COACH_WORKFLOW_PROMPT_VERSION,
      promptHash: COACH_WORKFLOW_PROMPT_HASH,
      modelProvider: config.liveModelEnabled ? 'deepseek' : 'disabled',
      modelName: config.modelName ?? 'disabled',
      modelVersion: config.modelVersion ?? 'disabled',
      budgetVersion: this.budgets.policyVersion() || 'disabled',
    };
  }

  async run(input: RuntimeInput) {
    const budget = this.budgets.create(
      Math.max(0, input.request.deadlineAt.getTime() - this.now().getTime()),
    );
    const runner = new CoachControlledStepRunner(
      this.stream,
      this.cancellation,
    );
    return runControlledCoachRuntimeGraph({
      inputType: input.request.inputType,
      branches: {
        message: () => this.runMessage(input, runner, budget),
        submission: () => this.runSubmission(input, runner, budget),
        recommendation: () => this.runRecommendation(input, runner, budget),
      },
    });
  }

  private async runMessage(
    input: RuntimeInput,
    runner: CoachControlledStepRunner,
    budget: CoachBudgetService,
  ) {
    if (input.request.inputPayload.type !== 'MESSAGE') {
      return this.degraded('UNKNOWN', input);
    }
    const message = input.request.inputPayload.message;
    const intent = await this.modelStep(
      input,
      budget,
      'classify_intent',
      'understanding',
      (signal, telemetry) =>
        this.model.classifyIntent(message, signal, telemetry),
      runner,
    );
    if (intent === 'CREATE_EXERCISE') {
      const result = await this.exerciseWorkflow(
        input,
        runner,
        budget,
        intent,
        message,
      );
      return { intent, result };
    }
    if (intent !== 'ANSWER' && intent !== 'CORRECTION') {
      return this.degraded('UNKNOWN', input);
    }
    const result = await this.answerWorkflow(
      input,
      runner,
      budget,
      intent,
      message,
    );
    return { intent, result };
  }

  private async answerWorkflow(
    input: RuntimeInput,
    runner: CoachControlledStepRunner,
    budget: CoachBudgetService,
    intent: 'ANSWER' | 'CORRECTION',
    message: string,
  ) {
    let profile: ProfileSuccess | null = null;
    let generationAttempt = 0;
    return new CoachAnswerWorkflow({
      classifyIntent: () => Promise.resolve(intent),
      getLearnerProfile: async () => {
        profile = await this.loadProfile(input, runner, budget);
        return profile;
      },
      searchLearningMaterials: async () =>
        this.searchMaterials(input, runner, budget, message, profile),
      generateAnswer: async ({ materials }) => {
        generationAttempt += 1;
        if (generationAttempt > 1) input.trace.recordRetry();
        try {
          return await this.modelStep(
            input,
            budget,
            'generate_answer',
            'generating',
            (signal, telemetry) =>
              intent === 'CORRECTION'
                ? this.model.generateCorrection(
                    {
                      message,
                      profile: profile!,
                      materials: materials.materials as CoachPromptMaterial[],
                    },
                    signal,
                    telemetry,
                  )
                : this.model.generateAnswer(
                    {
                      message,
                      profile: profile!,
                      materials: materials.materials as CoachPromptMaterial[],
                    },
                    signal,
                    telemetry,
                  ),
            runner,
          );
        } catch (error) {
          input.trace.recordSchemaFailure();
          throw error;
        }
      },
      recommend: () => {
        const decision = decideNextAction({
          validCurrentQualities: [],
          dueCount: 0,
          profileSignals: profile?.signals ?? [],
        });
        this.recordRecommendation(input.trace, decision, 'not_saved');
        return Promise.resolve({
          nextAction: decision.nextAction,
          nextActionReason: deterministicNextActionReason(decision),
        });
      },
      gradeAnswer: () => Promise.resolve(undefined),
      saveAttempt: () => Promise.resolve(undefined),
    }).run(
      {
        requestId: input.request.id,
        conversationId: input.request.conversationId,
        message,
        traceId: `trace_${input.request.id}`,
      },
      input.context,
    );
  }

  private async exerciseWorkflow(
    input: RuntimeInput,
    runner: CoachControlledStepRunner,
    budget: CoachBudgetService,
    intent: 'CREATE_EXERCISE',
    message: string,
  ) {
    let profile: ProfileSuccess | null = null;
    let due: DueSuccess | null = null;
    let selected: ReturnType<ExerciseTargetingService['select']> | null = null;
    let materialResult: MaterialSuccess | null = null;
    const preferences =
      input.request.inputPayload.type === 'MESSAGE'
        ? (input.request.inputPayload.exercisePreferences ?? {})
        : {};
    return new CoachExerciseWorkflow({
      classifyIntent: () => Promise.resolve(intent),
      authorizeTool: (tool) => this.assertToolBudget(input, budget, tool),
      getLearnerProfile: async () => {
        profile = await this.loadProfile(input, runner, budget);
        return profile;
      },
      getDueWords: async () => {
        due = await this.loadDueWords(input, runner, budget, profile);
        return due;
      },
      searchLearningMaterials: async () => {
        materialResult = await this.searchMaterialsRaw(
          input,
          runner,
          budget,
          preferences.topic ?? message,
          profile,
        );
        return { ok: true as const, materials: materialResult.materials };
      },
      createExercise: async ({ materials }) => {
        due ??= { words: [] } as unknown as DueSuccess;
        selected = this.targeting.select({
          profile: {
            level: profile!.level,
            weakItems: profile!.weakItems.map((item) => ({
              ...item,
              dueAt: item.dueAt ? new Date(item.dueAt) : null,
            })),
            recentPerformance: profile!.recentPerformance,
          },
          dueWords: due.words,
          limit: Math.min(preferences.count ?? 5, 20),
        });
        if (selected.targets.length === 0) {
          throw Object.assign(new Error('No eligible learning targets'), {
            code: 'DATA_NOT_AVAILABLE',
          });
        }
        return this.toolStep(
          input,
          budget,
          'create_exercise',
          'generating',
          runner,
          (signal) =>
            this.exercises.execute(
              input.context,
              {
                requestId: input.request.id,
                conversationId: input.request.conversationId,
                targets: selected!.targets,
                materials: materials as MaterialSuccess['materials'],
                personalizationReason: selected!.personalizationReason,
                signal,
                beforeModelCall: () => {
                  const projection = this.budgets.projectModelUsage(this.now());
                  budget.assertCanStartNode({
                    ...projection,
                    elapsedMs: this.elapsedMs(input),
                  });
                },
                modelTelemetry: {
                  onFirstOutput: () =>
                    input.trace.recordFirstToken(this.now().getTime()),
                  onUsage: (usage) => {
                    const actual = this.budgets.measureModelUsage({
                      ...usage,
                      at: this.now(),
                    });
                    budget.record(actual);
                    input.trace.recordModelStart(actual.inputTokens);
                    input.trace.recordModelEnd(
                      actual.outputTokens,
                      actual.costMicros,
                    );
                  },
                },
                onSchemaFailure: () => input.trace.recordSchemaFailure(),
                onRetry: () => input.trace.recordRetry(),
              },
              {
                schemaVersion: COACH_TOOL_SCHEMA_VERSION,
                types: preferences.types ?? ['FILL_BLANK'],
                count: preferences.count ?? 5,
                difficulty: selected!.difficulty,
                targetRefs: selected!.targets.map((target) => ({
                  targetType: target.targetType,
                  targetKey: target.targetKey,
                })),
                materialSourceIds: materialResult!.materials.map(
                  (material) => material.citation.sourceId,
                ),
                ...(preferences.topic ? { scenario: preferences.topic } : {}),
                idempotencyKey: input.request.clientRequestKey,
              },
            ),
        );
      },
      recommend: () =>
        Promise.resolve({
          nextAction: 'practice' as const,
          nextActionReason:
            selected?.personalizationReason ?? '请完成本次个性化练习。',
        }),
      gradeAnswer: () => Promise.resolve(undefined),
      saveAttempt: () => Promise.resolve(undefined),
    }).run(
      {
        requestId: input.request.id,
        conversationId: input.request.conversationId,
        message,
        traceId: `trace_${input.request.id}`,
        preferences,
        includeDueWords: true,
      },
      input.context,
    );
  }

  private async runSubmission(
    input: RuntimeInput,
    runner: CoachControlledStepRunner,
    budget: CoachBudgetService,
  ) {
    if (input.request.inputPayload.type !== 'EXERCISE_SUBMISSION') {
      return this.degraded('GRADE_ANSWER', input) as {
        intent: 'GRADE_ANSWER';
        result: ReturnType<typeof buildSafeDegradedResult>;
      };
    }
    const payload = input.request.inputPayload;
    const runtimeConfig = resolveCoachRuntimeConfig(process.env);
    const result = await new CoachGradingWorkflow({
      classifyIntent: () => Promise.resolve('GRADE_ANSWER'),
      authorizeTool: (tool) => this.assertToolBudget(input, budget, tool),
      gradeAnswer: (gradeInput) =>
        this.toolStep(
          input,
          budget,
          'grade_answer',
          'grading',
          runner,
          (signal) =>
            this.grading.execute(
              input.context,
              {
                requestId: input.request.id,
                signal,
                beforeModelCall: () => {
                  const projection = this.budgets.projectModelUsage(this.now());
                  budget.assertCanStartNode({
                    ...projection,
                    elapsedMs: this.elapsedMs(input),
                  });
                },
                modelTelemetry: {
                  onFirstOutput: () =>
                    input.trace.recordFirstToken(this.now().getTime()),
                  onUsage: (usage) => {
                    const actual = this.budgets.measureModelUsage({
                      ...usage,
                      at: this.now(),
                    });
                    budget.record(actual);
                    input.trace.recordModelStart(actual.inputTokens);
                    input.trace.recordModelEnd(
                      actual.outputTokens,
                      actual.costMicros,
                    );
                  },
                },
                onSchemaFailure: () => input.trace.recordSchemaFailure(),
                onRetry: () => input.trace.recordRetry(),
              },
              {
                schemaVersion: COACH_TOOL_SCHEMA_VERSION,
                exerciseId: gradeInput.exerciseId,
                answers: gradeInput.answers,
                idempotencyKey: gradeInput.idempotencyKey,
              },
            ),
        ),
      saveAttempt: async (saveInput) => {
        if (!runtimeConfig.writeEnabled) {
          await this.stream.publishToolStatus(
            input.request.id,
            'save_attempt',
            'skipped',
            false,
          );
          return {
            schemaVersion: COACH_TOOL_SCHEMA_VERSION,
            ok: false as const,
            code: 'STATE_CONFLICT' as const,
            message: 'Coach 学习写入尚未启用',
            retryable: false,
          };
        }
        return this.toolStep(
          input,
          budget,
          'save_attempt',
          'saving',
          runner,
          () =>
            this.attempts.execute(
              input.context,
              {
                requestId: input.request.id,
                gradingValidated: true,
                submissionId: saveInput.submissionId,
                gradingHash: saveInput.gradingHash,
                cancelled: input.signal.aborted,
              },
              {
                schemaVersion: COACH_TOOL_SCHEMA_VERSION,
                submissionId: saveInput.submissionId,
                gradingHash: saveInput.gradingHash,
                idempotencyKey: saveInput.idempotencyKey,
              },
            ),
        );
      },
      recommend: ({ decision }) =>
        Promise.resolve({
          nextAction: decision.nextAction,
          nextActionReason: deterministicNextActionReason(decision),
        }),
      onRecommendation: ({ decision, learningSaveStatus }) =>
        this.recordRecommendation(input.trace, decision, learningSaveStatus),
    }).run(
      {
        requestId: input.request.id,
        conversationId: input.request.conversationId,
        exerciseId: payload.exerciseId,
        answers: payload.answers,
        idempotencyKey: input.request.clientRequestKey,
        traceId: `trace_${input.request.id}`,
      },
      input.context,
    );
    return { intent: 'GRADE_ANSWER' as const, result };
  }

  private async runRecommendation(
    input: RuntimeInput,
    runner: CoachControlledStepRunner,
    budget: CoachBudgetService,
  ) {
    const profile = await this.loadProfile(input, runner, budget);
    const due = await this.loadDueWords(input, runner, budget, profile);
    const decision = decideNextAction({
      validCurrentQualities: [],
      dueCount: due.totalDue,
      profileSignals: profile.signals,
    });
    this.recordRecommendation(input.trace, decision, 'not_saved');
    const result = coachResultSchema.parse({
      schemaVersion: COACH_RESULT_SCHEMA_VERSION,
      responseType: 'recommendation',
      correction: '',
      explanation: deterministicNextActionReason(decision),
      examples: [],
      errorTypes: [],
      score: null,
      nextAction: decision.nextAction,
      citations: due.words.slice(0, 20).map((word) => ({
        sourceId: word.citation.sourceId,
        materialType: word.citation.materialType,
        title: word.citation.title,
        locator: word.citation.locator,
        supports: word.citation.supports,
      })),
      nextActionReason: deterministicNextActionReason(decision),
      traceId: `trace_${input.request.id}`,
    });
    return { intent: 'REVIEW_RECOMMENDATION' as const, result };
  }

  private async loadProfile(
    input: RuntimeInput,
    runner: CoachControlledStepRunner,
    budget: CoachBudgetService,
  ) {
    const output = await this.toolStep(
      input,
      budget,
      'get_learner_profile',
      'personalizing',
      runner,
      () =>
        this.profiles.execute(input.context, {
          schemaVersion: COACH_TOOL_SCHEMA_VERSION,
          dimensions: [
            'LEVEL',
            'GOAL',
            'LEARNED_WORDS',
            'WEAK_ITEMS',
            'ERROR_TYPES',
            'RECENT_PERFORMANCE',
            'ACTIVE_COURSE',
          ],
          perDimensionLimit: 20,
        }),
    );
    if (!output.ok) throw toolError(output);
    return output;
  }

  private async loadDueWords(
    input: RuntimeInput,
    runner: CoachControlledStepRunner,
    budget: CoachBudgetService,
    profile: ProfileSuccess | null,
  ) {
    const timezone = profile?.timezone ?? 'Asia/Shanghai';
    const output = await this.toolStep(
      input,
      budget,
      'get_due_words',
      'personalizing',
      runner,
      () =>
        this.dueWords.execute(input.context, {
          schemaVersion: COACH_TOOL_SCHEMA_VERSION,
          learningDate: localDate(this.now(), timezone),
          timezone,
          limit: 50,
          ...(profile?.activeCourse?.id
            ? { courseId: profile.activeCourse.id }
            : {}),
        }),
    );
    if (!output.ok) throw toolError(output);
    return output;
  }

  private async searchMaterials(
    input: RuntimeInput,
    runner: CoachControlledStepRunner,
    budget: CoachBudgetService,
    query: string,
    profile: ProfileSuccess | null,
  ): Promise<Pick<MaterialSuccess, 'materials' | 'unavailableTypes'>> {
    const output = await this.searchMaterialsRaw(
      input,
      runner,
      budget,
      query,
      profile,
    );
    return {
      materials: output.materials,
      unavailableTypes: output.unavailableTypes,
    };
  }

  private async searchMaterialsRaw(
    input: RuntimeInput,
    runner: CoachControlledStepRunner,
    budget: CoachBudgetService,
    query: string,
    profile: ProfileSuccess | null,
  ) {
    const output = await this.toolStep(
      input,
      budget,
      'search_learning_materials',
      'finding_materials',
      runner,
      () =>
        this.materials.execute(input.context, {
          schemaVersion: COACH_TOOL_SCHEMA_VERSION,
          query,
          materialTypes: ['word', 'course', 'grammar'],
          cefrLevel: profile?.level?.cefr ?? null,
          ...(profile?.activeCourse?.id
            ? { courseId: profile.activeCourse.id }
            : {}),
          limit: 20,
        }),
    );
    if (!output.ok) throw toolError(output);
    return output;
  }

  private async modelStep<T>(
    input: RuntimeInput,
    budget: CoachBudgetService,
    name: 'classify_intent' | 'generate_answer',
    status: 'understanding' | 'generating',
    operation: (
      signal: AbortSignal,
      telemetry: {
        onFirstOutput(): void;
        onUsage(input: { inputTokens: number; outputTokens: number }): void;
      },
    ) => Promise<T>,
    runner: CoachControlledStepRunner,
  ) {
    const projection = this.budgets.projectModelUsage(this.now());
    budget.assertCanStartNode({
      ...projection,
      elapsedMs: this.elapsedMs(input),
    });
    return this.tracedStep(input, name, async () => {
      let measured = false;
      const telemetry = {
        onFirstOutput: () => input.trace.recordFirstToken(this.now().getTime()),
        onUsage: (usage: { inputTokens: number; outputTokens: number }) => {
          const actual = this.budgets.measureModelUsage({
            ...usage,
            at: this.now(),
          });
          budget.record(actual);
          input.trace.recordModelStart(actual.inputTokens);
          input.trace.recordModelEnd(actual.outputTokens, actual.costMicros);
          measured = true;
        },
      };
      const result = await runner.execute({
        requestId: input.request.id,
        status,
        timeoutMs: Math.max(
          1,
          input.request.deadlineAt.getTime() - this.now().getTime(),
        ),
        operation: (signal) => operation(signal, telemetry),
        onSuccess: () => undefined,
      });
      if (!measured) {
        throw Object.assign(new Error('Unmetered model response rejected'), {
          code: 'MODEL_UNAVAILABLE',
        });
      }
      return result;
    });
  }

  private async toolStep<T>(
    input: RuntimeInput,
    budget: CoachBudgetService,
    tool:
      | 'get_learner_profile'
      | 'get_due_words'
      | 'search_learning_materials'
      | 'create_exercise'
      | 'grade_answer'
      | 'save_attempt',
    status:
      | 'personalizing'
      | 'finding_materials'
      | 'generating'
      | 'grading'
      | 'saving',
    runner: CoachControlledStepRunner,
    operation: (signal: AbortSignal) => Promise<T>,
  ) {
    this.assertToolBudget(input, budget, tool);
    return this.tracedStep(input, tool, async () => {
      const result = await runner.execute({
        requestId: input.request.id,
        status,
        tool,
        timeoutMs: Math.max(
          1,
          input.request.deadlineAt.getTime() - this.now().getTime(),
        ),
        operation,
        onSuccess: () => undefined,
      });
      budget.record({
        inputTokens: 0,
        outputTokens: 0,
        modelCalls: 0,
        toolCalls: 1,
        costMicros: 0,
      });
      return result;
    });
  }

  private assertToolBudget(
    input: RuntimeInput,
    budget: CoachBudgetService,
    _tool: string,
  ) {
    budget.assertCanStartNode({
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 0,
      toolCalls: 1,
      costMicros: 0,
      elapsedMs: this.elapsedMs(input),
    });
  }

  private elapsedMs(input: RuntimeInput) {
    return Math.max(
      0,
      this.now().getTime() -
        (input.request.startedAt ?? input.request.createdAt).getTime(),
    );
  }

  private async tracedStep<T>(
    input: RuntimeInput,
    name: string,
    operation: () => Promise<T>,
  ) {
    const startedAt = this.now().getTime();
    input.trace.startStep(name, startedAt);
    try {
      const result = await operation();
      input.trace.finishStep(name, 'SUCCEEDED', this.now().getTime());
      return result;
    } catch (error) {
      const status = input.signal.aborted
        ? 'CANCELLED'
        : error &&
            typeof error === 'object' &&
            'code' in error &&
            (error.code === 'REQUEST_TIMEOUT' || error.code === 'TOOL_TIMEOUT')
          ? 'TIMED_OUT'
          : 'FAILED';
      input.trace.finishStep(name, status, this.now().getTime(), {
        errorCode:
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'INTERNAL_ERROR',
      });
      throw error;
    }
  }

  private recordRecommendation(
    trace: CoachTraceService,
    decision: NextActionDecision,
    saveStatus: 'saved' | 'replayed' | 'not_saved',
  ) {
    trace.recordRecommendation({
      nextAction: decision.nextAction,
      evidenceCodes: decision.evidenceCodes,
      learningSaveStatus: saveStatus,
    });
  }

  private degraded<T extends CoachRuntimeIntent>(
    intent: T,
    input: RuntimeInput,
  ) {
    return {
      intent,
      result: buildSafeDegradedResult(`trace_${input.request.id}`),
    };
  }
}
