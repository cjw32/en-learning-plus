import { writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { mcpPublicCapabilityContentSchema } from "./schemas";

type JsonObject = Record<string, unknown>;

const workspaceRoot =
  basename(process.cwd()) === "server"
    ? resolve(process.cwd(), "..")
    : process.cwd();

export const MCP_CAPABILITIES_SCHEMA_PATH = resolve(
  workspaceRoot,
  "specs/004-english-learning-mcp/contracts/mcp-capabilities.schema.json",
);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

export function buildMcpCapabilitiesJsonSchema(): JsonObject {
  const generated = z.toJSONSchema(mcpPublicCapabilityContentSchema, {
    reused: "ref",
  }) as JsonObject;
  return sortKeys({
    ...generated,
    $id: "https://en-learning-plus.invalid/contracts/en-learning-mcp-v1.schema.json",
    title: "English Learning MCP v1 public capability content",
    description:
      "Generated strict public contract. Identity is injected by the server and never appears in public inputs.",
  }) as JsonObject;
}

export function generateMcpCapabilitiesJsonSchema(): string {
  return `${JSON.stringify(buildMcpCapabilitiesJsonSchema(), null, 2)}\n`;
}

export function writeMcpCapabilitiesJsonSchema(): void {
  writeFileSync(
    MCP_CAPABILITIES_SCHEMA_PATH,
    generateMcpCapabilitiesJsonSchema(),
    "utf8",
  );
}

if (process.argv[1]?.endsWith("generate-json-schema.ts")) {
  writeMcpCapabilitiesJsonSchema();
}
