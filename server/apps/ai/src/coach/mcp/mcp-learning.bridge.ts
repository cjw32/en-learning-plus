import {
  COACH_TOOL_SCHEMA_VERSION,
  errorTypeSchema,
  type CreateExerciseOutput,
  type SearchLearningMaterialsV2Output,
} from '@en/common/coach';
import { z } from '@en/common/coach/zod';
import {
  MCP_SCHEMA_VERSION,
  mcpCreateQuizInputSchema,
  mcpSubmitAnswerInputSchema,
  type McpToolInvocation,
  type McpToolResult,
} from '@en/common/mcp';
import type {
  ExerciseTargetingService,
  LearnerProfileService,
  LearningMaterialService,
  OwnedGradingService,
  RagLearningMaterialSearchPort,
  ReviewScheduleService,
  SelectedExerciseTarget,
  SubjectiveGrader,
} from '@libs/learning';
import { CoachExecutionContext } from '@libs/shared';
import type { McpCostMeter } from '../../mcp/governance/mcp-cost-meter';
import type { McpIdempotencyService } from '../../mcp/idempotency/mcp-idempotency.service';
import type { McpPersistenceIdentity } from '../../mcp/persistence/mcp-subject.repository';
import type { CoachConversationService } from '../conversation/coach-conversation.service';
import type { CoachPromptMaterial } from '../prompts/answer.prompt';
import type { CreateExerciseTool } from '../tools/create-exercise.tool';
import type {
  CoachModelGateway,
  CoachModelTelemetry,
} from '../workflow/coach-model.gateway';
import type { McpOperationEnvelopeFactory } from './mcp-operation-envelope.factory';

export type McpLearningMaterialSearchInput = Readonly<{
  userId: string;
  requestId: string;
  traceId: string;
  input: Readonly<{
    query: string;
    categories: readonly string[];
    levels?: readonly string[];
    courseIds?: readonly string[];
    wordIds?: readonly string[];
    topK: number;
    minimumRelevance?: number;
  }>;
  deadline?: Date;
  signal?: AbortSignal;
}>;

export type McpLearningMaterialSearchResult = Readonly<{
  retrievalStatus: 'success' | 'insufficient';
  results: readonly Readonly<{
    resultId: string;
    title: string;
    category: string;
    excerpt: string;
    rank: number;
    relevanceScore: number;
    contentVersion: string;
    citation: Readonly<{
      citationId: string;
      source: string;
      title: string;
      excerpt?: string;
      contentVersion: string;
      accessScope: 'PUBLIC' | 'OWNED_COURSE' | 'PRIVATE_OWNER';
      status: 'active';
    }>;
  }>[];
  conflicts: readonly Readonly<{
    topic: string;
    resolution: 'resolved_by_version' | 'resolved_by_authority' | 'unresolved';
  }>[];
}>;

type McpCreateQuizInput = Extract<
  McpToolInvocation,
  { name: 'create_quiz' }
>['input'];
export type McpCreateQuizBridgeResult = Extract<
  McpToolResult,
  { ok: true; status: 'ready' }
>;

export type McpCreateQuizBridgeInput = Readonly<{
  userId: string;
  authorizationId: string;
  requestId: string;
  traceId: string;
  invocationId: string;
  idempotencyIntentId: string;
  requestFingerprint: string;
  input: McpCreateQuizInput;
  deadline: Date;
  signal?: AbortSignal;
  modelTelemetry?: CoachModelTelemetry;
  onRetrievalComplete?: () => void;
  beforeModelCall?: () => void;
}>;

export type McpQuizBridgeServices = Readonly<{
  profiles: Pick<LearnerProfileService, 'getSnapshot'>;
  schedules: Pick<ReviewScheduleService, 'getDueWords'>;
  targeting: Pick<ExerciseTargetingService, 'select'>;
  exercises: Pick<CreateExerciseTool, 'execute'>;
  envelopes: Pick<McpOperationEnvelopeFactory, 'create'>;
  conversations: Pick<CoachConversationService, 'persistMcpOperationEnvelope'>;
}>;

type McpSubmitAnswerInput = Extract<
  McpToolInvocation,
  { name: 'submit_answer' }
>['input'];

