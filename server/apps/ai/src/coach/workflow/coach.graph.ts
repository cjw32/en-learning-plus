import type { CoachResult } from '@en/common/coach';
import { coachResultSchema } from '@en/common/coach';
import { z } from '@en/common/coach/zod';
import type { CoachExecutionContext } from '@libs/shared';
import { END, START, StateGraph } from '@langchain/langgraph';
import {
  generateValidatedAnswer,
  ownedSourceIds,
  type CoachAnswerWorkflowInput,
  type CoachMaterialResult,
} from './answer.nodes';
import {
  buildCoachAnswerResult,
  buildSafeDegradedResult,
  citationsAreSupported,
  type CoachRecommendation,
} from './final-result.validator';
import { buildExerciseResult } from './exercise.nodes';
import {
  buildGradingResult,
  isValidatedGradeFailure,
  parseValidatedGrade,
} from './grading.nodes';
import type { CoachEventStreamService } from '../streaming/coach-event-stream.service';
import {
  decideNextAction,
  deterministicNextActionReason,
  type NextActionDecision,
  type ProfileSignalState,
} from './next-action.policy';
import { assembleLearningUpdate } from './coach-result.assembler';

const runtimeGraphStateSchema = z
  .object({
    inputType: z.enum(['MESSAGE', 'EXERCISE_SUBMISSION', 'RECOMMENDATION']),
    intent: z
      .enum([
        'ANSWER',
        'CORRECTION',
        'CREATE_EXERCISE',
        'GRADE_ANSWER',
        'REVIEW_RECOMMENDATION',
        'UNKNOWN',
      ])
      .nullable(),
    result: coachResultSchema.nullable(),
  })
  .strict();

export async function runControlledCoachRuntimeGraph(input: {
  inputType: 'MESSAGE' | 'EXERCISE_SUBMISSION' | 'RECOMMENDATION';
  branches: {
    message(): Promise<{
      intent: 'ANSWER' | 'CORRECTION' | 'CREATE_EXERCISE' | 'UNKNOWN';
      result: CoachResult;
    }>;
    submission(): Promise<{
      intent: 'GRADE_ANSWER';
      result: CoachResult;
    }>;
    recommendation(): Promise<{
      intent: 'REVIEW_RECOMMENDATION';
      result: CoachResult;
    }>;
  };
}) {
  const graph = new StateGraph(runtimeGraphStateSchema)
    .addNode('route', () => ({}))
    .addNode('message', async () => input.branches.message())
    .addNode('submission', async () => input.branches.submission())
    .addNode('recommendation', async () => input.branches.recommendation())
    .addNode('validate_result', (state) => ({
      result: coachResultSchema.parse(state.result),
    }))
    .addEdge(START, 'route')
    .addConditionalEdges(
      'route',
      (state) => {
        if (state.inputType === 'MESSAGE') return 'message';
        if (state.inputType === 'EXERCISE_SUBMISSION') return 'submission';
        return 'recommendation';
      },
      ['message', 'submission', 'recommendation'],
    )
    .addEdge('message', 'validate_result')
    .addEdge('submission', 'validate_result')
    .addEdge('recommendation', 'validate_result')
    .addEdge('validate_result', END)
    .compile();
  const result = runtimeGraphStateSchema.parse(
    await graph.invoke({
      inputType: input.inputType,
      intent: null,
      result: null,
    }),
  );
  if (!result.intent || !result.result) {
    throw Object.assign(new Error('Coach graph did not produce a result'), {
      code: 'SCHEMA_INVALID',
    });
  }
  return { intent: result.intent, result: result.result };
}

export class CoachStepExecutionError extends Error {
  constructor(readonly code: 'CANCELLED' | 'REQUEST_TIMEOUT') {
    super(
      code === 'CANCELLED' ? 'Coach request cancelled' : 'Coach step timed out',
    );
    this.name = 'CoachStepExecutionError';
  }
}

export interface CoachStepCancellation {
  abortSignalFor(requestId: string): AbortSignal;
  observe(requestId: string): Promise<boolean>;
}

export class CoachControlledStepRunner {
  constructor(
    private readonly stream: Pick<
      CoachEventStreamService,
      'publishStatus' | 'publishToolStatus'
    >,
    private readonly cancellation: CoachStepCancellation,
  ) {}

