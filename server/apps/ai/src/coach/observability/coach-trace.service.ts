import { redactCoachPayload } from './coach-redaction';
import type {
  NextAction,
  NextActionEvidenceCode,
} from '../workflow/next-action.policy';
import { redactRagTraceMetadata } from './coach-redaction';
import type { RetrievalTraceMetadata } from './rag-trace.types';

export type CoachTraceStepStatus =
  | 'STARTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export type CoachTraceStep = Readonly<{
  sequence: number;
  stepName: string;
  status: CoachTraceStepStatus;
  startedAtMs: number;
  durationMs: number | null;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type CoachRecommendationTrace = Readonly<{
  nextAction: NextAction;
  evidenceCodes: readonly NextActionEvidenceCode[];
  learningSaveStatus: 'saved' | 'replayed' | 'not_saved';
}>;

export type CoachTraceTerminalStatus =
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'BUDGET_EXCEEDED';

export type CoachTraceRunConfig = Readonly<{
  requestId: string;
  promptVersion: string;
  promptHash: string;
  modelProvider: string;
  modelName: string;
  modelVersion: string;
  resultSchemaVersion: string;
  budgetVersion: string;
  startedAtMs: number;
}>;

export type CoachTraceSnapshot = Readonly<{
  traceId: string;
  traceSubjectId: string;
  requestId: string;
  promptVersion: string;
  promptHash: string;
  modelProvider: string;
  modelName: string;
  modelVersion: string;
  resultSchemaVersion: string;
  budgetVersion: string;
  startedAtMs: number;
  ttftMs: number | null;
  totalDurationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
  schemaFailureCount: number;
  retryCount: number;
  terminalStatus: CoachTraceTerminalStatus | null;
  resultType: string | null;
  steps: readonly CoachTraceStep[];
  recommendation: CoachRecommendationTrace | null;
  rag: RetrievalTraceMetadata | null;
  feedback: 'UP' | 'DOWN' | null;
}>;

export interface CoachTraceWriter {
  save(trace: CoachTraceSnapshot): Promise<void>;
}

const ACTIONS = new Set<NextAction>(['review', 'practice', 'continue']);
const RECOMMENDATION_EVIDENCE = new Set<NextActionEvidenceCode>([
  'CURRENT_QUALITY_BELOW_FOUR',
  'DUE_ITEMS_AVAILABLE',
  'NO_LOW_QUALITY_OR_DUE_ITEMS',
  'PROFILE_SIGNAL_MISSING',
  'PROFILE_SIGNAL_STALE',
]);
const SAVE_STATUSES = new Set(['saved', 'replayed', 'not_saved']);

export class CoachTraceService {
  private readonly steps: CoachTraceStep[] = [];
  private recommendation: CoachRecommendationTrace | null = null;
  private run: CoachTraceRunConfig | null = null;
  private firstTokenAtMs: number | null = null;
  private inputTokens = 0;
  private outputTokens = 0;
  private estimatedCostMicros = 0;
  private schemaFailureCount = 0;
  private retryCount = 0;
  private terminalStatus: CoachTraceTerminalStatus | null = null;
  private resultType: string | null = null;
  private finishedAtMs: number | null = null;
  private rag: RetrievalTraceMetadata | null = null;
  private groundingRecorded = false;

  constructor(
    private readonly traceId: string,
    private readonly traceSubjectId: string,
  ) {}

  configureRun(config: CoachTraceRunConfig): void {
    if (this.run) throw new Error('Trace run is already configured');
    if (!Number.isSafeInteger(config.startedAtMs) || config.startedAtMs < 0) {
      throw new Error('Invalid Trace start time');
    }
    for (const value of [
      config.requestId,
      config.promptVersion,
      config.promptHash,
      config.modelProvider,
      config.modelName,
      config.modelVersion,
      config.resultSchemaVersion,
      config.budgetVersion,
    ]) {
      if (!value.trim())
        throw new Error('Trace versions and identifiers are required');
    }
    this.run = Object.freeze({ ...config });
  }

  recordModelStart(inputTokens: number): void {
    this.assertCount(inputTokens, 'inputTokens');
    this.inputTokens += inputTokens;
  }

  recordFirstToken(timestampMs: number): void {
    this.requireRun();
    if (timestampMs < this.run!.startedAtMs) {
      throw new Error('TTFT cannot be negative');
    }
    if (this.firstTokenAtMs === null) this.firstTokenAtMs = timestampMs;
  }

  recordModelEnd(outputTokens: number, estimatedCostMicros: number): void {
    this.assertCount(outputTokens, 'outputTokens');
    this.assertCount(estimatedCostMicros, 'estimatedCostMicros');
    this.outputTokens += outputTokens;
    this.estimatedCostMicros += estimatedCostMicros;
  }

