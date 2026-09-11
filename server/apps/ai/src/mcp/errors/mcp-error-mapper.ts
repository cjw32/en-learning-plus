import {
  MCP_PUBLIC_ERROR_CODES,
  mcpSafeErrorSchema,
  type McpPublicErrorCode,
  type McpSafeError,
} from '@en/common/mcp';

const publicCodes = new Set<string>(MCP_PUBLIC_ERROR_CODES);

const SAFE_MESSAGES: Readonly<Record<McpPublicErrorCode, string>> =
  Object.freeze({
    UNAUTHENTICATED: 'Authentication is required.',
    INSUFFICIENT_SCOPE: 'The granted scope is insufficient.',
    CAPABILITY_UNAVAILABLE: 'The capability is unavailable.',
    VALIDATION_FAILED: 'The request is invalid.',
    RESOURCE_NOT_FOUND: 'The requested resource was not found.',
    CURSOR_INVALID: 'The pagination cursor is invalid.',
    DATA_NOT_AVAILABLE: 'The requested data is not available.',
    SOURCE_RIGHTS_DENIED: 'The source cannot be served.',
    IDEMPOTENCY_CONFLICT: 'The idempotency key is already in use.',
    IN_PROGRESS: 'The operation is still in progress.',
    CONFIRMATION_REQUIRED: 'User confirmation is required.',
    CONFIRMATION_PENDING: 'User confirmation is pending.',
    CONFIRMATION_INVALID: 'The confirmation is invalid or expired.',
    RATE_LIMITED: 'The request limit has been reached.',
    BUDGET_EXCEEDED: 'The execution budget has been exhausted.',
    CANCELLED: 'The operation was cancelled.',
    TIMEOUT: 'The operation timed out.',
    DEPENDENCY_UNAVAILABLE: 'A required dependency is unavailable.',
    INTERNAL_ERROR: 'The request could not be completed.',
  });

const RETRYABLE_CODES = new Set<McpPublicErrorCode>([
  'IN_PROGRESS',
  'RATE_LIMITED',
  'TIMEOUT',
  'DEPENDENCY_UNAVAILABLE',
]);

function errorCode(error: unknown): McpPublicErrorCode {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    if (code === 'CONCURRENCY_LIMITED') return 'RATE_LIMITED';
    if (publicCodes.has(code)) return code as McpPublicErrorCode;
  }
  return 'INTERNAL_ERROR';
}

export function mapMcpError(error: unknown, traceId: string): McpSafeError {
  const code = errorCode(error);
  const retryAfterSeconds =
    error &&
    typeof error === 'object' &&
    'retryAfterSeconds' in error &&
    Number.isSafeInteger(
      (error as { retryAfterSeconds?: unknown }).retryAfterSeconds,
    )
      ? Number((error as { retryAfterSeconds: number }).retryAfterSeconds)
      : undefined;

  return Object.freeze(
    mcpSafeErrorSchema.parse({
      schemaVersion: 'en-learning.mcp.v1',
      ok: false,
      code,
      message: SAFE_MESSAGES[code],
      retryable: RETRYABLE_CODES.has(code),
      ...(retryAfterSeconds && retryAfterSeconds > 0
        ? { retryAfterSeconds: Math.min(retryAfterSeconds, 3_600) }
        : {}),
      traceId,
    }),
  );
}