  async execute<T>(input: {
    requestId: string;
    status:
      | 'validating'
      | 'understanding'
      | 'personalizing'
      | 'finding_materials'
      | 'generating'
      | 'grading'
      | 'saving'
      | 'recommending'
      | 'finalizing';
    tool?:
      | 'get_learner_profile'
      | 'get_due_words'
      | 'search_learning_materials'
      | 'create_exercise'
      | 'grade_answer'
      | 'save_attempt';
    timeoutMs: number;
    operation(signal: AbortSignal): Promise<T>;
    onSuccess(result: T): Promise<void> | void;
  }): Promise<T> {
    const cancellationSignal = this.cancellation.abortSignalFor(
      input.requestId,
    );
    if (
      cancellationSignal.aborted ||
      (await this.cancellation.observe(input.requestId))
    ) {
      throw new CoachStepExecutionError('CANCELLED');
    }
    const timeout = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeout.abort();
    }, input.timeoutMs);
    const signal = AbortSignal.any([cancellationSignal, timeout.signal]);
    const observer = setInterval(
      () => {
        void this.cancellation
          .observe(input.requestId)
          .catch(() => timeout.abort());
      },
      Math.min(250, Math.max(10, input.timeoutMs)),
    );
    try {
      await this.stream.publishStatus(input.requestId, input.status);
      if (input.tool) {
        await this.stream.publishToolStatus(
          input.requestId,
          input.tool,
          'started',
          null,
        );
      }
      const result = await input.operation(signal);
      if (timedOut || timeout.signal.aborted) {
        throw new CoachStepExecutionError('REQUEST_TIMEOUT');
      }
      if (
        signal.aborted ||
        (await this.cancellation.observe(input.requestId))
      ) {
        throw new CoachStepExecutionError('CANCELLED');
      }
      if (input.tool) {
        await this.stream.publishToolStatus(
          input.requestId,
          input.tool,
          'succeeded',
          null,
        );
      }
      await input.onSuccess(result);
      return result;
    } catch (error) {
      if (timedOut) throw new CoachStepExecutionError('REQUEST_TIMEOUT');
      if (signal.aborted) throw new CoachStepExecutionError('CANCELLED');
      if (input.tool) {
        await this.stream.publishToolStatus(
          input.requestId,
          input.tool,
          'failed',
          false,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      clearInterval(observer);
    }
  }
}

type SupportedAnswerIntent = 'ANSWER' | 'CORRECTION';

export interface CoachAnswerWorkflowDependencies {
  classifyIntent(
    input: CoachAnswerWorkflowInput,
    context: CoachExecutionContext,
  ): Promise<string>;
  getLearnerProfile(
    context: CoachExecutionContext,
    input: CoachAnswerWorkflowInput,
  ): Promise<unknown>;
  searchLearningMaterials(
    input: CoachAnswerWorkflowInput,
    profile: unknown,
    context: CoachExecutionContext,
  ): Promise<CoachMaterialResult>;
  generateAnswer(input: {
    intent: SupportedAnswerIntent;
    message: string;
    profile: unknown;
    materials: CoachMaterialResult;
    context: CoachExecutionContext;
  }): Promise<unknown>;
  recommend(input: {
    intent: SupportedAnswerIntent;
    profile: unknown;
    context: CoachExecutionContext;
  }): Promise<CoachRecommendation>;
  gradeAnswer(...args: unknown[]): Promise<unknown>;
  saveAttempt(...args: unknown[]): Promise<unknown>;
  onValidate?(result: CoachResult): void;
}

export class CoachAnswerWorkflow {
  constructor(private readonly dependencies: CoachAnswerWorkflowDependencies) {}

  async run(
    input: CoachAnswerWorkflowInput,
    context: CoachExecutionContext,
  ): Promise<CoachResult> {
    let result: CoachResult;
    try {
      const classified = await this.dependencies.classifyIntent(input, context);
      if (classified !== 'ANSWER' && classified !== 'CORRECTION') {
        return this.validatedFallback(input.traceId);
      }
      const intent: SupportedAnswerIntent = classified;
      const profile = await this.dependencies.getLearnerProfile(context, input);
      const materials = await this.dependencies.searchLearningMaterials(
        input,
        profile,
        context,
      );
      const answer = await generateValidatedAnswer({
        generate: () =>
          this.dependencies.generateAnswer({
            intent,
            message: input.message,
            profile,
            materials,
            context,
          }),
      });
      if (
        !answer ||
        !citationsAreSupported(answer, ownedSourceIds(materials))
      ) {
        return this.validatedFallback(input.traceId);
      }
      const recommendation = await this.dependencies.recommend({
        intent,
        profile,
        context,
      });
      result =
        buildCoachAnswerResult({
          responseType: intent === 'CORRECTION' ? 'correction' : 'answer',
          answer,
          recommendation,
          traceId: input.traceId,
        }) ?? buildSafeDegradedResult(input.traceId);
    } catch {
      result = buildSafeDegradedResult(input.traceId);
    }
    this.dependencies.onValidate?.(result);
    return result;
  }

