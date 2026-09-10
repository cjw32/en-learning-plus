import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import {
  pronunciationProviderResultSchema,
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
} from "./provider.schemas";
import {
  pronunciationResultSchema,
  PRONUNCIATION_RESULT_SCHEMA_VERSION,
} from "./result.schemas";

type JsonObject = Record<string, unknown>;

const workspaceRoot =
  basename(process.cwd()) === "server"
    ? resolve(process.cwd(), "..")
    : process.cwd();
const contractDirectory = resolve(
  workspaceRoot,
  "specs/003-pronunciation-assessment/contracts",
);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

function withMetadata(
  schema: JsonObject,
  id: string,
  title: string,
  description: string,
): JsonObject {
  return {
    ...schema,
    $id: id,
    title,
    description,
  };
}

export function buildPronunciationContractArtifacts() {
  return {
    "pronunciation-provider.schema.json": sortKeys(
      withMetadata(
        z.toJSONSchema(pronunciationProviderResultSchema, {
          reused: "ref",
        }) as JsonObject,
        `https://en-learning-plus.local/schemas/${PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION}.json`,
        "PronunciationProviderResultV1",
        "Internal provider-neutral adapter output. Raw responses and audio bytes are excluded.",
      ),
    ),
    "pronunciation-result.schema.json": sortKeys(
      withMetadata(
        z.toJSONSchema(pronunciationResultSchema, {
          reused: "ref",
        }) as JsonObject,
        `https://en-learning-plus.local/schemas/${PRONUNCIATION_RESULT_SCHEMA_VERSION}.json`,
        "PronunciationResultV1",
        "Strict provider-neutral public pronunciation result.",
      ),
    ),
  } as const;
}

export function serializePronunciationContractArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writePronunciationContractArtifacts(): void {
  for (const [name, artifact] of Object.entries(
    buildPronunciationContractArtifacts(),
  )) {
    writeFileSync(
      resolve(contractDirectory, name),
      serializePronunciationContractArtifact(artifact),
      "utf8",
    );
  }
}

export function readPronunciationContractArtifact(
  name: keyof ReturnType<typeof buildPronunciationContractArtifacts>,
): unknown {
  return JSON.parse(
    readFileSync(resolve(contractDirectory, name), "utf8"),
  ) as unknown;
}

export const pronunciationContractRuntimeSchemas = Object.freeze({
  provider: pronunciationProviderResultSchema,
  result: pronunciationResultSchema,
});

if (process.argv[1]?.endsWith("generate-contracts.ts")) {
  writePronunciationContractArtifacts();
}
