import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  coachResultJsonSchema,
  coachResultSchema,
} from './result.schemas';
import {
  coachToolContractsJsonSchema,
  coachToolSchemas,
} from './tool.schemas';

type JsonObject = Record<string, any>;

const workspaceRoot =
  basename(process.cwd()) === 'server'
    ? resolve(process.cwd(), '..')
    : process.cwd();
const contractDirectory = resolve(
  workspaceRoot,
  'specs/001-personalized-learning-coach/contracts',
);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

function addResultConditions(schema: JsonObject): JsonObject {
  const result = clone(schema);
  result.$id =
    'https://en-learning-plus.local/schemas/coach-result.v1.json';
  result.title = 'CoachResultV1';
  result.properties.examples.uniqueItems = true;
  result.properties.errorTypes.uniqueItems = true;
  result.allOf = [
    {
      if: {
        properties: { responseType: { const: 'exercise' } },
        required: ['responseType'],
      },
      then: {
        required: ['exercise'],
        properties: {
          score: { type: 'null' },
          nextAction: { const: 'practice' },
        },
      },
    },
    {
      if: {
        properties: { responseType: { const: 'grading' } },
        required: ['responseType'],
      },
      then: {
        required: ['gradingItems', 'learningUpdate'],
        properties: {
          score: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
    },
    {
      if: {
        properties: {
          responseType: {
            enum: [
              'answer',
              'correction',
              'exercise',
              'recommendation',
              'degraded',
            ],
          },
        },
        required: ['responseType'],
      },
      then: { properties: { score: { type: 'null' } } },
    },
  ];
  return result;
}

function addToolMetadata(schema: JsonObject): JsonObject {
  const result = clone(schema);
  result.$id = 'https://en-learning-plus.local/schemas/coach-tools.v1.json';
  result.title = 'CoachToolContractsV1';
  const properties = result.properties;
  properties.get_learner_profile.properties.input.properties.dimensions.uniqueItems =
    true;
  properties.search_learning_materials.properties.input.properties.materialTypes.uniqueItems =
    true;
  properties.create_exercise.properties.input.properties.types.uniqueItems = true;
  properties.create_exercise.properties.input.properties.materialSourceIds.uniqueItems =
    true;
  return result;
}

export function buildCoachContractArtifacts() {
  return {
    'coach-result.schema.json': sortKeys(
      addResultConditions(coachResultJsonSchema as JsonObject),
    ),
    'coach-tools.schema.json': sortKeys(
      addToolMetadata(coachToolContractsJsonSchema as JsonObject),
    ),
  } as const;
}

export function serializeCoachContractArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeCoachContractArtifacts(): void {
  const artifacts = buildCoachContractArtifacts();
  for (const [name, artifact] of Object.entries(artifacts)) {
    writeFileSync(
      resolve(contractDirectory, name),
      serializeCoachContractArtifact(artifact),
      'utf8',
    );
  }
}

export function readCoachContractArtifact(name: keyof ReturnType<typeof buildCoachContractArtifacts>) {
  return JSON.parse(readFileSync(resolve(contractDirectory, name), 'utf8')) as unknown;
}

export const coachContractRuntimeSchemas = {
  result: coachResultSchema,
  tools: coachToolSchemas,
} as const;

if (process.argv[1]?.endsWith('generate-contracts.ts')) {
  writeCoachContractArtifacts();
}
