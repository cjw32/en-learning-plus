import { findCoachSensitiveMatches } from '../../../../src/coach/observability/coach-redaction';

const forbiddenKeys =
  /^(?:api[-_]?key|authorization|cookie|password|secret|access[-_]?token|refresh[-_]?token|jwt|connection[-_]?string|database[-_]?url|rawAudio|systemPrompt|rawTranscript)$/i;
const additionalSensitive =
  /(?:Bearer\s+\S+|(?:https?|redis|rediss):\/\/[^\s]+|-----BEGIN .*PRIVATE KEY-----)/i;
export function safeDiagnostic(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.message
        : 'EXECUTION_ERROR';
  // Existing phone scanning matches digit substrings inside SHA-1/SHA-256.
  // Mask only complete cryptographic identifiers during scanning; preserve bytes.
  const scanText = text
    .replace(/\b(?:[a-f0-9]{40}|[a-f0-9]{64})\b/gi, '[CONTENT_HASH]')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '[UUID]',
    );
  return findCoachSensitiveMatches(scanText).length ||
    additionalSensitive.test(text)
    ? '[REDACTED_DIAGNOSTIC]'
    : text.slice(0, 1000);
}

export function assertSafePayload(value: unknown): void {
  const seen = new Set<object>();
  function visit(current: unknown, depth: number) {
    if (depth > 40) throw Error('PAYLOAD_TOO_DEEP');
    if (typeof current === 'string') {
      if (safeDiagnostic(current) === '[REDACTED_DIAGNOSTIC]')
        throw Error('SENSITIVE_PAYLOAD');
    } else if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw Error('NONFINITE_PAYLOAD');
    } else if (current !== null && typeof current === 'object') {
      if (seen.has(current)) throw Error('CYCLIC_PAYLOAD');
      seen.add(current);
      for (const [key, item] of Object.entries(current)) {
        if (forbiddenKeys.test(key)) throw Error('SENSITIVE_PAYLOAD_KEY');
        visit(item, depth + 1);
      }
      seen.delete(current);
    } else if (!['boolean', 'object'].includes(typeof current))
      throw Error('UNSERIALIZABLE_PAYLOAD');
  }
  visit(value, 0);
}
