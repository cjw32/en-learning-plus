import { z } from "zod";

export const MCP_PUBLIC_ERROR_CODES = Object.freeze([
  "UNAUTHENTICATED",
  "INSUFFICIENT_SCOPE",
  "CAPABILITY_UNAVAILABLE",
  "VALIDATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "CURSOR_INVALID",
  "DATA_NOT_AVAILABLE",
  "SOURCE_RIGHTS_DENIED",
  "IDEMPOTENCY_CONFLICT",
  "IN_PROGRESS",
  "CONFIRMATION_REQUIRED",
  "CONFIRMATION_PENDING",
  "CONFIRMATION_INVALID",
  "RATE_LIMITED",
  "BUDGET_EXCEEDED",
  "CANCELLED",
  "TIMEOUT",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const);

export const mcpPublicErrorCodeSchema = z.enum(MCP_PUBLIC_ERROR_CODES);

export const mcpSafeErrorSchema = z
  .object({
    schemaVersion: z.literal("en-learning.mcp.v1"),
    ok: z.literal(false),
    code: mcpPublicErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(3_600).optional(),
    traceId: z.string().min(10).max(128),
  })
  .strict();

export type McpPublicErrorCode = z.infer<typeof mcpPublicErrorCodeSchema>;
export type McpSafeError = z.infer<typeof mcpSafeErrorSchema>;
