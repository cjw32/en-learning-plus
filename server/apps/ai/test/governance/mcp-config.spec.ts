import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type McpRuntimeConfig = Readonly<{
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

type ConfigModule = {
  resolveMcpRuntimeConfig: (environment: NodeJS.ProcessEnv) => McpRuntimeConfig;
};

const configPath = resolve(__dirname, '../../src/mcp/config/mcp.config.ts');

function loadConfig(): ConfigModule {
  if (!existsSync(configPath)) {
    throw new Error(`Missing MCP runtime configuration: ${configPath} (T017)`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(configPath) as ConfigModule;
}

describe('MCP runtime configuration', () => {
  it('keeps every production-facing capability disabled by default', () => {
    const config = loadConfig().resolveMcpRuntimeConfig({});
    expect(config).toMatchObject({
      enabled: false,
      readEnabled: false,
      ragEnabled: false,
      quizEnabled: false,
      confirmationEnabled: false,
      submitEnabled: false,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    { MCP_READ_ENABLED: 'true' },
    { MCP_RAG_ENABLED: 'true' },
    { MCP_QUIZ_ENABLED: 'true' },
    { MCP_CONFIRMATION_ENABLED: 'true' },
    { MCP_SUBMIT_ENABLED: 'true' },
  ])('rejects a child gate without MCP_ENABLED: %p', (environment) => {
    expect(() => loadConfig().resolveMcpRuntimeConfig(environment)).toThrow();
  });

  it('requires RAG to remain below read and submit below confirmation', () => {
    expect(() =>
      loadConfig().resolveMcpRuntimeConfig({
        MCP_ENABLED: 'true',
        MCP_RAG_ENABLED: 'true',
      }),
    ).toThrow(/read/i);
    expect(() =>
      loadConfig().resolveMcpRuntimeConfig({
        MCP_ENABLED: 'true',
        MCP_SUBMIT_ENABLED: 'true',
      }),
    ).toThrow(/confirmation/i);
  });

  it.each([
    ['MCP_ENABLED', 'yes'],
    ['MCP_MAX_REQUEST_BYTES', '0'],
    ['MCP_MAX_RESULT_BYTES', '262145'],
    ['MCP_MAX_TOOL_CALLS', '0'],
    ['MCP_MAX_RECURSION_DEPTH', '1'],
    ['MCP_MAX_PARALLEL_CALLS', '0'],
    ['MCP_REQUEST_DEADLINE_MS', '0'],
    ['MCP_REQUEST_DEADLINE_MS', '30001'],
    ['MCP_LEGACY_SESSION_IDLE_TTL_SECONDS', '0'],
    ['MCP_LEGACY_SESSION_ABSOLUTE_TTL_SECONDS', '3601'],
    ['MCP_CONFIRMATION_TTL_SECONDS', '301'],
    ['MCP_METADATA_RETENTION_DAYS', '0'],
    ['MCP_METADATA_RETENTION_DAYS', '366'],
  ])('rejects invalid bootstrap setting %s=%s', (name, value) => {
    expect(() =>
      loadConfig().resolveMcpRuntimeConfig({ [name]: value }),
    ).toThrow();
  });
});
