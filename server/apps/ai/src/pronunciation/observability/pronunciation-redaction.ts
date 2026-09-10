import {
  createTraceSubjectId,
  findCoachSensitiveMatches,
} from '../../coach/observability/coach-redaction';

const identifierKeys = new Set(['assessmentId', 'traceId']);

const tokenKeys = new Set([
  'status',
  'stepName',
  'errorCode',
  'exerciseType',
  'provider',
  'modelVersion',
  'terminalStatus',
  'confidenceTier',
  'learningWriteStatus',
  'currency',
  'resultSchemaVersion',
  'providerAdapterVersion',
  'providerApiVersion',
  'normalizationVersion',
  'alignmentVersion',
  'assessmentRuleVersion',
  'confidencePolicyVersion',
  'learningMappingVersion',
  'schedulerVersion',
  'budgetVersion',
  'priceVersion',
  'apiContractVersion',
  'capabilityVersion',
  'retryDecision',
  'responseHash',
  'inputHash',
]);

const integerKeys = new Set([
  'sequence',
  'durationMs',
  'targetWordCount',
  'targetCharacterCount',
  'audioByteSize',
  'audioDurationMs',
  'uploadDurationMs',
  'queueDurationMs',
  'decodeDurationMs',
  'providerDurationMs',
  'totalDurationMs',
  'retryCount',
  'learningWriteCount',
  'attemptNo',
  'latencyMs',
  'billableDurationMs',
]);

const decimalKeys = new Set([
  'confidence',
  'estimatedCost',
  'actualCost',
  'cost',
]);

const booleanKeys = new Set([
  'cancelled',
  'timedOut',
  'degraded',
  'providerAccepted',
  'lateResultDiscarded',
]);

const mediaTypePattern = /^audio\/[a-z0-9.+-]+(?:;codecs=[a-z0-9.,+-]+)?$/i;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const tokenPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

function safeString(value: unknown, pattern: RegExp): string | undefined {
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    findCoachSensitiveMatches(value).length > 0
  ) {
    return undefined;
  }
  return value;
}

function safeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function safeDecimal(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Reuses Coach's HMAC primitive while keeping the pronunciation namespace
 * distinct so values cannot be joined across features.
 */
export function createPronunciationTraceSubjectId(
  subjectId: string,
  pepper: string,
): string {
  return createTraceSubjectId(`pronunciation:${subjectId}`, pepper).replace(
    /^ts_/,
    'pts_',
  );
}

/**
 * Builds trace/log metadata from an explicit scalar allowlist. It deliberately
 * cannot serialize arbitrary objects, arrays, text, bytes or storage addresses.
 */
export function redactPronunciationPayload(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean>> {
  const output: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(payload)) {
    let safe: string | number | boolean | undefined;
    if (identifierKeys.has(key)) {
      safe = safeString(value, identifierPattern);
    } else if (key === 'traceSubjectId') {
      safe =
        typeof value === 'string' && /^pts_[a-f0-9]{64}$/.test(value)
          ? value
          : undefined;
    } else if (key === 'audioMediaType') {
      safe = safeString(value, mediaTypePattern);
    } else if (tokenKeys.has(key)) {
      safe = safeString(value, tokenPattern);
    } else if (integerKeys.has(key)) {
      safe = safeInteger(value);
    } else if (decimalKeys.has(key)) {
      safe = safeDecimal(value);
    } else if (booleanKeys.has(key) && typeof value === 'boolean') {
      safe = value;
    }

    if (safe !== undefined) output[key] = safe;
  }

  return Object.freeze(output);
}
