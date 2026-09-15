import { PronunciationBudgetError } from '../governance/pronunciation-budget.service';
import { PronunciationAdmissionError } from '../governance/pronunciation-admission.service';
import { PronunciationPriceUnavailableError } from '../governance/pronunciation-price.catalog';
import { createHash } from 'node:crypto';
import {
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  pronunciationProviderResultSchema,
  type PronunciationProviderAssessmentInput,
  type PronunciationProviderFailure,
  type PronunciationProviderResult,
} from '@en/common/pronunciation';
import type { PronunciationAssessmentProvider } from './pronunciation-assessment.provider';

type RetryDecision =
  | 'NOT_NEEDED'
  | 'SAFE_NOT_ACCEPTED'
  | 'PROVIDER_IDEMPOTENT'
  | 'UNKNOWN_ACCEPTANCE_NO_RETRY'
  | 'LIMIT_REACHED';

type AttemptStatus =
  | 'SUCCEEDED'
  | 'UNRECOGNIZABLE'
  | 'TIMED_OUT'
  | 'RATE_LIMITED'
  | 'CANCELLED'
  | 'FAILED'
  | 'INVALID_RESPONSE';

export interface PronunciationProviderAttemptLedger {
  start(
    input: Readonly<{
      assessmentId: string;
      attemptNo: number;
      provider: string;
      modelVersion: string;
      providerAdapterVersion: string;
      apiContractVersion: string;
      capabilityVersion: string;
      applicationConnectionId: string;
      inputHash: string;
      startedAt: Date;
      currency: string;
      priceVersion: string;
    }>,
  ): Promise<unknown>;
  finish(
    input: Readonly<{
      assessmentId: string;
      attemptNo: number;
      status: AttemptStatus;
      providerAccepted: boolean | null;
      providerRequestId: string | null;
      finishedAt: Date;
      latencyMs: number;
      billableDurationMs: number;
      actualCostMicros: number;
      failureCode: string | null;
      retryDecision: RetryDecision;
      responseHash: string;
    }>,
  ): Promise<boolean>;
}

export type PronunciationProviderExecutorConfig = Readonly<{
  provider: string;
  modelVersion: string;
  adapterVersion: string;
  apiContractVersion: string;
  capabilityVersion: string;
  currency: string;
  priceVersion: string;
  providerRequestsIdempotent: boolean;
}>;

type ExecutorOptions = Readonly<{
  createConnectionId?: () => string;
  now?: () => Date;
}>;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function inputHash(input: PronunciationProviderAssessmentInput): string {
  return sha256(
    JSON.stringify({
      assessmentId: input.assessmentId,
      referenceTextHash: sha256(input.referenceText),
      audioHash: sha256(input.canonicalAudio),
      locale: input.locale,
      deadlineAt: input.deadlineAt.toISOString(),
    }),
  );
}

function attemptStatus(result: PronunciationProviderResult): AttemptStatus {
  return {
    SUCCESS: 'SUCCEEDED',
    UNRECOGNIZABLE: 'UNRECOGNIZABLE',
    TIMEOUT: 'TIMED_OUT',
    RATE_LIMITED: 'RATE_LIMITED',
    CANCELLED: 'CANCELLED',
    SERVICE_ERROR: 'FAILED',
    INVALID_RESPONSE: 'INVALID_RESPONSE',
  }[result.outcome] as AttemptStatus;
}