  recordSchemaFailure(): void {
    this.schemaFailureCount += 1;
  }

  recordRetry(): void {
    this.retryCount += 1;
  }

  recordRetrieval(untrusted: RetrievalTraceMetadata): void {
    if (this.rag) throw new Error('RAG retrieval was already recorded');
    const activeStepIndex = this.steps.findIndex(
      (step) =>
        step.stepName === 'search_learning_materials' &&
        step.status === 'STARTED',
    );
    if (activeStepIndex < 0) {
      throw new Error('RAG retrieval requires an active search step');
    }
    const safe = redactRagTraceMetadata(untrusted);
    this.assertRetrievalMetadata(safe);
    this.rag = Object.freeze(safe) as RetrievalTraceMetadata;
    const activeStep = this.steps[activeStepIndex]!;
    this.steps[activeStepIndex] = Object.freeze({
      ...activeStep,
      metadata: redactCoachPayload({ ...activeStep.metadata, rag: this.rag }),
    });
  }

  recordGrounding(
    claims: readonly Readonly<{
      resultPath: string;
      citationIds: readonly string[];
    }>[],
  ): void {
    if (!this.rag) {
      if (claims.length === 0) return;
      throw new Error('Grounded claims require a RAG retrieval');
    }
    if (this.groundingRecorded) {
      throw new Error('RAG grounding was already recorded');
    }
    const available = new Set(
      this.rag.rankings.map((ranking) => ranking.citationId),
    );
    const used = new Set(claims.flatMap((claim) => [...claim.citationIds]));
    if ([...used].some((citationId) => !available.has(citationId))) {
      throw new Error('Grounding references an unavailable Citation');
    }
    const next = redactRagTraceMetadata({
      ...this.rag,
      rankings: this.rag.rankings.map((ranking) => ({
        ...ranking,
        decision: used.has(ranking.citationId) ? 'used' : 'unused',
      })),
      usedCitationIds: [...used],
      unusedCitationIds: this.rag.rankings
        .map((ranking) => ranking.citationId)
        .filter((citationId) => !used.has(citationId)),
      claimCitations: claims.map((claim) => ({
        claimPath: claim.resultPath,
        citationIds: [...claim.citationIds],
      })),
    });
    this.assertRetrievalMetadata(next);
    this.rag = Object.freeze(next) as RetrievalTraceMetadata;
    this.groundingRecorded = true;
    const searchStepIndex = this.steps.findLastIndex(
      (step) => step.stepName === 'search_learning_materials',
    );
    if (searchStepIndex >= 0) {
      const step = this.steps[searchStepIndex]!;
      this.steps[searchStepIndex] = Object.freeze({
        ...step,
        metadata: redactCoachPayload({ ...step.metadata, rag: this.rag }),
      });
    }
  }

  setResultSchemaVersion(resultSchemaVersion: string): void {
    this.requireRun();
    if (this.terminalStatus) {
      throw new Error('Cannot change a terminal Trace');
    }
    if (!resultSchemaVersion.trim()) {
      throw new Error('Result schema version is required');
    }
    this.run = Object.freeze({ ...this.run!, resultSchemaVersion });
  }

  finishRun(input: {
    terminalStatus: CoachTraceTerminalStatus;
    resultType: string | null;
    finishedAtMs: number;
  }): void {
    this.requireRun();
    if (this.terminalStatus) throw new Error('Trace run is already terminal');
    if (input.finishedAtMs < this.run!.startedAtMs) {
      throw new Error('Trace duration cannot be negative');
    }
    this.terminalStatus = input.terminalStatus;
    this.resultType = input.resultType;
    this.finishedAtMs = input.finishedAtMs;
  }

  startStep(
    stepName: string,
    startedAtMs: number,
    metadata: Record<string, unknown> = {},
  ): CoachTraceStep {
    const existing = this.steps.find(
      (step) => step.stepName === stepName && step.status === 'STARTED',
    );
    if (existing) throw new Error('Trace step is already active');
    const step = Object.freeze({
      sequence: this.steps.length,
      stepName,
      status: 'STARTED' as const,
      startedAtMs,
      durationMs: null,
      metadata: redactCoachPayload(metadata),
    });
    this.steps.push(step);
    return step;
  }

  finishStep(
    stepName: string,
    status: Exclude<CoachTraceStepStatus, 'STARTED'>,
    finishedAtMs: number,
    metadata: Record<string, unknown> = {},
  ): CoachTraceStep {
    const index = this.steps.findIndex(
      (step) => step.stepName === stepName && step.status === 'STARTED',
    );
    if (index < 0) throw new Error('Trace step was not started');
    const started = this.steps[index];
    if (finishedAtMs < started.startedAtMs) {
      throw new Error('Trace time cannot move backwards');
    }
    const finished = Object.freeze({
      ...started,
      status,
      durationMs: finishedAtMs - started.startedAtMs,
      metadata: redactCoachPayload({ ...started.metadata, ...metadata }),
    });
    this.steps[index] = finished;
    return finished;
  }

