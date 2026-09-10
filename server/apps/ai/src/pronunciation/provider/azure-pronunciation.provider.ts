import { z } from '@en/common/coach/zod';
import {
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  type PronunciationProviderAssessmentInput,
  type PronunciationProviderFailure,
  type PronunciationProviderResult,
  pronunciationProviderResultSchema,
} from '@en/common/pronunciation';
import type { PronunciationAssessmentProvider } from './pronunciation-assessment.provider';

const AZURE_PROVIDER = 'azure';
const MAX_PROVIDER_DURATION_MS = 30_000;
const TICKS_PER_MILLISECOND = 10_000;
const FORBIDDEN_APPROVAL_VALUES = new Set([
  '',
  'unknown',
  'placeholder',
  'replace-me',
  'todo',
  'tbd',
]);

const azureWordSchema = z
  .object({
    Word: z.string().trim().min(1).max(100),
    Offset: z.number().int().nonnegative().optional(),
    Duration: z.number().int().nonnegative().optional(),
    AccuracyScore: z.number().min(0).max(100).nullable().optional(),
    ErrorType: z.string().trim().min(1).max(64).optional(),
  })
  .passthrough();

const azureSuccessSchema = z
  .object({
    RecognitionStatus: z.literal('Success'),
    Duration: z.union([z.number(), z.string()]).optional(),
    NBest: z
      .array(
        z
          .object({
            Confidence: z.number().min(0).max(1),
            Lexical: z.string().max(500),
            AccuracyScore: z.number().min(0).max(100),
            FluencyScore: z.number().min(0).max(100),
            CompletenessScore: z.number().min(0).max(100),
            PronScore: z.number().min(0).max(100),
            ProsodyScore: z.number().min(0).max(100).optional(),
            Words: z.array(azureWordSchema).max(90),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const azureRecognitionSchema = z
  .object({
    RecognitionStatus: z.string().trim().min(1).max(64),
  })
  .passthrough();

export type AzurePronunciationProviderConfig = Readonly<{
  enabled: boolean;
  providerApproved: boolean;
  resourceName: string | null;
  subscriptionKey: string | null;
  region: string | null;
  approvedRegion: string | null;
  privacyEvidenceVersion: string | null;
  modelVersion: string | null;
  modelIdentityEvidenceVersion: string | null;
  modelIdentityVendorAttested: boolean;
  modelIdentityImmutable: boolean;
  modelIdentityQueryable: boolean;
  adapterVersion: string;
  apiContractVersion: string;
  capabilityVersion: string;
  priceVersion: string | null;
  budgetPolicyVersion: string | null;
  currency: string | null;
  prosodyApproved: boolean;
}>;

export type AzurePronunciationCostReservation = Readonly<{
  reservationId: string;
  estimatedCostMicros: number;
  currency: string;
  priceVersion: string;
  budgetPolicyVersion: string;
}>;

export interface AzurePronunciationCostGate {
  reserve(
    input: Readonly<{
      assessmentId: string;
      provider: typeof AZURE_PROVIDER;
      modelVersion: string;
      region: string;
      capability: 'BASE' | 'PROSODY';
      durationMs: number;
      currency: string;
      priceVersion: string;
      budgetPolicyVersion: string;
    }>,
  ): Promise<AzurePronunciationCostReservation>;
  settle(reservationId: string, actualCostMicros: number): Promise<void>;
  release(reservationId: string): Promise<void>;
}

export class AzurePronunciationApprovalError extends Error {
  readonly code = 'PROVIDER_NOT_APPROVED';

  constructor(message = 'Azure pronunciation Provider is not approved') {
    super(message);
    this.name = 'AzurePronunciationApprovalError';
  }
}

export class AzurePronunciationAudioError extends Error {
  readonly code = 'AUDIO_INVALID';

  constructor(message = 'Canonical pronunciation audio is invalid') {
    super(message);
    this.name = 'AzurePronunciationAudioError';
  }
}

type ApprovedAzureConfig = Readonly<{
  resourceName: string;
  region: string;
  privacyEvidenceVersion: string;
  modelVersion: string;
  modelIdentityEvidenceVersion: string;
  adapterVersion: string;
  apiContractVersion: string;
  capabilityVersion: string;
  priceVersion: string;
  budgetPolicyVersion: string;
  currency: string;
  subscriptionKey: string;
  prosodyApproved: boolean;
}>;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function approvedText(value: string | null): value is string {
  return Boolean(
    value && !FORBIDDEN_APPROVAL_VALUES.has(value.trim().toLowerCase()),
  );
}

function approveConfig(
  config: AzurePronunciationProviderConfig,
): ApprovedAzureConfig {
  if (
    !config.enabled ||
    !config.providerApproved ||
    !approvedText(config.resourceName) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.resourceName) ||
    !approvedText(config.subscriptionKey) ||
    !approvedText(config.region) ||
    !/^[a-z0-9-]+$/.test(config.region) ||
    config.region !== config.approvedRegion ||
    !approvedText(config.privacyEvidenceVersion) ||
    !approvedText(config.modelVersion) ||
    !approvedText(config.modelIdentityEvidenceVersion) ||
    !config.modelIdentityVendorAttested ||
    !config.modelIdentityImmutable ||
    !config.modelIdentityQueryable ||
    !approvedText(config.adapterVersion) ||
    !approvedText(config.apiContractVersion) ||
    !approvedText(config.capabilityVersion) ||
    !approvedText(config.priceVersion) ||
    !approvedText(config.budgetPolicyVersion) ||
    !approvedText(config.currency) ||
    !/^[A-Z]{3}$/.test(config.currency)
  ) {
    throw new AzurePronunciationApprovalError();
  }
  return config as ApprovedAzureConfig;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function canonicalWavDurationMs(bytes: Uint8Array): number {
  if (
    bytes.byteLength < 44 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WAVE'
  ) {
    throw new AzurePronunciationAudioError();
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate: number | null = null;
  let dataSize: number | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > bytes.byteLength) {
      throw new AzurePronunciationAudioError();
    }
    if (chunkId === 'fmt ') {
      if (
        chunkSize < 16 ||
        view.getUint16(dataOffset, true) !== 1 ||
        view.getUint16(dataOffset + 2, true) !== 1 ||
        view.getUint32(dataOffset + 4, true) !== 16_000 ||
        view.getUint16(dataOffset + 14, true) !== 16
      ) {
        throw new AzurePronunciationAudioError();
      }
      byteRate = view.getUint32(dataOffset + 8, true);
      if (byteRate !== 32_000) throw new AzurePronunciationAudioError();
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  if (byteRate === null || dataSize === null || dataSize <= 0) {
    throw new AzurePronunciationAudioError();
  }
  const durationMs = Math.ceil((dataSize * 1_000) / byteRate);
  if (durationMs < 1 || durationMs > MAX_PROVIDER_DURATION_MS) {
    throw new AzurePronunciationAudioError();
  }
  return durationMs;
}

function ticksToMilliseconds(value: number): number {
  return Math.round(value / TICKS_PER_MILLISECOND);
}

function mapWordError(value: string | undefined) {
  switch (value?.toLowerCase()) {
    case 'none':
      return 'NONE' as const;
    case 'mispronunciation':
      return 'MISPRONUNCIATION' as const;
    case 'omission':
      return 'OMISSION' as const;
    case 'insertion':
      return 'INSERTION' as const;
    default:
      return 'UNKNOWN' as const;
  }
}

function boundedLatency(startedAt: number, now: () => number): number {
  return Math.max(0, Math.min(MAX_PROVIDER_DURATION_MS, now() - startedAt));
}

function retryAfterSeconds(response: Response): number | null {
  const value = Number(response.headers.get('retry-after'));
  return Number.isSafeInteger(value) && value >= 1 && value <= 86_400
    ? value
    : null;
}

export class AzurePronunciationAssessmentProvider implements PronunciationAssessmentProvider {
  private readonly config: ApprovedAzureConfig;

  constructor(
    config: AzurePronunciationProviderConfig,
    private readonly costGate: AzurePronunciationCostGate,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.config = approveConfig(config);
    if (!costGate || typeof costGate.reserve !== 'function') {
      throw new AzurePronunciationApprovalError(
        'An approved price and budget gate is required',
      );
    }
  }

  async assess(
    input: PronunciationProviderAssessmentInput,
    signal?: AbortSignal,
  ): Promise<PronunciationProviderResult> {
    const startedAt = this.now();
    const deadline = Math.min(
      input.deadlineAt.getTime(),
      startedAt + MAX_PROVIDER_DURATION_MS,
    );
    if (!Number.isFinite(deadline) || deadline <= startedAt) {
      return this.failure('TIMEOUT', false, null, 0, 0, null);
    }
    if (signal?.aborted) {
      return this.failure('CANCELLED', false, null, 0, 0, null);
    }

    const durationMs = canonicalWavDurationMs(input.canonicalAudio);
    const prosodyRequested =
      this.config.prosodyApproved && input.locale === 'en-US';
    const reservation = await this.costGate.reserve({
      assessmentId: input.assessmentId,
      provider: AZURE_PROVIDER,
      modelVersion: this.config.modelVersion,
      region: this.config.region,
      capability: prosodyRequested ? 'PROSODY' : 'BASE',
      durationMs,
      currency: this.config.currency,
      priceVersion: this.config.priceVersion,
      budgetPolicyVersion: this.config.budgetPolicyVersion,
    });
    this.assertReservation(reservation);

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error('AZURE_PRONUNCIATION_TIMEOUT')),
      deadline - startedAt,
    );
    let requestSent = false;
    try {
      requestSent = true;
      const response = await this.fetchImplementation(
        this.buildUrl(input.locale),
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
            'Ocp-Apim-Subscription-Key': this.config.subscriptionKey,
            'Pronunciation-Assessment': this.assessmentHeader(
              input.referenceText,
              prosodyRequested,
            ),
          },
          body: input.canonicalAudio as BodyInit,
          signal: controller.signal,
        },
      );
      await this.costGate.settle(
        reservation.reservationId,
        reservation.estimatedCostMicros,
      );
      const latencyMs = boundedLatency(startedAt, this.now);
      const providerRequestId =
        response.headers.get('x-requestid') ??
        response.headers.get('x-microsoftspeechservices-sessionid');
      if (!response.ok) {
        const outcome =
          response.status === 429
            ? 'RATE_LIMITED'
            : response.status === 408 || response.status === 504
              ? 'TIMEOUT'
              : 'SERVICE_ERROR';
        return this.failure(
          outcome,
          response.status === 429 || response.status >= 500,
          retryAfterSeconds(response),
          latencyMs,
          reservation.estimatedCostMicros,
          providerRequestId,
          true,
          durationMs,
        );
      }
      return await this.mapSuccess(
        response,
        latencyMs,
        durationMs,
        reservation.estimatedCostMicros,
        providerRequestId,
        prosodyRequested,
      );
    } catch (error) {
      if (requestSent) {
        await this.costGate.settle(
          reservation.reservationId,
          reservation.estimatedCostMicros,
        );
      } else {
        await this.costGate.release(reservation.reservationId);
      }
      const cancelled = signal?.aborted === true;
      const timedOut = controller.signal.aborted && !cancelled;
      return this.failure(
        cancelled ? 'CANCELLED' : timedOut ? 'TIMEOUT' : 'SERVICE_ERROR',
        !cancelled && !timedOut,
        null,
        boundedLatency(startedAt, this.now),
        reservation.estimatedCostMicros,
        null,
        null,
        durationMs,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  private buildUrl(locale: string): string {
    const url = new URL(
      `https://${this.config.resourceName}.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1`,
    );
    url.searchParams.set('language', locale);
    url.searchParams.set('format', 'detailed');
    return url.toString();
  }

  private assessmentHeader(referenceText: string, prosody: boolean): string {
    return Buffer.from(
      JSON.stringify({
        ReferenceText: referenceText,
        GradingSystem: 'HundredMark',
        Granularity: 'Word',
        Dimension: 'Comprehensive',
        EnableMiscue: 'True',
        ...(prosody ? { EnableProsodyAssessment: 'True' } : {}),
      }),
      'utf8',
    ).toString('base64');
  }

  private async mapSuccess(
    response: Response,
    latencyMs: number,
    durationMs: number,
    costMicros: number,
    providerRequestId: string | null,
    prosodyRequested: boolean,
  ): Promise<PronunciationProviderResult> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return this.failure(
        'INVALID_RESPONSE',
        false,
        null,
        latencyMs,
        costMicros,
        providerRequestId,
        true,
        durationMs,
      );
    }
    const recognition = azureRecognitionSchema.safeParse(body);
    if (!recognition.success) {
      return this.failure(
        'INVALID_RESPONSE',
        false,
        null,
        latencyMs,
        costMicros,
        providerRequestId,
        true,
        durationMs,
      );
    }
    if (recognition.data.RecognitionStatus !== 'Success') {
      return this.failure(
        'UNRECOGNIZABLE',
        false,
        null,
        latencyMs,
        costMicros,
        providerRequestId,
        true,
        durationMs,
      );
    }
    const parsed = azureSuccessSchema.safeParse(body);
    if (!parsed.success) {
      return this.failure(
        'INVALID_RESPONSE',
        false,
        null,
        latencyMs,
        costMicros,
        providerRequestId,
        true,
        durationMs,
      );
    }
    const best = parsed.data.NBest[0];
    const candidate = {
      ...this.base(latencyMs, durationMs, costMicros, providerRequestId, true),
      outcome: 'SUCCESS' as const,
      recognizedText: best.Lexical,
      recognitionConfidence: best.Confidence,
      scores: {
        overall: best.PronScore,
        accuracy: best.AccuracyScore,
        completeness: best.CompletenessScore,
        fluency: best.FluencyScore,
        prosody: prosodyRequested ? (best.ProsodyScore ?? null) : null,
      },
      words: best.Words.map((word, sequence) => {
        const hasTimestamp =
          word.Offset !== undefined && word.Duration !== undefined;
        return {
          sequence,
          lexicalForm: word.Word,
          offsetMs: hasTimestamp ? ticksToMilliseconds(word.Offset!) : null,
          durationMs: hasTimestamp ? ticksToMilliseconds(word.Duration!) : null,
          score: word.AccuracyScore ?? null,
          errorType: mapWordError(word.ErrorType),
        };
      }),
    };
    const result = pronunciationProviderResultSchema.safeParse(candidate);
    return result.success
      ? result.data
      : this.failure(
          'INVALID_RESPONSE',
          false,
          null,
          latencyMs,
          costMicros,
          providerRequestId,
          true,
          durationMs,
        );
  }

  private base(
    latencyMs: number,
    billableDurationMs: number,
    costMicros: number,
    providerRequestId: string | null,
    providerAccepted: boolean | null,
  ) {
    return {
      schemaVersion: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
      provider: AZURE_PROVIDER,
      modelVersion: this.config.modelVersion,
      adapterVersion: this.config.adapterVersion,
      apiContractVersion: this.config.apiContractVersion,
      capabilityVersion: this.config.capabilityVersion,
      providerAccepted,
      providerRequestId,
      latencyMs,
      billableDurationMs,
      cost: costMicros / 1_000_000,
      currency: this.config.currency,
      priceVersion: this.config.priceVersion,
    };
  }

  private failure(
    outcome: PronunciationProviderFailure['outcome'],
    retryable: boolean,
    retryAfter: number | null,
    latencyMs: number,
    costMicros: number,
    providerRequestId: string | null,
    providerAccepted: boolean | null = false,
    billableDurationMs = 0,
  ): PronunciationProviderFailure {
    return pronunciationProviderResultSchema.parse({
      ...this.base(
        latencyMs,
        billableDurationMs,
        costMicros,
        providerRequestId,
        providerAccepted,
      ),
      outcome,
      retryable,
      retryAfterSeconds: retryAfter,
    }) as PronunciationProviderFailure;
  }

  private assertReservation(
    reservation: AzurePronunciationCostReservation,
  ): void {
    if (
      !reservation.reservationId ||
      !Number.isSafeInteger(reservation.estimatedCostMicros) ||
      reservation.estimatedCostMicros < 0 ||
      reservation.currency !== this.config.currency ||
      reservation.priceVersion !== this.config.priceVersion ||
      reservation.budgetPolicyVersion !== this.config.budgetPolicyVersion
    ) {
      throw new AzurePronunciationApprovalError(
        'Price or budget reservation does not match the approved configuration',
      );
    }
  }
}
