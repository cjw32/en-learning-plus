import { aiApi } from "@/apis";
import {
  MCP_CONFIRMATION_SCHEMA_VERSION,
  mcpConfirmationSelectorSchema,
  parseMcpConfirmationDecision,
  parseMcpConfirmationDecisionResult,
  parseMcpConfirmationView,
  type McpConfirmationDecisionInput,
  type McpConfirmationDecisionResult,
  type McpConfirmationView,
} from "./contracts";

const CSRF_COOKIE = "mcp_confirmation_csrf";

export class McpConfirmationClientError extends Error {
  constructor(
    readonly code:
      | "CSRF_UNAVAILABLE"
      | "INVALID_SELECTOR"
      | "INVALID_RESPONSE",
  ) {
    super(code);
    this.name = "McpConfirmationClientError";
  }
}

function selectorPath(value: string): string {
  const parsed = mcpConfirmationSelectorSchema.safeParse(value);
  if (!parsed.success) {
    throw new McpConfirmationClientError("INVALID_SELECTOR");
  }
  return `/mcp/confirmations/${encodeURIComponent(parsed.data)}`;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

function parseResponse<T>(parser: (value: unknown) => T, value: unknown): T {
  try {
    return parser(value);
  } catch {
    throw new McpConfirmationClientError("INVALID_RESPONSE");
  }
}

export async function getMcpWriteConfirmation(
  selector: string,
  signal?: AbortSignal,
): Promise<McpConfirmationView> {
  const response = (await aiApi.get(selectorPath(selector), {
    signal,
  })) as unknown;
  return parseResponse(parseMcpConfirmationView, response);
}

export async function decideMcpWriteConfirmation(
  selector: string,
  untrustedInput: McpConfirmationDecisionInput,
  signal?: AbortSignal,
): Promise<McpConfirmationDecisionResult> {
  const input = parseMcpConfirmationDecision(untrustedInput);
  const csrf = readCookie(CSRF_COOKIE);
  if (!csrf) throw new McpConfirmationClientError("CSRF_UNAVAILABLE");
  const response = (await aiApi.post(selectorPath(selector), input, {
    signal,
    headers: { "X-MCP-CSRF-Token": csrf },
  })) as unknown;
  return parseResponse(parseMcpConfirmationDecisionResult, response);
}

export type * from "./contracts";
export {
  MCP_CONFIRMATION_SCHEMA_VERSION,
  mcpConfirmationSelectorSchema,
  parseMcpConfirmationDecision,
  parseMcpConfirmationDecisionResult,
  parseMcpConfirmationSafeError,
  parseMcpConfirmationView,
} from "./contracts";