  private validatedFallback(traceId: string) {
    const fallback = buildSafeDegradedResult(traceId);
    this.dependencies.onValidate?.(fallback);
    return fallback;
  }
}

export type CoachExerciseWorkflowInput = CoachAnswerWorkflowInput &
  Readonly<{
    preferences: {
      types?: Array<
        | 'MULTIPLE_CHOICE'
        | 'FILL_BLANK'
        | 'TRANSLATION'
        | 'SITUATIONAL_DIALOGUE'
      >;
      count?: number;
      topic?: string;
    };
    includeDueWords: boolean;
  }>;

export interface CoachExerciseWorkflowDependencies {
  classifyIntent(
    input: CoachExerciseWorkflowInput,
    context: CoachExecutionContext,
  ): Promise<string>;
  getLearnerProfile(
    context: CoachExecutionContext,
    input: CoachExerciseWorkflowInput,
  ): Promise<unknown>;
  getDueWords(
    context: CoachExecutionContext,
    input: CoachExerciseWorkflowInput,
  ): Promise<unknown>;
  searchLearningMaterials(input: {
    workflowInput: CoachExerciseWorkflowInput;
    profile: unknown;
    dueWords: unknown;
    context: CoachExecutionContext;
  }): Promise<
    { ok: true; materials: readonly unknown[] } | { ok: false; code: string }
  >;
  createExercise(input: {
    workflowInput: CoachExerciseWorkflowInput;
    profile: unknown;
    dueWords: unknown;
    materials: readonly unknown[];
    context: CoachExecutionContext;
  }): Promise<unknown>;
  recommend(input: {
    intent: 'CREATE_EXERCISE';
    profile: unknown;
    context: CoachExecutionContext;
  }): Promise<CoachRecommendation>;
  authorizeTool(tool: string): void;
  gradeAnswer(...args: unknown[]): Promise<unknown>;
  saveAttempt(...args: unknown[]): Promise<unknown>;
}

export class CoachExerciseWorkflow {
  constructor(
    private readonly dependencies: CoachExerciseWorkflowDependencies,
  ) {}

  async run(
    input: CoachExerciseWorkflowInput,
    context: CoachExecutionContext,
  ): Promise<CoachResult> {
    try {
      const intent = await this.dependencies.classifyIntent(input, context);
      if (intent !== 'CREATE_EXERCISE') {
        return buildSafeDegradedResult(input.traceId);
      }
      this.dependencies.authorizeTool('get_learner_profile');
      const profile = await this.dependencies.getLearnerProfile(context, input);
      let dueWords: unknown = { words: [] };
      if (input.includeDueWords) {
        this.dependencies.authorizeTool('get_due_words');
        dueWords = await this.dependencies.getDueWords(context, input);
      }
      this.dependencies.authorizeTool('search_learning_materials');
      const materials = await this.dependencies.searchLearningMaterials({
        workflowInput: input,
        profile,
        dueWords,
        context,
      });
      if (!materials.ok || materials.materials.length === 0) {
        return buildSafeDegradedResult(input.traceId);
      }
      this.dependencies.authorizeTool('create_exercise');
      const rawExercise = await this.dependencies.createExercise({
        workflowInput: input,
        profile,
        dueWords,
        materials: materials.materials,
        context,
      });
      const recommendation = await this.dependencies.recommend({
        intent: 'CREATE_EXERCISE',
        profile,
        context,
      });
      return (
        buildExerciseResult({
          rawExercise,
          recommendation,
          traceId: input.traceId,
        }) ?? buildSafeDegradedResult(input.traceId)
      );
    } catch {
      return buildSafeDegradedResult(input.traceId);
    }
  }
}

export type CoachGradingWorkflowInput = Readonly<{
  requestId: string;
  conversationId: string;
  exerciseId: string;
  answers: Array<{ itemId: string; answer: string | string[] }>;
  idempotencyKey: string;
  traceId: string;
}>;

