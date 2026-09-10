import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  coachResultJsonSchema,
  coachResultSchema,
  publicCoachResultV2JsonSchema,
  publicCoachResultV2Schema,
  storedCoachResultV2Schema,
} from './result.schemas';
import {
  coachToolContractsJsonSchema,
  coachToolSchemas,
  searchLearningMaterialsV2ContractJsonSchema,
  searchLearningMaterialsV2InputSchema,
  searchLearningMaterialsV2OutputSchema,
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
const ragContractDirectory = resolve(
  workspaceRoot,
  'specs/002-rag-source-citations/contracts',
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

function addRagSearchMetadata(schema: JsonObject): JsonObject {
  const result = clone(schema);
  result.$id =
    'https://en-learning-plus.local/schemas/search-learning-materials.v2.json';
  result.title = 'SearchLearningMaterialsV2';
  return result;
}

function addRagResultMetadata(schema: JsonObject): JsonObject {
  const result = clone(schema);
  result.$id =
    'https://en-learning-plus.local/schemas/coach-result.v2.json';
  result.title = 'CoachResultV2';
  result.properties.examples.uniqueItems = true;
  result.properties.errorTypes.uniqueItems = true;
  result.properties.citations.uniqueItems = true;
  return result;
}

function buildRagCitationOpenApi(): JsonObject {
  const citationId = {
    type: 'string',
    pattern: '^cit_[A-Za-z0-9_-]{10,48}$',
  };
  const locator = {
    oneOf: ['word', 'course', 'grammar', 'exercise'].map((kind) => ({
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'id'],
      properties: {
        kind: { const: kind },
        id: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          pattern: '^[A-Za-z0-9_-]+$',
        },
      },
    })),
  };
  const categories = [
    'WORD_MEANING',
    'WORD_TRANSLATION',
    'WORD_PRONUNCIATION',
    'WORD_FORM',
    'WORD_USAGE',
    'COLLOCATION',
    'EXAMPLE_SENTENCE',
    'GRAMMAR_RULE',
    'GRAMMAR_EXCEPTION',
    'COURSE_LESSON',
    'EXERCISE_KNOWLEDGE',
    'USER_ERROR',
    'LEARNING_SUMMARY',
  ];
  return {
    openapi: '3.1.0',
    info: {
      title: 'en-learning-plus Coach RAG Citation API',
      version: '2.0.0',
      description:
        'Resolves server-issued citations after reauthorizing the current access-token subject.',
    },
    servers: [{ url: '/api' }],
    paths: {
      '/coach/citations/{citationId}': {
        get: {
          operationId: 'getCoachCitation',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'citationId',
              in: 'path',
              required: true,
              schema: citationId,
            },
          ],
          responses: {
            '200': {
              description: 'Current safe citation projection',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CitationResponse' },
                },
              },
            },
            '401': { description: 'Missing, expired, or invalid access token' },
            '404': {
              description: 'Citation does not exist or is not accessible',
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        ActiveCitation: {
          type: 'object',
          additionalProperties: false,
          required: [
            'citationId',
            'status',
            'source',
            'title',
            'category',
            'excerpt',
            'accessScope',
            'locator',
          ],
          properties: {
            citationId,
            status: { const: 'active' },
            source: { type: 'string', minLength: 1, maxLength: 128 },
            title: { type: 'string', minLength: 1, maxLength: 300 },
            category: { type: 'string', enum: categories },
            excerpt: { type: 'string', minLength: 1, maxLength: 2000 },
            accessScope: {
              type: 'string',
              enum: ['PUBLIC', 'OWNED_COURSE', 'PRIVATE_OWNER'],
            },
            locator: { oneOf: [...locator.oneOf, { type: 'null' }] },
          },
        },
        UnavailableCitation: {
          type: 'object',
          additionalProperties: false,
          required: ['citationId', 'status', 'reason'],
          properties: {
            citationId,
            status: { const: 'unavailable' },
            reason: { const: 'SOURCE_UNAVAILABLE' },
          },
        },
        Citation: {
          oneOf: [
            { $ref: '#/components/schemas/ActiveCitation' },
            { $ref: '#/components/schemas/UnavailableCitation' },
          ],
          discriminator: { propertyName: 'status' },
        },
        CitationResponse: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'msg', 'data'],
          properties: {
            code: { type: 'integer', const: 200 },
            msg: { type: 'string' },
            data: { $ref: '#/components/schemas/Citation' },
          },
        },
      },
    },
  };
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

export function buildRagContractArtifacts() {
  return {
    'search-learning-materials.schema.json': sortKeys(
      addRagSearchMetadata(
        searchLearningMaterialsV2ContractJsonSchema as JsonObject,
      ),
    ),
    'coach-result-v2.schema.json': sortKeys(
      addRagResultMetadata(publicCoachResultV2JsonSchema as JsonObject),
    ),
    'coach-rag.openapi.yaml': sortKeys(buildRagCitationOpenApi()),
  } as const;
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
  for (const [name, artifact] of Object.entries(buildRagContractArtifacts())) {
    writeFileSync(
      resolve(ragContractDirectory, name),
      serializeCoachContractArtifact(artifact),
      'utf8',
    );
  }
}

export function readCoachContractArtifact(name: keyof ReturnType<typeof buildCoachContractArtifacts>) {
  return JSON.parse(readFileSync(resolve(contractDirectory, name), 'utf8')) as unknown;
}

export function readRagContractArtifact(
  name: keyof ReturnType<typeof buildRagContractArtifacts>,
) {
  return JSON.parse(
    readFileSync(resolve(ragContractDirectory, name), 'utf8'),
  ) as unknown;
}

export const coachContractRuntimeSchemas = {
  result: coachResultSchema,
  tools: coachToolSchemas,
  ragSearchV2: {
    input: searchLearningMaterialsV2InputSchema,
    output: searchLearningMaterialsV2OutputSchema,
  },
  ragResultV2: {
    stored: storedCoachResultV2Schema,
    public: publicCoachResultV2Schema,
  },
} as const;

if (process.argv[1]?.endsWith('generate-contracts.ts')) {
  writeCoachContractArtifacts();
}