export class PronunciationProviderExecutor {
  private readonly createConnectionId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly provider: PronunciationAssessmentProvider,
    private readonly ledger: PronunciationProviderAttemptLedger,
    private readonly config: PronunciationProviderExecutorConfig,
    options: ExecutorOptions = {},
  ) {
    this.createConnectionId =
      options.createConnectionId ??
      (() =>
        `pc_${createHash('sha256').update(crypto.randomUUID()).digest('hex')}`);
    this.now = options.now ?? (() => new Date());
  }

  async execute(
    input: PronunciationProviderAssessmentInput,
    signal?: AbortSignal,
  ): Promise<PronunciationProviderResult> {
    for (let attemptNo = 1; attemptNo <= 2; attemptNo += 1) {
      const applicationConnectionId = this.createConnectionId();
      await this.ledger.start({
        assessmentId: input.assessmentId,
        attemptNo,
        provider: this.config.provider,
        modelVersion: this.config.modelVersion,
        providerAdapterVersion: this.config.adapterVersion,
        apiContractVersion: this.config.apiContractVersion,
        capabilityVersion: this.config.capabilityVersion,
        applicationConnectionId,
        inputHash: inputHash(input),
        startedAt: this.now(),
        currency: this.config.currency,
        priceVersion: this.config.priceVersion,
      });

      let result: PronunciationProviderResult;
      try {
        result = await this.invoke(
          { ...input, applicationConnectionId },
          signal,
        );
      } catch (error) {
        await this.ledger.finish({
          assessmentId: input.assessmentId,
          attemptNo,
          status: 'FAILED',
          providerAccepted: false,
          providerRequestId: null,
          finishedAt: this.now(),
          latencyMs: 0,
          billableDurationMs: 0,
          actualCostMicros: 0,
          failureCode:
            error instanceof PronunciationBudgetError ||
            error instanceof PronunciationAdmissionError ||
            error instanceof PronunciationPriceUnavailableError
              ? error.code
              : 'INTERNAL_ERROR',
          retryDecision: 'NOT_NEEDED',
          responseHash: sha256('admission-rejected'),
        });
        throw error;
      }
      const retryDecision = this.retryDecision(result, attemptNo);
      await this.ledger.finish({
        assessmentId: input.assessmentId,
        attemptNo,
        status: attemptStatus(result),
        providerAccepted: result.providerAccepted,
        providerRequestId: result.providerRequestId,
        finishedAt: this.now(),
        latencyMs: result.latencyMs,
        billableDurationMs: result.billableDurationMs,
        actualCostMicros: Math.round(result.cost * 1_000_000),
        failureCode: result.outcome === 'SUCCESS' ? null : result.outcome,
        retryDecision,
        responseHash: sha256(JSON.stringify(result)),
      });
      if (
        retryDecision !== 'SAFE_NOT_ACCEPTED' &&
        retryDecision !== 'PROVIDER_IDEMPOTENT'
      ) {
        return result;
      }
    }
    throw new Error('PRONUNCIATION_PROVIDER_RETRY_STATE_INVALID');
  }

  private async invoke(
    input: PronunciationProviderAssessmentInput,
    signal?: AbortSignal,
  ): Promise<PronunciationProviderResult> {
    try {
      const parsed = pronunciationProviderResultSchema.safeParse(
        await this.provider.assess(input, signal),
      );
      return parsed.success ? parsed.data : this.invalidResponse();
    } catch (error) {
      if (
        error instanceof PronunciationBudgetError ||
        error instanceof PronunciationAdmissionError ||
        error instanceof PronunciationPriceUnavailableError
      )
        throw error;
      return this.invalidResponse();
    }
  }

  private retryDecision(
    result: PronunciationProviderResult,
    attemptNo: number,
  ): RetryDecision {
    if (result.outcome === 'SUCCESS') return 'NOT_NEEDED';
    if (result.providerAccepted === null) return 'UNKNOWN_ACCEPTANCE_NO_RETRY';
    if (!result.retryable) return 'NOT_NEEDED';
    if (attemptNo >= 2) return 'LIMIT_REACHED';
    if (result.providerAccepted === false) return 'SAFE_NOT_ACCEPTED';
    return this.config.providerRequestsIdempotent
      ? 'PROVIDER_IDEMPOTENT'
      : 'LIMIT_REACHED';
  }

  private invalidResponse(): PronunciationProviderFailure {
    return pronunciationProviderResultSchema.parse({
      schemaVersion: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
      provider: this.config.provider,
      modelVersion: this.config.modelVersion,
      adapterVersion: this.config.adapterVersion,
      apiContractVersion: this.config.apiContractVersion,
      capabilityVersion: this.config.capabilityVersion,
      providerAccepted: null,
      providerRequestId: null,
      latencyMs: 0,
      billableDurationMs: 0,
      cost: 0,
      currency: this.config.currency,
      priceVersion: this.config.priceVersion,
      outcome: 'INVALID_RESPONSE',
      retryable: false,
      retryAfterSeconds: null,
    }) as PronunciationProviderFailure;
  }
}
