export const MCP_CAPABILITY_DEADLINES_MS = Object.freeze({
  discovery: 2_000,
  read: 3_000,
  rag: 5_000,
  report: 5_000,
  model: 30_000,
  write: 30_000,
} as const);

export type McpDeadlineClass = keyof typeof MCP_CAPABILITY_DEADLINES_MS;

export function resolveMcpDeadlineAt(
  deadlineClass: McpDeadlineClass,
  startedAt: Date,
  tokenExpiresAt?: Date,
): Date {
  const hardDeadline = new Date(
    startedAt.getTime() + MCP_CAPABILITY_DEADLINES_MS[deadlineClass],
  );
  if (!tokenExpiresAt || tokenExpiresAt >= hardDeadline) return hardDeadline;
  return new Date(tokenExpiresAt);
}
