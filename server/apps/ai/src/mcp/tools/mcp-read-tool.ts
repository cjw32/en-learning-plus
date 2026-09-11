import { MCP_SCHEMA_VERSION } from '@en/common/mcp';

export const MCP_READ_TOOL_MAX_RESULT_BYTES = 256 * 1024;

export type McpToolExecution = Readonly<{
  deadline?: Date;
  signal?: AbortSignal;
}>;

export class McpReadToolError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'CURSOR_INVALID'
      | 'DATA_NOT_AVAILABLE'
      | 'SOURCE_RIGHTS_DENIED'
      | 'CANCELLED'
      | 'TIMEOUT'
      | 'INTERNAL_ERROR',
  ) {
    super('The read Tool request could not be completed.');
    this.name = 'McpReadToolError';
  }
}

export function createReadToolDefinition(
  input: Readonly<{
    name: string;
    description: string;
    inputSchema: object;
    outputSchema: object;
    deadlineMs: number;
    budgetPolicy: 'none' | 'mcp-rag-read.v1';
  }>,
) {
  return Object.freeze({
    description: input.description,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    annotations: Object.freeze({
      readOnlyHint: true as const,
      destructiveHint: false as const,
      idempotentHint: true as const,
      openWorldHint: false as const,
    }),
    _meta: Object.freeze({
      'en-learning/schemaVersion': MCP_SCHEMA_VERSION,
      'en-learning/requiredScopes': Object.freeze(['learning:read']),
      'en-learning/effect': 'read',
      'en-learning/confirmation': 'none',
      'en-learning/idempotency': 'safe_repeat',
      'en-learning/maxResultBytes': MCP_READ_TOOL_MAX_RESULT_BYTES,
      'en-learning/deadlineMs': input.deadlineMs,
      'en-learning/rateLimitPolicy': 'mcp-read.v1',
      'en-learning/budgetPolicy': input.budgetPolicy,
      'en-learning/retryPolicy': 'safe-read.v1',
      'en-learning/degradation': 'empty-success-or-stable-error',
      'en-learning/operationId': `mcp.tool.${input.name}.v1`,
    }),
  });
}

export function assertExecutionOpen(execution?: McpToolExecution): void {
  if (execution?.signal?.aborted) {
    throw new McpReadToolError('CANCELLED');
  }
  if (execution?.deadline && execution.deadline.getTime() <= Date.now()) {
    throw new McpReadToolError('TIMEOUT');
  }
}

const unsafeControlQuery =
  /(?:\b(?:file|https?):\/\/|\b(?:select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|drop\s+(?:table|database))\b|\b(?:PrismaService|child_process|exec|spawn|findMany|queryRaw)\s*(?:\.|\())/iu;

export function normalizeSafeQuery(value: string): string {
  const query = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!query || unsafeControlQuery.test(query)) {
    throw new McpReadToolError('VALIDATION_FAILED');
  }
  return query;
}

export function assertBoundedResult(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new McpReadToolError('INTERNAL_ERROR');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MCP_READ_TOOL_MAX_RESULT_BYTES) {
    throw new McpReadToolError('INTERNAL_ERROR');
  }
}
