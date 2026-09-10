import { aiApi } from "@/apis";
import {
  pronunciationAssessmentIdSchema,
  pronunciationIdempotencyKeySchema,
} from "@en/common/pronunciation";
import {
  parsePronunciationAssessmentPageResponse,
  parsePronunciationAssessmentResponse,
  type CreatePronunciationAssessment,
  type PronunciationAssessmentPageResponse,
  type PronunciationAssessmentResource,
  type PronunciationAssessmentResponse,
} from "./contracts";

const ACTIVE_STATUSES = new Set([
  "CREATED",
  "AUDIO_VALIDATING",
  "AUDIO_READY",
  "QUEUED",
  "PROCESSING",
]);

const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_MAX_WAIT_MS = 45_000;
export const PRONUNCIATION_MIN_AUDIO_DURATION_MS = 500;
export const PRONUNCIATION_MAX_AUDIO_DURATION_MS = 30_000;
export const PRONUNCIATION_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const PRONUNCIATION_UPLOAD_TIMEOUT_MS = 30_000;

export type PronunciationUploadValidationCode =
  | "AUDIO_TOO_SHORT"
  | "AUDIO_TOO_LONG"
  | "AUDIO_TOO_LARGE"
  | "AUDIO_TYPE_UNSUPPORTED";

export class PronunciationUploadValidationError extends Error {
  constructor(readonly code: PronunciationUploadValidationCode) {
    super(code);
    this.name = "PronunciationUploadValidationError";
  }
}

export type PronunciationUploadOptions = Readonly<{
  durationMs: number;
  signal?: AbortSignal;
}>;

export class PronunciationPollingError extends Error {
  constructor(readonly code: "CANCELLED" | "REQUEST_TIMEOUT") {
    super(code);
    this.name = "PronunciationPollingError";
  }
}

export type PronunciationPollOptions = Readonly<{
  signal?: AbortSignal;
  intervalMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}>;

function id(value: string): string {
  return encodeURIComponent(pronunciationAssessmentIdSchema.parse(value));
}

function key(value: string): string {
  return pronunciationIdempotencyKeySchema.parse(value);
}

function idempotencyHeaders(idempotencyKey: string) {
  return { headers: { "Idempotency-Key": key(idempotencyKey) } };
}

export function validatePronunciationAudioForUpload(
  audio: Blob,
  durationMs: number,
): void {
  if (
    !Number.isFinite(durationMs) ||
    durationMs < PRONUNCIATION_MIN_AUDIO_DURATION_MS
  ) {
    throw new PronunciationUploadValidationError("AUDIO_TOO_SHORT");
  }
  if (durationMs > PRONUNCIATION_MAX_AUDIO_DURATION_MS) {
    throw new PronunciationUploadValidationError("AUDIO_TOO_LONG");
  }
  if (audio.size > PRONUNCIATION_MAX_AUDIO_BYTES) {
    throw new PronunciationUploadValidationError("AUDIO_TOO_LARGE");
  }
  const mediaType = audio.type.toLowerCase().split(";", 1)[0];
  if (mediaType !== "audio/webm" && mediaType !== "audio/mp4") {
    throw new PronunciationUploadValidationError("AUDIO_TYPE_UNSUPPORTED");
  }
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PronunciationPollingError("CANCELLED"));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new PronunciationPollingError("CANCELLED"));
      },
      { once: true },
    );
  });
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new Error("INVALID_POLLING_BOUND");
  }
  return candidate;
}

export async function createPronunciationAssessment(
  input: CreatePronunciationAssessment,
  idempotencyKey: string,
): Promise<PronunciationAssessmentResponse> {
  const response = (await aiApi.post(
    "/pronunciation/assessments",
    input,
    idempotencyHeaders(idempotencyKey),
  )) as unknown;
  return parsePronunciationAssessmentResponse(response);
}

export async function uploadPronunciationAudio(
  assessmentId: string,
  audio: Blob,
  idempotencyKey: string,
  options: PronunciationUploadOptions,
): Promise<PronunciationAssessmentResponse> {
  validatePronunciationAudioForUpload(audio, options.durationMs);
  const body = new FormData();
  body.append(
    "audio",
    audio,
    audio.type === "audio/mp4" ? "recording.m4a" : "recording.webm",
  );
  const response = (await aiApi.put(
    `/pronunciation/assessments/${id(assessmentId)}/audio`,
    body,
    {
      ...idempotencyHeaders(idempotencyKey),
      signal: options.signal,
      timeout: PRONUNCIATION_UPLOAD_TIMEOUT_MS,
    },
  )) as unknown;
  return parsePronunciationAssessmentResponse(response);
}

