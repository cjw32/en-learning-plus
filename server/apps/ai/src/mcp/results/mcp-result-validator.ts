import {
  MCP_READ_TOOL_MAX_RESULT_BYTES,
  McpReadToolError,
} from '../tools/mcp-read-tool';

type ParseResult<T> =
  | Readonly<{ success: true; data: T }>
  | Readonly<{ success: false }>;

export type McpResultSchema<T> = Readonly<{
  safeParse(value: unknown): ParseResult<T>;
}>;

const unsafeText =
  /(?:-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{12,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*[^\s]{8,}|<\/?SYSTEM>|\bsystem prompt\b|\bchain[- ]of[- ]thought\b)/iu;

function assertSafeTree(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): void {
  if (depth > 8) throw new McpReadToolError('INTERNAL_ERROR');
  if (typeof value === 'string') {
    if (unsafeText.test(value)) throw new McpReadToolError('INTERNAL_ERROR');
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) throw new McpReadToolError('INTERNAL_ERROR');
  seen.add(value);
  for (const child of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)) {
    assertSafeTree(child, depth + 1, seen);
  }
}

function assertSerializedBound(value: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new McpReadToolError('INTERNAL_ERROR');
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, 'utf8') > MCP_READ_TOOL_MAX_RESULT_BYTES
  ) {
    throw new McpReadToolError('INTERNAL_ERROR');
  }
}

function normalize(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

function assertMaterialProvenance(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const candidate = value as {
    retrievalStatus?: unknown;
    results?: unknown;
    conflicts?: unknown;
  };
  if (candidate.retrievalStatus === undefined) return;
  if (
    !Array.isArray(candidate.results) ||
    !Array.isArray(candidate.conflicts)
  ) {
    throw new McpReadToolError('INTERNAL_ERROR');
  }
  if (candidate.retrievalStatus === 'insufficient') {
    if (candidate.results.length || candidate.conflicts.length) {
      throw new McpReadToolError('INTERNAL_ERROR');
    }
    return;
  }
  if (candidate.retrievalStatus !== 'success' || !candidate.results.length) {
    throw new McpReadToolError('INTERNAL_ERROR');
  }
  for (const raw of candidate.results) {
    if (!raw || typeof raw !== 'object') {
      throw new McpReadToolError('INTERNAL_ERROR');
    }
    const result = raw as Record<string, unknown>;
    const citation = result.citation as Record<string, unknown> | undefined;
    if (
      !citation ||
      citation.status !== 'active' ||
      typeof citation.citationId !== 'string' ||
      typeof citation.source !== 'string' ||
      !citation.source ||
      typeof citation.title !== 'string' ||
      !citation.title ||
      citation.contentVersion !== result.contentVersion ||
      (citation.excerpt !== undefined && citation.excerpt !== result.excerpt)
    ) {
      throw new McpReadToolError('INTERNAL_ERROR');
    }
  }
}

export function validateMcpResult<T>(
  schema: McpResultSchema<T>,
  untrustedValue: unknown,
): T {
  assertSafeTree(untrustedValue);
  const normalized = normalize(untrustedValue);
  assertMaterialProvenance(normalized);
  assertSerializedBound(normalized);
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) throw new McpReadToolError('INTERNAL_ERROR');
  return parsed.data;
}
