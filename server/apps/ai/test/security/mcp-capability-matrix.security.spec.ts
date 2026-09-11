import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mcpCapabilityManifestSchema,
  type McpSupportedProtocolVersion,
} from '@en/common/mcp';

type CapabilityType = 'resource' | 'resourceTemplate' | 'tool' | 'prompt';
type CapabilityRef = Readonly<{ type: CapabilityType; name: string }>;

type RegistryInput = Readonly<{
  protocolVersion: McpSupportedProtocolVersion;
  clientCapabilities: Readonly<{
    resources: boolean;
    tools: boolean;
    prompts: boolean;
    urlElicitation: boolean;
  }>;
  scopes: readonly ('learning:read' | 'quiz:create' | 'answer:submit')[];
  gates: Readonly<{
    enabled: boolean;
    readEnabled: boolean;
    ragEnabled: boolean;
    quizEnabled: boolean;
    confirmationEnabled: boolean;
    submitEnabled: boolean;
  }>;
  authorizationActive: boolean;
  traceId: string;
}>;

type Registry = {
  manifest(input: RegistryInput): {
    capabilities: Array<CapabilityRef & Record<string, unknown>>;
  };
  canInvoke(input: RegistryInput, capability: CapabilityRef): boolean;
};

const implementationPath = resolve(
  __dirname,
  '../../src/mcp/capabilities/mcp-capability-registry.ts',
);

function registry(): Registry {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing MCP capability registry (T039)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Registry = require(implementationPath).McpCapabilityRegistry;
  return new Registry();
}

const resources: readonly CapabilityRef[] = [
  { type: 'resourceTemplate', name: 'en-learning://words/{wordId}' },
  {
    type: 'resourceTemplate',
    name: 'en-learning://courses/{courseId}/materials/{materialId}',
  },
  { type: 'resource', name: 'en-learning://me/reviews/today' },
  { type: 'resource', name: 'en-learning://me/reports/summary' },
  { type: 'resource', name: 'en-learning://me/weaknesses' },
];
const tools: readonly CapabilityRef[] = [
  { type: 'tool', name: 'search_words' },
  { type: 'tool', name: 'get_due_words' },
  { type: 'tool', name: 'search_learning_materials' },
  { type: 'tool', name: 'create_quiz' },
  { type: 'tool', name: 'submit_answer' },
  { type: 'tool', name: 'get_learning_report' },
];
const prompts: readonly CapabilityRef[] = [
  { type: 'prompt', name: 'english_interview' },
  { type: 'prompt', name: 'business_english' },
  { type: 'prompt', name: 'vocabulary_review' },
];
const allCapabilities = [...resources, ...tools, ...prompts] as const;

const openGates = Object.freeze({
  enabled: true,
  readEnabled: true,
  ragEnabled: true,
  quizEnabled: true,
  confirmationEnabled: true,
  submitEnabled: true,
});
const declaredAll = Object.freeze({
  resources: true,
  tools: true,
  prompts: true,
  urlElicitation: true,
});

function input(overrides: Partial<RegistryInput> = {}): RegistryInput {
  return {
    protocolVersion: '2026-07-28',
    clientCapabilities: declaredAll,
    scopes: ['learning:read', 'quiz:create', 'answer:submit'],
    gates: openGates,
    authorizationActive: true,
    traceId: 'trace_capability_matrix_0001',
    ...overrides,
  };
}

function keys(values: readonly CapabilityRef[]): string[] {
  return values.map(({ type, name }) => `${type}:${name}`);
}

const readWithoutRag = [...resources, tools[0], tools[1], tools[5], ...prompts];

describe('MCP capability intersection and direct-call parity', () => {
  it.each([
    {
      name: 'modern all approved',
      overrides: {},
      expected: allCapabilities,
    },
    {
      name: 'legacy all approved',
      overrides: { protocolVersion: '2025-11-25' as const },
      expected: allCapabilities,
    },
    {
      name: 'read scope and read gate only',
      overrides: {
        scopes: ['learning:read'] as const,
        gates: {
          ...openGates,
          ragEnabled: false,
          quizEnabled: false,
          confirmationEnabled: false,
          submitEnabled: false,
        },
      },
      expected: readWithoutRag,
    },
    {
      name: 'client without URL elicitation',
      overrides: {
        clientCapabilities: { ...declaredAll, urlElicitation: false },
      },
      expected: allCapabilities.filter(({ name }) => name !== 'submit_answer'),
    },
    {
      name: 'resource-only client declaration',
      overrides: {
        clientCapabilities: {
          resources: true,
          tools: false,
          prompts: false,
          urlElicitation: false,
        },
      },
      expected: resources,
    },
    {
      name: 'no scopes',
      overrides: { scopes: [] as const },
      expected: [],
    },
    {
      name: 'revoked authorization',
      overrides: { authorizationActive: false },
      expected: [],
    },
    {
      name: 'global gate closed',
      overrides: { gates: { ...openGates, enabled: false } },
      expected: [],
    },
  ] as const)('$name', ({ overrides, expected }) => {
    const capabilityRegistry = registry();
    const currentInput = input(overrides as Partial<RegistryInput>);
    const manifest = capabilityRegistry.manifest(currentInput);
    expect(mcpCapabilityManifestSchema.parse(manifest)).toEqual(manifest);
    expect(keys(manifest.capabilities)).toEqual(keys(expected));

    for (const capability of allCapabilities) {
      expect(capabilityRegistry.canInvoke(currentInput, capability)).toBe(
        keys(expected).includes(keys([capability])[0]!),
      );
    }
  });

  it('pins the complete all-approved discovery snapshot', () => {
    const manifest = registry().manifest(input());
    expect(keys(manifest.capabilities)).toEqual([
      'resourceTemplate:en-learning://words/{wordId}',
      'resourceTemplate:en-learning://courses/{courseId}/materials/{materialId}',
      'resource:en-learning://me/reviews/today',
      'resource:en-learning://me/reports/summary',
      'resource:en-learning://me/weaknesses',
      'tool:search_words',
      'tool:get_due_words',
      'tool:search_learning_materials',
      'tool:create_quiz',
      'tool:submit_answer',
      'tool:get_learning_report',
      'prompt:english_interview',
      'prompt:business_english',
      'prompt:vocabulary_review',
    ]);
  });
});
