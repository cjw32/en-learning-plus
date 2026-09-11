import { createHmac } from 'node:crypto';

const ALLOWED_DIAGNOSTIC_KEYS = new Set([
  'authorizationVersion',
  'budgetResult',
  'cancelled',
  'capabilityName',
  'capabilityType',
  'capabilityVersion',
  'component',
  'concurrencyResult',
  'costMicros',
  'deadlineMs',
  'durationMs',
  'estimated',
  'inputTokens',
  'operation',
  'outputBytes',
  'outputTokens',
  'policyVersion',
  'protocolEra',
  'protocolVersion',
  'rateLimitResult',
  'retryCount',
  'safeErrorCode',
  'schemaValidated',
  'schemaVersion',
  'status',
  'stepType',
  'timedOut',
  'verificationMethodVersion',
  'version',
  'writeOutcome',
]);

export function hashMcpIdentifier(value: string, hmacKey: string): string {
  if (!value || !hmacKey)
    throw new Error('MCP HMAC input and key are required');
  return createHmac('sha256', hmacKey).update(value).digest('hex');
}

export function redactMcpDiagnostic(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactMcpDiagnostic);
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => ALLOWED_DIAGNOSTIC_KEYS.has(key))
      .map(([key, item]) => [key, redactMcpDiagnostic(item)]),
  );
}
