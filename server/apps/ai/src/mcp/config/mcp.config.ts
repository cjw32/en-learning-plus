import { mcpEnvironmentSchema } from './mcp-config.schema';

export const MCP_RUNTIME_CONFIG = Symbol('MCP_RUNTIME_CONFIG');

export type McpRuntimeConfig = Readonly<{
  enabled: boolean;
  readEnabled: boolean;
  ragEnabled: boolean;
  quizEnabled: boolean;
  confirmationEnabled: boolean;
  submitEnabled: boolean;
  maxRequestBytes: number;
  maxResultBytes: number;
  maxToolCalls: number;
  maxRecursionDepth: number;
  maxParallelCalls: number;
  requestDeadlineMs: number;
  legacySessionIdleTtlSeconds: number;
  legacySessionAbsoluteTtlSeconds: number;
  confirmationTtlSeconds: number;
  metadataRetentionDays: number;
}>;

function enabled(value: 'true' | 'false' | undefined): boolean {
  return value === 'true';
}

function boundedInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return parsed;
}

function requireGate(
  gate: boolean,
  prerequisite: boolean,
  message: string,
): void {
  if (gate && !prerequisite) throw new Error(message);
}

export function resolveMcpRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): McpRuntimeConfig {
  const parsed = mcpEnvironmentSchema.parse(environment);
  const config: McpRuntimeConfig = Object.freeze({
    enabled: enabled(parsed.MCP_ENABLED),
    readEnabled: enabled(parsed.MCP_READ_ENABLED),
    ragEnabled: enabled(parsed.MCP_RAG_ENABLED),
    quizEnabled: enabled(parsed.MCP_QUIZ_ENABLED),
    confirmationEnabled: enabled(parsed.MCP_CONFIRMATION_ENABLED),
    submitEnabled: enabled(parsed.MCP_SUBMIT_ENABLED),
    maxRequestBytes: boundedInteger(
      'MCP_MAX_REQUEST_BYTES',
      parsed.MCP_MAX_REQUEST_BYTES,
      256 * 1024,
      1,
      256 * 1024,
    ),
    maxResultBytes: boundedInteger(
      'MCP_MAX_RESULT_BYTES',
      parsed.MCP_MAX_RESULT_BYTES,
      256 * 1024,
      1,
      256 * 1024,
    ),
    maxToolCalls: boundedInteger(
      'MCP_MAX_TOOL_CALLS',
      parsed.MCP_MAX_TOOL_CALLS,
      1,
      1,
      4,
    ),
    maxRecursionDepth: boundedInteger(
      'MCP_MAX_RECURSION_DEPTH',
      parsed.MCP_MAX_RECURSION_DEPTH,
      0,
      0,
      0,
    ),
    maxParallelCalls: boundedInteger(
      'MCP_MAX_PARALLEL_CALLS',
      parsed.MCP_MAX_PARALLEL_CALLS,
      1,
      1,
      4,
    ),
    requestDeadlineMs: boundedInteger(
      'MCP_REQUEST_DEADLINE_MS',
      parsed.MCP_REQUEST_DEADLINE_MS,
      30_000,
      1,
      30_000,
    ),
    legacySessionIdleTtlSeconds: boundedInteger(
      'MCP_LEGACY_SESSION_IDLE_TTL_SECONDS',
      parsed.MCP_LEGACY_SESSION_IDLE_TTL_SECONDS,
      15 * 60,
      1,
      15 * 60,
    ),
    legacySessionAbsoluteTtlSeconds: boundedInteger(
      'MCP_LEGACY_SESSION_ABSOLUTE_TTL_SECONDS',
      parsed.MCP_LEGACY_SESSION_ABSOLUTE_TTL_SECONDS,
      60 * 60,
      1,
      60 * 60,
    ),
    confirmationTtlSeconds: boundedInteger(
      'MCP_CONFIRMATION_TTL_SECONDS',
      parsed.MCP_CONFIRMATION_TTL_SECONDS,
      5 * 60,
      5 * 60,
      5 * 60,
    ),
    metadataRetentionDays: boundedInteger(
      'MCP_METADATA_RETENTION_DAYS',
      parsed.MCP_METADATA_RETENTION_DAYS,
      180,
      1,
      365,
    ),
  });

  for (const [name, gate] of [
    ['MCP_READ_ENABLED', config.readEnabled],
    ['MCP_RAG_ENABLED', config.ragEnabled],
    ['MCP_QUIZ_ENABLED', config.quizEnabled],
    ['MCP_CONFIRMATION_ENABLED', config.confirmationEnabled],
    ['MCP_SUBMIT_ENABLED', config.submitEnabled],
  ] as const) {
    requireGate(gate, config.enabled, `${name} requires MCP_ENABLED`);
  }
  requireGate(
    config.ragEnabled,
    config.readEnabled,
    'MCP_RAG_ENABLED requires the MCP read gate',
  );
  requireGate(
    config.submitEnabled,
    config.confirmationEnabled,
    'MCP_SUBMIT_ENABLED requires the MCP confirmation gate',
  );

  if (
    config.legacySessionAbsoluteTtlSeconds < config.legacySessionIdleTtlSeconds
  ) {
    throw new Error(
      'MCP legacy absolute session TTL must not be shorter than idle TTL',
    );
  }

  return config;
}