export interface CoachGradingWorkflowDependencies {
  classifyIntent(
    input: CoachGradingWorkflowInput,
    context: CoachExecutionContext,
  ): Promise<string>;
  gradeAnswer(
    input: {
      requestId: string;
      exerciseId: string;
      answers: CoachGradingWorkflowInput['answers'];
      idempotencyKey: string;
    },
    context: CoachExecutionContext,
  ): Promise<unknown>;
  saveAttempt(
    input: {
      requestId: string;
      gradingValidated: true;
      submissionId: string;
      gradingHash: string;
      idempotencyKey: string;
    },
    context: CoachExecutionContext,
  ): Promise<unknown>;
  recommend(input: {
    intent: 'GRADE_ANSWER';
    score: number;
    errorTypes: readonly string[];
    saved: boolean;
    decision: NextActionDecision;
    context: CoachExecutionContext;
  }): Promise<CoachRecommendation>;
  getRecommendationFacts?(input: { context: CoachExecutionContext }): Promise<{
    dueCount: number;
    profileSignals: readonly ProfileSignalState[];
  }>;
  onRecommendation?(input: {
    decision: NextActionDecision;
    learningSaveStatus: 'saved' | 'replayed' | 'not_saved';
  }): void;
  authorizeTool(tool: string): void;
  onValidate?(result: CoachResult): void;
}

export class CoachGradingWorkflow {
  constructor(
    private readonly dependencies: CoachGradingWorkflowDependencies,
  ) {}

  async run(
    input: CoachGradingWorkflowInput,
    context: CoachExecutionContext,
  ): Promise<CoachResult> {
    try {
      const intent = await this.dependencies.classifyIntent(input, context);
      if (intent !== 'GRADE_ANSWER') {
        return this.validatedFallback(input.traceId);
      }
      this.dependencies.authorizeTool('grade_answer');
      let grade: ReturnType<typeof parseValidatedGrade>;
      for (let attempt = 0; attempt < 2 && !grade; attempt += 1) {
        const raw = await this.dependencies.gradeAnswer(
          {
            requestId: input.requestId,
            exerciseId: input.exerciseId,
            answers: input.answers,
            idempotencyKey: input.idempotencyKey,
          },
          context,
        );
        grade = parseValidatedGrade(raw);
        if (isValidatedGradeFailure(raw)) break;
      }
      if (!grade) return this.validatedFallback(input.traceId);

      this.dependencies.authorizeTool('save_attempt');
      const saveResult = await this.dependencies.saveAttempt(
        {
          requestId: input.requestId,
          gradingValidated: true,
          submissionId: grade.submissionId,
          gradingHash: grade.gradingHash,
          idempotencyKey: input.idempotencyKey,
        },
        context,
      );
      const saved =
        !!saveResult &&
        typeof saveResult === 'object' &&
        'ok' in saveResult &&
        saveResult.ok === true;
      const recommendationFacts =
        (await this.dependencies.getRecommendationFacts?.({ context })) ?? {
          dueCount: 0,
          profileSignals: [],
        };
      const decision = decideNextAction({
        validCurrentQualities: grade.items.flatMap((item) =>
          item.targetQualities.map((target) => target.quality),
        ),
        dueCount: recommendationFacts.dueCount,
        profileSignals: recommendationFacts.profileSignals,
      });
      const learningSaveStatus = assembleLearningUpdate(saveResult).status;
      let recommendation: CoachRecommendation;
      try {
        const explained = await this.dependencies.recommend({
          intent: 'GRADE_ANSWER',
          score: grade.score,
          errorTypes: grade.errorTypes,
          saved,
          decision,
          context,
        });
        if (explained.nextAction !== decision.nextAction) {
          throw new Error('Recommendation attempted to override policy');
        }
        recommendation = {
          nextAction: decision.nextAction,
          nextActionReason: explained.nextActionReason,
        };
      } catch {
        recommendation = {
          nextAction: decision.nextAction,
          nextActionReason:
            learningSaveStatus === 'not_saved'
              ? '批改已完成，但学习记录未保存，请安全重试。'
              : deterministicNextActionReason(decision),
        };
      }
      this.dependencies.onRecommendation?.({
        decision,
        learningSaveStatus,
      });
      const result = buildGradingResult({
        grade,
        saveResult,
        recommendation,
        traceId: input.traceId,
      });
      if (!result) return this.validatedFallback(input.traceId);
      this.dependencies.onValidate?.(result);
      return result;
    } catch {
      return this.validatedFallback(input.traceId);
    }
  }

  private validatedFallback(traceId: string) {
    const result = buildSafeDegradedResult(traceId);
    this.dependencies.onValidate?.(result);
    return result;
  }
}
