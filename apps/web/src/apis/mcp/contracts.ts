import {
  MCP_CONFIRMATION_SCHEMA_VERSION,
  mcpConfirmationDecisionInputSchema,
  mcpConfirmationDecisionResultSchema,
  mcpConfirmationSafeErrorSchema,
  mcpConfirmationSelectorSchema,
  mcpConfirmationViewSchema,
  type McpConfirmationDecisionInput,
  type McpConfirmationDecisionResult,
  type McpConfirmationSafeError,
  type McpConfirmationView,
} from "@en/common/mcp";

export {
  MCP_CONFIRMATION_SCHEMA_VERSION,
  mcpConfirmationDecisionInputSchema,
  mcpConfirmationDecisionResultSchema,
  mcpConfirmationSafeErrorSchema,
  mcpConfirmationSelectorSchema,
  mcpConfirmationViewSchema,
};
export type {
  McpConfirmationDecisionInput,
  McpConfirmationDecisionResult,
  McpConfirmationSafeError,
  McpConfirmationView,
};

export function parseMcpConfirmationView(value: unknown): McpConfirmationView {
  return mcpConfirmationViewSchema.parse(value);
}

export function parseMcpConfirmationDecision(
  value: unknown,
): McpConfirmationDecisionInput {
  return mcpConfirmationDecisionInputSchema.parse(value);
}

export function parseMcpConfirmationDecisionResult(
  value: unknown,
): McpConfirmationDecisionResult {
  return mcpConfirmationDecisionResultSchema.parse(value);
}

export function parseMcpConfirmationSafeError(
  value: unknown,
): McpConfirmationSafeError {
  return mcpConfirmationSafeErrorSchema.parse(value);
}