export const mcpSubmitPreparationSchema = z
  .object({
    schemaVersion: z.literal('mcp.submit-preparation.v1'),
    exerciseId: z.string().min(10).max(64),
    exerciseVersion: z.string().min(1).max(128),
    gradeRequestId: z.string().min(10).max(64),
    answerVersion: z.string().min(32).max(128),
    gradingHash: z.string().min(32).max(128),
    score: z.number().int().min(0).max(100),
    correction: z.string().max(4_000),
    explanation: z.string().min(1).max(12_000),
    examples: z.array(z.string().min(1).max(2_000)).max(8),
    errorTypes: z.array(errorTypeSchema).max(11),
    items: z
      .array(
        z
          .object({
            itemId: z.string().min(1).max(64),
            isCorrect: z.boolean(),
            score: z.number().int().min(0).max(100),
            correction: z.string().max(4_000),
            explanation: z.string().min(1).max(4_000),
            errorTypes: z.array(errorTypeSchema).max(11),
            examples: z.array(z.string().min(1).max(2_000)).max(8),
            targetQualities: z
              .array(
                z
                  .object({
                    targetType: z.enum(['WORD', 'ERROR_TYPE']),
                    targetKey: z.string().min(1).max(128),
                    quality: z.number().int().min(0).max(5),
                  })
                  .strict(),
              )
              .min(1)
              .max(50),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export type McpSubmitPreparation = z.infer<typeof mcpSubmitPreparationSchema>;

export type McpSubmitAnswerBridgeInput = Readonly<{
  identity: McpPersistenceIdentity;
  userId: string;
  authorizationId: string;
  requestId: string;
  traceId: string;
  invocationId: string;
  idempotencyIntentId: string;
  requestFingerprint: string;
  preparations: Pick<
    McpIdempotencyService,
    'loadSubmitPreparation' | 'stageSubmitPreparation'
  >;
  input: McpSubmitAnswerInput;
  deadline: Date;
  signal?: AbortSignal;
  beforeModelCall?: () => void;
  modelTelemetry?: CoachModelTelemetry;
}>;

export type McpSubmitBridgeServices = Readonly<{
  grading: Pick<OwnedGradingService, 'prepareOwned'>;
  envelopes: Pick<McpOperationEnvelopeFactory, 'create'>;
  conversations: Pick<CoachConversationService, 'persistMcpOperationEnvelope'>;
  model?: Pick<CoachModelGateway, 'gradeSubjective'>;
}>;

type McpBridgeCostMeter = Pick<McpCostMeter, 'recordRag'> &
  Partial<Pick<McpCostMeter, 'beginSubmit' | 'recordSubmit'>>;

export class McpLearningBridgeError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'SOURCE_RIGHTS_DENIED'
      | 'DATA_NOT_AVAILABLE'
      | 'BUDGET_EXCEEDED'
      | 'TIMEOUT'
      | 'CANCELLED'
      | 'DEPENDENCY_UNAVAILABLE'
      | 'SCHEMA_INVALID'
      | 'IDEMPOTENCY_CONFLICT'
      | 'STATE_CONFLICT'
      | 'INTERNAL_ERROR',
  ) {
    super(code);
    this.name = 'McpLearningBridgeError';
  }
}

type Materials = Pick<LearningMaterialService, 'searchV2'>;
type SuccessfulMaterialSearch = Extract<
  SearchLearningMaterialsV2Output,
  { ok: true }
>;
type MaterialResult = SuccessfulMaterialSearch['results'][number];
type MaterialCitation = SuccessfulMaterialSearch['citations'][number];
type AcceptedMaterial = Readonly<{
  result: MaterialResult;
  citation: MaterialCitation;
}>;

const defaultQuizCategories = Object.freeze([
  'WORD_MEANING',
  'WORD_USAGE',
  'COLLOCATION',
  'EXAMPLE_SENTENCE',
  'GRAMMAR_RULE',
  'COURSE_LESSON',
] as const);
const coachDifficulties = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

function empty(): McpLearningMaterialSearchResult {
  return Object.freeze({
    retrievalStatus: 'insufficient' as const,
    results: Object.freeze([]),
    conflicts: Object.freeze([]),
  });
}

function isActiveOutput(
  value: SearchLearningMaterialsV2Output,
): value is Extract<SearchLearningMaterialsV2Output, { ok: true }> {
  return value.ok;
}

function assertQuizExecutionOpen(
  request: McpCreateQuizBridgeInput,
  now: () => Date,
): void {
  if (request.signal?.aborted) throw new McpLearningBridgeError('CANCELLED');
  if (request.deadline.getTime() <= now().getTime()) {
    throw new McpLearningBridgeError('TIMEOUT');
  }
}

function learningDate(now: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function requestedDifficulty(
  requested: McpCreateQuizInput['difficulty'],
  selected: ReturnType<ExerciseTargetingService['select']>['difficulty'],
) {
  const index =
    selected === 'UNKNOWN' ? -1 : coachDifficulties.indexOf(selected);
  if (index < 0 || requested === 'MEDIUM') return selected;
  if (requested === 'EASY') return coachDifficulties[Math.max(0, index - 1)];
  return coachDifficulties[Math.min(coachDifficulties.length - 1, index + 1)];
}

function coachExerciseType(type: McpCreateQuizInput['types'][number]) {
  if (type === 'FILL_IN_BLANK') return 'FILL_BLANK' as const;
  if (type === 'SHORT_ANSWER') return 'SITUATIONAL_DIALOGUE' as const;
  return type;
}

function mcpExerciseType(
  type: Extract<CreateExerciseOutput, { ok: true }>['type'],
) {
  if (type === 'FILL_BLANK') return 'FILL_IN_BLANK' as const;
  if (type === 'SITUATIONAL_DIALOGUE') return 'SHORT_ANSWER' as const;
  return type;
}

function materialType(category: string): 'word' | 'course' | 'grammar' {
  if (category.startsWith('GRAMMAR')) return 'grammar';
  if (
    category.startsWith('WORD') ||
    category === 'COLLOCATION' ||
    category === 'EXAMPLE_SENTENCE'
  ) {
    return 'word';
  }
  return 'course';
}

function acceptedQuizMaterials(
  raw: SearchLearningMaterialsV2Output,
  filters: Readonly<{
    categories: readonly string[];
    levels: readonly string[];
    courseIds: readonly string[];
    wordIds: readonly string[];
    topK: number;
    minimumRelevance: number;
  }>,
): AcceptedMaterial[] {
  if (!isActiveOutput(raw) || !raw.appliedFilters.privateOwnerEnforced)
    return [];
  const citations = new Map(
    raw.citations
      .filter(
        (citation) =>
          citation.status === 'active' &&
          (citation.accessScope === 'PUBLIC' ||
            citation.accessScope === 'OWNED_COURSE'),
      )
      .map((citation) => [citation.citationId, citation]),
  );
  const categories = new Set(filters.categories);
  const levels = new Set(filters.levels);
  const courses = new Set(filters.courseIds);
  const words = new Set(filters.wordIds);
  return raw.results
    .filter((result) => {
      const citation = citations.get(result.citationId);
      return Boolean(
        citation &&
        result.status === 'valid' &&
        result.embeddingVersion === raw.appliedFilters.embeddingVersion &&
        result.rank <= filters.topK &&
        result.relevanceScore >= filters.minimumRelevance &&
        categories.has(result.category) &&
        (levels.size === 0 ||
          (result.level !== null && levels.has(result.level))) &&
        (courses.size === 0 ||
          (result.courseId !== null && courses.has(result.courseId))) &&
        (words.size === 0 ||
          (result.wordId !== null && words.has(result.wordId))) &&
        citation.source === result.source &&
        citation.sourceId === result.sourceId &&
        citation.title === result.title &&
        citation.excerpt === result.excerpt &&
        citation.category === result.category &&
        citation.wordId === result.wordId &&
        citation.courseId === result.courseId &&
        citation.accessScope === result.accessScope,
      );
    })
    .slice(0, filters.topK)
    .map((result) => ({ result, citation: citations.get(result.citationId)! }));
}

function asBridgeError(error: unknown): McpLearningBridgeError {
  if (error instanceof McpLearningBridgeError) return error;
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  if (code === 'BUDGET_EXCEEDED') {
    return new McpLearningBridgeError('BUDGET_EXCEEDED');
  }
  if (code === 'CANCELLED') return new McpLearningBridgeError('CANCELLED');
  if (code === 'TOOL_TIMEOUT' || code === 'TIMEOUT') {
    return new McpLearningBridgeError('TIMEOUT');
  }
  if (code === 'RESOURCE_NOT_FOUND') {
    return new McpLearningBridgeError('RESOURCE_NOT_FOUND');
  }
  if (code === 'DATA_NOT_AVAILABLE') {
    return new McpLearningBridgeError('DATA_NOT_AVAILABLE');
  }
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return new McpLearningBridgeError('IDEMPOTENCY_CONFLICT');
  }
  if (code === 'STATE_CONFLICT') {
    return new McpLearningBridgeError('STATE_CONFLICT');
  }
  if (code === 'SCHEMA_INVALID' || code === 'VALIDATION_FAILED') {
    return new McpLearningBridgeError('SCHEMA_INVALID');
  }
  return new McpLearningBridgeError('DEPENDENCY_UNAVAILABLE');
}

async function recordMetric(
  costMeter: Pick<McpCostMeter, 'recordRag'> | undefined,
  now: () => Date,
  request: McpLearningMaterialSearchInput,
  measurement: Readonly<{
    startedAt: number;
    retrievalFinishedAt: number;
    outputTokens: number;
    cancellationOutcome: 'completed' | 'cancelled';
  }>,
): Promise<void> {
  if (!costMeter) return;
  const finishedAt = now().getTime();
  await costMeter.recordRag({
    traceId: request.traceId,
    inputTokens: Buffer.byteLength(request.input.query, 'utf8'),
    outputTokens: measurement.outputTokens,
    cacheOutcome: 'bypass',
    cancellationOutcome: measurement.cancellationOutcome,
    retrievalMs: Math.max(
      0,
      measurement.retrievalFinishedAt - measurement.startedAt,
    ),
    projectionMs: Math.max(0, finishedAt - measurement.retrievalFinishedAt),
    totalMs: Math.max(0, finishedAt - measurement.startedAt),
  });
}

/**
 * Narrow application bridge for MCP learning-material reads. It deliberately
 * exposes no Coach workflow, model, grading, exercise, attempt or save method.
 */
export class McpLearningBridge {
  constructor(
    private readonly materials: Materials,
    private readonly ragSearch?: RagLearningMaterialSearchPort,
    private readonly costMeter?: McpBridgeCostMeter,
    private readonly now: () => Date = () => new Date(),
    private readonly quiz?: McpQuizBridgeServices,
    private readonly submit?: McpSubmitBridgeServices,
  ) {}

  async prepareSubmitAnswer(
    request: McpSubmitAnswerBridgeInput,
  ): Promise<McpSubmitPreparation> {
    const parsed = mcpSubmitAnswerInputSchema.safeParse(request.input);
    if (
      !parsed.success ||
      !request.userId.trim() ||
      !request.authorizationId.trim() ||
      !request.requestId.trim() ||
      !request.traceId.trim() ||
      !request.invocationId.trim() ||
      !request.idempotencyIntentId.trim() ||
      !/^[a-f0-9]{64}$/u.test(request.requestFingerprint) ||
      Number.isNaN(request.deadline.getTime()) ||
      request.identity.userId !== request.userId ||
      request.identity.authorizationId !== request.authorizationId
    ) {
      throw new McpLearningBridgeError('VALIDATION_FAILED');
    }
    if (!this.submit) {
      throw new McpLearningBridgeError('DEPENDENCY_UNAVAILABLE');
    }
    const startedAt = this.now().getTime();
    try {
      assertQuizExecutionOpen(request, this.now);
      const staged = await request.preparations.loadSubmitPreparation(
        request.identity,
        request.idempotencyIntentId,
        request.requestFingerprint,
      );
      if (staged) {
        const replay = mcpSubmitPreparationSchema.safeParse(
          staged.gradingResult,
        );
        if (!replay.success) {
          throw new McpLearningBridgeError('SCHEMA_INVALID');
        }
        const finishedAt = this.now().getTime();
        await this.costMeter?.recordSubmit?.({
          traceId: request.traceId,
          outcome: 'replayed',
          cancellationOutcome: 'completed',
          modelExecuted: false,
          inputTokens: 0,
          outputTokens: 0,
          gradingMs: 0,
          projectionMs: 0,
          totalMs: Math.max(0, finishedAt - startedAt),
        });
        return Object.freeze(replay.data);
      }

      const session = this.costMeter?.beginSubmit?.({
        traceId: request.traceId,
      });
      const envelope = this.submit.envelopes.create({
        operation: 'submit_answer',
        userId: request.userId,
        authorizationId: request.authorizationId,
        invocationId: request.invocationId,
        idempotencyIntentId: request.idempotencyIntentId,
        requestFingerprint: request.requestFingerprint,
        now: this.now(),
        deadlineAt: request.deadline,
      });
      await this.submit.conversations.persistMcpOperationEnvelope(envelope);
      assertQuizExecutionOpen(request, this.now);

      const deadlineController = new AbortController();
      const abortFromCaller = () => deadlineController.abort();
      request.signal?.addEventListener('abort', abortFromCaller, {
        once: true,
      });
      const remainingMs = Math.max(
        1,
        request.deadline.getTime() - this.now().getTime(),
      );
      const deadlineTimer = setTimeout(
        () => deadlineController.abort(),
        remainingMs,
      );
      let gradingFinishedAt = startedAt;
      let succeeded = false;
      try {
        const telemetry: CoachModelTelemetry = Object.freeze({
          onFirstOutput: () => {
            session?.telemetry.onFirstOutput();
            request.modelTelemetry?.onFirstOutput();
          },
          onUsage: (usage) => {
            session?.telemetry.onUsage(usage);
            request.modelTelemetry?.onUsage(usage);
          },
        });
        const subjective: SubjectiveGrader | undefined = this.submit.model
          ? {
              evaluate: async (input) => {
                assertQuizExecutionOpen(request, this.now);
                request.beforeModelCall?.();
                return this.submit!.model!.gradeSubjective(
                  input,
                  deadlineController.signal,
                  telemetry,
                );
              },
            }
          : undefined;
        const prepared = await this.submit.grading.prepareOwned({
          subjectId: request.userId,
          gradeRequestId: envelope.request.id,
          exerciseId: parsed.data.exerciseId,
          exerciseVersion: parsed.data.exerciseVersion,
          answers: parsed.data.answers.map(({ itemId, value }) => ({
            itemId,
            answer: value,
          })),
          idempotencyKey: envelope.request.clientRequestKey,
          ...(subjective ? { subjective } : {}),
        });
        gradingFinishedAt = this.now().getTime();
        if (deadlineController.signal.aborted) {
          throw new McpLearningBridgeError(
            request.signal?.aborted ? 'CANCELLED' : 'TIMEOUT',
          );
        }
        assertQuizExecutionOpen(request, this.now);
        if (prepared.status !== 'GRADED_VALID') {
          throw new McpLearningBridgeError('SCHEMA_INVALID');
        }
        const projection = mcpSubmitPreparationSchema.safeParse({
          schemaVersion: 'mcp.submit-preparation.v1',
          exerciseId: prepared.exerciseId,
          exerciseVersion: prepared.exerciseVersion,
          gradeRequestId: envelope.request.id,
          answerVersion: prepared.result.answerVersion,
          gradingHash: prepared.result.gradingHash,
          score: prepared.result.score,
          correction: prepared.result.correction,
          explanation: prepared.result.explanation,
          examples: prepared.result.examples,
          errorTypes: prepared.result.errorTypes,
          items: prepared.result.items,
        });
        if (!projection.success) {
          throw new McpLearningBridgeError('SCHEMA_INVALID');
        }
        const stored = await request.preparations.stageSubmitPreparation(
          request.identity,
          {
            intentId: request.idempotencyIntentId,
            requestFingerprint: request.requestFingerprint,
            exerciseId: parsed.data.exerciseId,
            gradingResult: projection.data,
            now: this.now(),
          },
        );
        const verified = mcpSubmitPreparationSchema.safeParse(
          stored.gradingResult,
        );
        if (!verified.success) {
          throw new McpLearningBridgeError('SCHEMA_INVALID');
        }
        const finishedAt = this.now().getTime();
        await session?.finish({
          outcome: 'prepared',
          cancellationOutcome: 'completed',
          gradingMs: Math.max(0, gradingFinishedAt - startedAt),
          projectionMs: Math.max(0, finishedAt - gradingFinishedAt),
          totalMs: Math.max(0, finishedAt - startedAt),
        });
        succeeded = true;
        return Object.freeze(verified.data);
      } catch (error) {
        gradingFinishedAt = this.now().getTime();
        if (!succeeded) {
          await session?.finish({
            outcome: 'prepared',
            cancellationOutcome:
              request.signal?.aborted || deadlineController.signal.aborted
                ? 'cancelled'
                : 'completed',
            gradingMs: Math.max(0, gradingFinishedAt - startedAt),
            projectionMs: 0,
            totalMs: Math.max(0, gradingFinishedAt - startedAt),
          });
        }
        if (request.signal?.aborted) {
          throw new McpLearningBridgeError('CANCELLED');
        }
        if (deadlineController.signal.aborted) {
          throw new McpLearningBridgeError('TIMEOUT');
        }
        throw error;
      } finally {
        clearTimeout(deadlineTimer);
        request.signal?.removeEventListener('abort', abortFromCaller);
      }
    } catch (error) {
      if (request.signal?.aborted) {
        throw new McpLearningBridgeError('CANCELLED');
      }
      throw asBridgeError(error);
    }
  }

  async createQuiz(
    request: McpCreateQuizBridgeInput,
  ): Promise<McpCreateQuizBridgeResult> {
    const parsed = mcpCreateQuizInputSchema.safeParse(request.input);
    if (
      !parsed.success ||
      !request.userId.trim() ||
      !request.authorizationId.trim() ||
      !request.requestId.trim() ||
      !request.traceId.trim() ||
      !request.invocationId.trim() ||
      !request.idempotencyIntentId.trim() ||
      !/^[a-f0-9]{64}$/u.test(request.requestFingerprint) ||
      Number.isNaN(request.deadline.getTime())
    ) {
      throw new McpLearningBridgeError('VALIDATION_FAILED');
    }
    if (!this.quiz) {
      throw new McpLearningBridgeError('DEPENDENCY_UNAVAILABLE');
    }

    try {
      assertQuizExecutionOpen(request, this.now);
      const profile = await this.quiz.profiles.getSnapshot(request.userId, 50);
      assertQuizExecutionOpen(request, this.now);
      const due = await this.quiz.schedules.getDueWords(request.userId, {
        learningDate: learningDate(this.now(), profile.timezone),
        timezone: profile.timezone,
        limit: 50,
        ...(profile.activeCourse?.id
          ? { courseId: profile.activeCourse.id }
          : {}),
      });
      assertQuizExecutionOpen(request, this.now);
      const selected = this.quiz.targeting.select({
        profile,
        dueWords: due.words,
        limit: 50,
      });

      const knownWords = new Map<string, string>();
      for (const word of profile.learnedWordSummary.recentWords) {
        knownWords.set(word.wordId, word.word);
      }
      for (const item of profile.weakItems) {
        if (item.targetType === 'WORD')
          knownWords.set(item.targetKey, item.label);
      }
      for (const word of due.words) knownWords.set(word.wordId, word.word);
      const requestedWordIds = parsed.data.wordIds ?? [];
      if (requestedWordIds.some((wordId) => !knownWords.has(wordId))) {
        throw new McpLearningBridgeError('SOURCE_RIGHTS_DENIED');
      }

      let targets: SelectedExerciseTarget[] = requestedWordIds.length
        ? requestedWordIds.map((wordId) => ({
            targetType: 'WORD' as const,
            targetKey: wordId,
            wordId,
            label: knownWords.get(wordId)!,
          }))
        : selected.targets.slice(0, 50);
      let personalizationReason = selected.personalizationReason;
      if (targets.length === 0) {
        targets = [
          {
            targetType: 'ERROR_TYPE',
            targetKey: 'general_english',
            label: 'general English',
          },
        ];
        personalizationReason =
          'No current profile evidence was available, so this uses approved general material.';
      }
      assertQuizExecutionOpen(request, this.now);

      const categories = parsed.data.knowledgeCategories?.length
        ? parsed.data.knowledgeCategories
        : defaultQuizCategories;
      const levels = profile.level ? [profile.level.cefr] : [];
      const courseIds = profile.activeCourse ? [profile.activeCourse.id] : [];
      const wordIds = targets.flatMap((target) =>
        target.targetType === 'WORD' ? [target.targetKey] : [],
      );
      const topK = Math.min(20, Math.max(8, parsed.data.count * 2));
      const minimumRelevance = 0.65;
      const query = `English practice for ${targets
        .map((target) => target.label)
        .join(', ')}`.slice(0, 1_000);
      const raw = await this.materials.searchV2(
        request.userId,
        {
          schemaVersion: 'coach.tool.v2',
          query,
          filters: {
            categories: [...categories] as never,
            sources: [],
            courseIds,
            wordIds,
            ...(levels.length ? { levels: levels as never } : {}),
          },
          topK,
          minimumRelevance,
        },
        {
          requestId: request.requestId,
          deadline: request.deadline,
          ...(request.signal ? { signal: request.signal } : {}),
        },
        this.ragSearch,
      );
      assertQuizExecutionOpen(request, this.now);
      const accepted = acceptedQuizMaterials(raw, {
        categories,
        levels,
        courseIds,
        wordIds,
        topK,
        minimumRelevance,
      });
      if (accepted.length === 0) {
        throw new McpLearningBridgeError('DATA_NOT_AVAILABLE');
      }
      request.onRetrievalComplete?.();
      const promptMaterials: CoachPromptMaterial[] = accepted.map(
        ({ result, citation }) => ({
          citation: {
            citationId: citation.citationId,
            sourceId: result.sourceId,
            materialType: materialType(result.category),
            title: result.title,
            category: result.category,
            locator: `mcp-citation:${citation.citationId}`,
            supports: result.excerpt.slice(0, 1_000),
            accessScope: result.accessScope,
          },
          summary: result.excerpt,
        }),
      );

      const envelope = this.quiz.envelopes.create({
        operation: 'create_quiz',
        userId: request.userId,
        authorizationId: request.authorizationId,
        invocationId: request.invocationId,
        idempotencyIntentId: request.idempotencyIntentId,
        requestFingerprint: request.requestFingerprint,
        now: this.now(),
        deadlineAt: request.deadline,
      });
      await this.quiz.conversations.persistMcpOperationEnvelope(envelope);
      assertQuizExecutionOpen(request, this.now);

      const output = await this.quiz.exercises.execute(
        new CoachExecutionContext(
          request.userId,
          Math.ceil(request.deadline.getTime() / 1_000),
        ),
        {
          requestId: envelope.request.id,
          conversationId: envelope.conversation.id,
          targets,
          materials: promptMaterials,
          personalizationReason,
          ...(request.signal ? { signal: request.signal } : {}),
          ...(request.modelTelemetry
            ? { modelTelemetry: request.modelTelemetry }
            : {}),
          ...(request.beforeModelCall
            ? { beforeModelCall: request.beforeModelCall }
            : {}),
          maxModelAttempts: 1,
        },
        {
          schemaVersion: COACH_TOOL_SCHEMA_VERSION,
          types: parsed.data.types.map(coachExerciseType),
          count: parsed.data.count,
          difficulty: requestedDifficulty(
            parsed.data.difficulty,
            selected.difficulty,
          ),
          targetRefs: targets.map(({ targetType, targetKey }) => ({
            targetType,
            targetKey,
          })),
          materialSourceIds: promptMaterials.map(
            (material) => material.citation.sourceId,
          ),
          ...(parsed.data.scenario ? { scenario: parsed.data.scenario } : {}),
          idempotencyKey: envelope.request.clientRequestKey,
        },
      );
      assertQuizExecutionOpen(request, this.now);
      if (!output.ok) throw asBridgeError(output);
      if (output.items.length !== parsed.data.count) {
        throw new McpLearningBridgeError('SCHEMA_INVALID');
      }
      const usedSources = new Set(
        output.citations.map((citation) => citation.sourceId),
      );
      const publicCitations = accepted
        .filter(({ result }) => usedSources.has(result.sourceId))
        .map(({ result, citation }) => ({
          citationId: citation.citationId,
          source: citation.source,
          title: citation.title,
          ...(citation.excerpt ? { excerpt: citation.excerpt } : {}),
          contentVersion: result.contentVersion,
          accessScope: citation.accessScope,
          status: 'active' as const,
        }));
      if (publicCitations.length === 0) {
        throw new McpLearningBridgeError('SCHEMA_INVALID');
      }
      const type = mcpExerciseType(output.type);
      return {
        schemaVersion: MCP_SCHEMA_VERSION,
        ok: true,
        exerciseId: output.exerciseId,
        exerciseVersion: output.schemaVersion,
        status: 'ready',
        instructions: output.instructions,
        personalizationReason: output.personalizationReason,
        items: output.items.map((item) => ({
          itemId: item.itemId,
          position: item.position,
          type,
          prompt: item.prompt,
          ...(item.choices ? { choices: item.choices } : {}),
          maxScore: item.maxScore,
        })),
        citations: publicCitations,
        replayed: false,
        traceId: request.traceId,
      };
    } catch (error) {
      if (request.signal?.aborted) {
        throw new McpLearningBridgeError('CANCELLED');
      }
      throw asBridgeError(error);
    }
  }

  async searchMaterials(
    request: McpLearningMaterialSearchInput,
  ): Promise<McpLearningMaterialSearchResult> {
    if (!request.userId.trim() || !request.requestId.trim()) return empty();
    if (request.signal?.aborted) return empty();
    const startedAt = this.now().getTime();
    let retrievalFinishedAt = startedAt;
    let outputTokens = 0;
    let cancellationOutcome: 'completed' | 'cancelled' = 'completed';
    let result: McpLearningMaterialSearchResult = empty();
    let raw: SearchLearningMaterialsV2Output;
    try {
      raw = await this.materials.searchV2(
        request.userId,
        {
          schemaVersion: 'coach.tool.v2',
          query: request.input.query,
          filters: {
            categories: [...request.input.categories] as never,
            sources: [],
            courseIds: [...(request.input.courseIds ?? [])],
            wordIds: [...(request.input.wordIds ?? [])],
            ...(request.input.levels
              ? { levels: [...request.input.levels] as never }
              : {}),
          },
          topK: request.input.topK,
          ...(request.input.minimumRelevance === undefined
            ? {}
            : { minimumRelevance: request.input.minimumRelevance }),
        },
        {
          requestId: request.requestId,
          ...(request.deadline ? { deadline: request.deadline } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
        },
        this.ragSearch,
      );
      retrievalFinishedAt = this.now().getTime();
    } catch {
      retrievalFinishedAt = this.now().getTime();
      cancellationOutcome = request.signal?.aborted ? 'cancelled' : 'completed';
      await recordMetric(this.costMeter, this.now, request, {
        startedAt,
        retrievalFinishedAt,
        outputTokens,
        cancellationOutcome,
      });
      return result;
    }
    if (!isActiveOutput(raw) || request.signal?.aborted) {
      cancellationOutcome = request.signal?.aborted ? 'cancelled' : 'completed';
      await recordMetric(this.costMeter, this.now, request, {
        startedAt,
        retrievalFinishedAt,
        outputTokens,
        cancellationOutcome,
      });
      return result;
    }

    const citations = new Map(
      raw.citations
        .filter(({ status }) => status === 'active')
        .map((citation) => [citation.citationId, citation]),
    );
    const categoryFilter = new Set(request.input.categories);
    const levelFilter = new Set(request.input.levels ?? []);
    const courseFilter = new Set(request.input.courseIds ?? []);
    const wordFilter = new Set(request.input.wordIds ?? []);
    const accessScopes = new Set(raw.appliedFilters.accessScopes);
    const acceptedCitationIds = new Set<string>();
    const projected = raw.results
      .filter((result) => {
        const citation = citations.get(result.citationId);
        const categoryAllowed = categoryFilter.has(result.category);
        const levelAllowed =
          levelFilter.size === 0 ||
          (result.level !== null && levelFilter.has(result.level));
        const courseAllowed =
          courseFilter.size === 0 ||
          (result.courseId !== null && courseFilter.has(result.courseId));
        const wordAllowed =
          wordFilter.size === 0 ||
          (result.wordId !== null && wordFilter.has(result.wordId));
        const citationMatches =
          citation &&
          citation.source === result.source &&
          citation.sourceId === result.sourceId &&
          citation.title === result.title &&
          citation.excerpt === result.excerpt &&
          citation.category === result.category &&
          citation.wordId === result.wordId &&
          citation.courseId === result.courseId &&
          citation.accessScope === result.accessScope;
        return Boolean(
          result.status === 'valid' &&
          result.embeddingVersion === raw.appliedFilters.embeddingVersion &&
          result.relevanceScore >= raw.appliedFilters.minimumRelevance &&
          result.rank <= request.input.topK &&
          categoryAllowed &&
          levelAllowed &&
          courseAllowed &&
          wordAllowed &&
          accessScopes.has(result.accessScope) &&
          citationMatches,
        );
      })
      .slice(0, request.input.topK)
      .map((result, index) => {
        const citation = citations.get(result.citationId)!;
        acceptedCitationIds.add(result.citationId);
        return Object.freeze({
          resultId: result.resultId,
          title: result.title,
          category: result.category,
          excerpt: result.excerpt,
          rank: index + 1,
          relevanceScore: result.relevanceScore,
          contentVersion: result.contentVersion,
          citation: Object.freeze({
            citationId: citation.citationId,
            source: citation.source,
            title: citation.title,
            excerpt: citation.excerpt,
            contentVersion: result.contentVersion,
            accessScope: citation.accessScope,
            status: 'active' as const,
          }),
        });
      });
    if (projected.length === 0) {
      await recordMetric(this.costMeter, this.now, request, {
        startedAt,
        retrievalFinishedAt,
        outputTokens,
        cancellationOutcome,
      });
      return result;
    }
    const conflicts = raw.conflicts
      .filter(({ citationIds }) =>
        citationIds.every((citationId) => acceptedCitationIds.has(citationId)),
      )
      .map(({ topic, resolution }) => Object.freeze({ topic, resolution }));
    result = Object.freeze({
      retrievalStatus: 'success' as const,
      results: Object.freeze(projected),
      conflicts: Object.freeze(conflicts),
    });
    outputTokens = projected.reduce(
      (total, item) => total + Buffer.byteLength(item.excerpt, 'utf8'),
      0,
    );
    await recordMetric(this.costMeter, this.now, request, {
      startedAt,
      retrievalFinishedAt,
      outputTokens,
      cancellationOutcome,
    });
    return result;
  }
}