export async function submitPronunciationAssessment(
  assessmentId: string,
  idempotencyKey: string,
): Promise<PronunciationAssessmentResponse> {
  const response = (await aiApi.post(
    `/pronunciation/assessments/${id(assessmentId)}/submit`,
    {},
    idempotencyHeaders(idempotencyKey),
  )) as unknown;
  return parsePronunciationAssessmentResponse(response);
}

export async function getPronunciationAssessment(
  assessmentId: string,
  signal?: AbortSignal,
): Promise<PronunciationAssessmentResponse> {
  const response = (await aiApi.get(
    `/pronunciation/assessments/${id(assessmentId)}`,
    { signal },
  )) as unknown;
  return parsePronunciationAssessmentResponse(response);
}

export async function listPronunciationAssessments(
  params?: Readonly<{
    cursor?: string;
    limit?: number;
  }>,
): Promise<PronunciationAssessmentPageResponse> {
  const response = (await aiApi.get("/pronunciation/assessments", {
    params,
  })) as unknown;
  return parsePronunciationAssessmentPageResponse(response);
}

export async function cancelPronunciationAssessment(
  assessmentId: string,
  idempotencyKey: string,
): Promise<PronunciationAssessmentResponse> {
  const response = (await aiApi.post(
    `/pronunciation/assessments/${id(assessmentId)}/cancel`,
    {},
    idempotencyHeaders(idempotencyKey),
  )) as unknown;
  return parsePronunciationAssessmentResponse(response);
}

export async function retryPronunciationAssessment(
  assessmentId: string,
  idempotencyKey: string,
): Promise<PronunciationAssessmentResponse> {
  const response = (await aiApi.post(
    `/pronunciation/assessments/${id(assessmentId)}/retry`,
    {},
    idempotencyHeaders(idempotencyKey),
  )) as unknown;
  return parsePronunciationAssessmentResponse(response);
}

export async function getPronunciationAudio(
  assessmentId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = (await aiApi.get(
    `/pronunciation/assessments/${id(assessmentId)}/audio`,
    { responseType: "blob", signal },
  )) as unknown;
  if (response instanceof Blob) return response;
  const data = (response as { data?: unknown })?.data;
  if (data instanceof Blob) return data;
  throw new Error("INVALID_AUDIO_RESPONSE");
}

export const deletePronunciationAudio = (
  assessmentId: string,
  idempotencyKey: string,
) =>
  aiApi.delete(`/pronunciation/assessments/${id(assessmentId)}/audio`, {
    ...idempotencyHeaders(idempotencyKey),
  });

export const deletePronunciationAssessment = (
  assessmentId: string,
  idempotencyKey: string,
) =>
  aiApi.delete(`/pronunciation/assessments/${id(assessmentId)}`, {
    ...idempotencyHeaders(idempotencyKey),
  });

export const getPronunciationDeletionStatus = (deletionId: string) => {
  if (!/^delete_[A-Za-z0-9_-]{10,48}$/.test(deletionId)) {
    throw new Error("INVALID_DELETION_ID");
  }
  return aiApi.get(
    `/pronunciation/deletions/${encodeURIComponent(deletionId)}`,
  );
};

export async function pollPronunciationAssessment(
  assessmentId: string,
  options: PronunciationPollOptions = {},
): Promise<PronunciationAssessmentResource> {
  const intervalMs = boundedInteger(
    options.intervalMs,
    DEFAULT_POLL_INTERVAL_MS,
    100,
    5_000,
  );
  const maxWaitMs = boundedInteger(
    options.maxWaitMs,
    DEFAULT_MAX_WAIT_MS,
    100,
    120_000,
  );
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  const startedAt = now();
  while (true) {
    if (options.signal?.aborted) {
      throw new PronunciationPollingError("CANCELLED");
    }
    let current: PronunciationAssessmentResource;
    try {
      current = (await getPronunciationAssessment(assessmentId, options.signal))
        .data;
    } catch (error) {
      if (options.signal?.aborted) {
        throw new PronunciationPollingError("CANCELLED");
      }
      throw error;
    }
    if (!ACTIVE_STATUSES.has(current.status)) return current;
    const elapsed = now() - startedAt;
    if (elapsed >= maxWaitMs) {
      throw new PronunciationPollingError("REQUEST_TIMEOUT");
    }
    await wait(Math.min(intervalMs, maxWaitMs - elapsed), options.signal);
  }
}

export async function submitAndPollPronunciationAssessment(
  assessmentId: string,
  idempotencyKey: string,
  options: PronunciationPollOptions = {},
): Promise<PronunciationAssessmentResource> {
  const accepted = await submitPronunciationAssessment(
    assessmentId,
    idempotencyKey,
  );
  if (!ACTIVE_STATUSES.has(accepted.data.status)) return accepted.data;
  return pollPronunciationAssessment(assessmentId, options);
}

export type * from "./contracts";
