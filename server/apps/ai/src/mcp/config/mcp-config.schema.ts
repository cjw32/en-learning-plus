import { z } from '@en/common/coach/zod';

const booleanTextSchema = z.enum(['true', 'false']).optional();

export const mcpEnvironmentSchema = z
  .object({
    MCP_ENABLED: booleanTextSchema,
    MCP_READ_ENABLED: booleanTextSchema,
    MCP_RAG_ENABLED: booleanTextSchema,
    MCP_QUIZ_ENABLED: booleanTextSchema,
    MCP_CONFIRMATION_ENABLED: booleanTextSchema,
    MCP_SUBMIT_ENABLED: booleanTextSchema,
    MCP_MAX_REQUEST_BYTES: z.string().optional(),
    MCP_MAX_RESULT_BYTES: z.string().optional(),
    MCP_MAX_TOOL_CALLS: z.string().optional(),
    MCP_MAX_RECURSION_DEPTH: z.string().optional(),
    MCP_MAX_PARALLEL_CALLS: z.string().optional(),
    MCP_REQUEST_DEADLINE_MS: z.string().optional(),
    MCP_LEGACY_SESSION_IDLE_TTL_SECONDS: z.string().optional(),
    MCP_LEGACY_SESSION_ABSOLUTE_TTL_SECONDS: z.string().optional(),
    MCP_CONFIRMATION_TTL_SECONDS: z.string().optional(),
    MCP_METADATA_RETENTION_DAYS: z.string().optional(),
  })
  .passthrough();

export type McpEnvironment = z.infer<typeof mcpEnvironmentSchema>;
