export const MCP_MODERN_PROTOCOL_VERSION = "2026-07-28" as const;
export const MCP_LEGACY_PROTOCOL_VERSION = "2025-11-25" as const;

export const MCP_SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  MCP_MODERN_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
] as const);

export type McpSupportedProtocolVersion =
  (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];

export function isSupportedMcpProtocolVersion(
  value: unknown,
): value is McpSupportedProtocolVersion {
  return (
    typeof value === "string" &&
    MCP_SUPPORTED_PROTOCOL_VERSIONS.some((version) => version === value)
  );
}