  recordRecommendation(input: CoachRecommendationTrace): void {
    if (this.recommendation) {
      throw new Error('Trace recommendation was already recorded');
    }
    if (!ACTIONS.has(input.nextAction)) {
      throw new Error('Invalid recommendation action');
    }
    if (
      input.evidenceCodes.length === 0 ||
      input.evidenceCodes.some((code) => !RECOMMENDATION_EVIDENCE.has(code))
    ) {
      throw new Error('Invalid recommendation evidence');
    }
    if (!SAVE_STATUSES.has(input.learningSaveStatus)) {
      throw new Error('Invalid recommendation save status');
    }
    this.recommendation = Object.freeze({
      nextAction: input.nextAction,
      evidenceCodes: Object.freeze([...new Set(input.evidenceCodes)]),
      learningSaveStatus: input.learningSaveStatus,
    });
  }

  snapshot():
    | CoachTraceSnapshot
    | Readonly<{
        traceId: string;
        traceSubjectId: string;
        steps: readonly CoachTraceStep[];
        recommendation: CoachRecommendationTrace | null;
      }> {
    const steps = Object.freeze(
      this.steps.map((step) => Object.freeze({ ...step })),
    );
    if (!this.run) {
      return Object.freeze({
        traceId: this.traceId,
        traceSubjectId: this.traceSubjectId,
        steps,
        recommendation: this.recommendation,
      });
    }
    return Object.freeze({
      traceId: this.traceId,
      traceSubjectId: this.traceSubjectId,
      ...this.run,
      ttftMs:
        this.firstTokenAtMs === null
          ? null
          : this.firstTokenAtMs - this.run.startedAtMs,
      totalDurationMs:
        this.finishedAtMs === null
          ? null
          : this.finishedAtMs - this.run.startedAtMs,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCostMicros: this.estimatedCostMicros,
      schemaFailureCount: this.schemaFailureCount,
      retryCount: this.retryCount,
      terminalStatus: this.terminalStatus,
      resultType: this.resultType,
      steps,
      recommendation: this.recommendation,
      rag: this.rag,
      feedback: null,
    });
  }

  async persist(writer: CoachTraceWriter): Promise<void> {
    this.requireRun();
    if (!this.terminalStatus)
      throw new Error('Cannot persist a non-terminal Trace');
    await writer.save(this.snapshot() as CoachTraceSnapshot);
  }

  private requireRun(): void {
    if (!this.run) throw new Error('Trace run is not configured');
  }

  private assertCount(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }

  private assertRetrievalMetadata(
    value: Partial<RetrievalTraceMetadata>,
  ): asserts value is RetrievalTraceMetadata {
    const requiredScalars = [
      value.metadataVersion,
      value.queryHash,
      value.status,
      value.tokenCountMode,
    ];
    if (
      requiredScalars.some((item) => typeof item !== 'string') ||
      !value.appliedFilters ||
      !value.versions ||
      !value.counts ||
      !value.rankings ||
      !value.usedCitationIds ||
      !value.unusedCitationIds ||
      !value.claimCitations
    ) {
      throw new Error('RAG Trace metadata is incomplete');
    }
    for (const [name, count] of Object.entries(value.counts)) {
      this.assertCount(count, `rag.counts.${name}`);
    }
    for (const name of [
      'topK',
      'conflictCount',
      'deduplicatedCount',
      'retrievalDurationMs',
      'contextTokens',
    ] as const) {
      this.assertCount(value[name] as number, `rag.${name}`);
    }
    if (
      typeof value.minimumRelevance !== 'number' ||
      !Number.isFinite(value.minimumRelevance) ||
      value.minimumRelevance < 0 ||
      value.minimumRelevance > 1
    ) {
      throw new Error('RAG minimum relevance is invalid');
    }
    const counts = value.counts;
    if (
      counts.rawRecall < counts.accessEligible ||
      counts.accessEligible < counts.relevanceEligible ||
      counts.relevanceEligible < counts.deduplicated ||
      counts.deduplicated < counts.contextSelected
    ) {
      throw new Error(
        'RAG Trace stage counts must be monotonically decreasing',
      );
    }
    const used = new Set(value.usedCitationIds);
    if (value.unusedCitationIds.some((id) => used.has(id))) {
      throw new Error('Used and unused RAG citations must be distinct');
    }
    if (
      (value.status === 'success' && value.failureCode !== null) ||
      (value.status !== 'success' && value.failureCode === null)
    ) {
      throw new Error('RAG Trace status and failure code disagree');
    }
  }
}
