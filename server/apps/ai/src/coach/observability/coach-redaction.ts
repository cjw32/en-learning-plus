import { createHmac } from 'node:crypto';

const allowedKeys = new Set([
  'requestId',
  'traceId',
  'traceSubjectId',
  'status',
  'sequence',
  'stepName',
  'toolName',
  'durationMs',
  'ttftMs',
  'totalDurationMs',
  'inputTokens',
  'outputTokens',
  'toolCallCount',
  'schemaFailureCount',
  'retryCount',
  'errorCode',
  'resultType',
  'promptVersion',
  'promptHash',
  'modelProvider',
  'modelName',
  'modelVersion',
  'estimatedCostMicros',
  'currency',
  'sourceIds',
  'counts',
]);

const sensitivePatterns = [
  ['jwt', /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/i],
  ['refresh_token', /\brefresh[-_\s]?token\b/i],
  ['api_key', /\bsk-[A-Za-z0-9_-]{8,}\b/i],
  [
    'database_url',
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/i,
  ],
  ['system_prompt', /\bsystem\s+prompt\b/i],
  [
    'reasoning',
    /\b(?:chain[- ]of[- ]thought|private\s+reasoning|raw\s+reasoning)\b/i,
  ],
  ['answer_key', /\banswer\s*key\b/i],
  ['stack', /(?:^|\n)\s*at\s+[^\n]+:\d+(?::\d+)?/i],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['phone', /(?<!\d)1[3-9]\d{9}(?!\d)/],
  ['cross_user_canary', /\bother[-_ ]user[-_ ][A-Za-z0-9_-]*canary\b/i],
] as const;

export function findCoachSensitiveMatches(value: string): string[] {
  return sensitivePatterns
    .filter(([, pattern]) => pattern.test(value))
    .map(([name]) => name);
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return findCoachSensitiveMatches(value).length > 0 ? '[REDACTED]' : value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactValue(item),
      ]),
    );
  }
  return value;
}

export function createTraceSubjectId(
  subjectId: string,
  pepper: string,
): string {
  if (!subjectId.trim() || !pepper.trim()) {
    throw new Error('Trace subject inputs are required');
  }
  return `ts_${createHmac('sha256', pepper).update(subjectId).digest('hex')}`;
}

export function redactCoachPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(payload)
        .filter(([key]) => allowedKeys.has(key))
        .map(([key, value]) => [key, redactValue(value)]),
    ),
  );
}
