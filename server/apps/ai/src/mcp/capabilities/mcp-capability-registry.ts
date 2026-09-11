import type {
  McpCapabilityManifest,
  McpSupportedProtocolVersion,
} from '@en/common/mcp';

export type McpCapabilityType =
  | 'resource'
  | 'resourceTemplate'
  | 'tool'
  | 'prompt';

export type McpCapabilityReference = Readonly<{
  type: McpCapabilityType;
  name: string;
}>;

export type McpCapabilityRegistryInput = Readonly<{
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

type Descriptor = McpCapabilityManifest['capabilities'][number];
type ClientCapability = 'resources' | 'tools' | 'prompts';
type GatePredicate = (input: McpCapabilityRegistryInput) => boolean;
type InventoryEntry = Readonly<{
  descriptor: Descriptor;
  clientCapability: ClientCapability;
  gate: GatePredicate;
  requiresUrlElicitation?: boolean;
}>;

const SCHEMA_VERSION = 'en-learning.mcp.v1' as const;
const MANIFEST_VERSION = 'english-learning-capabilities.v1';
const DEFAULT_RESULT_BYTES = 256 * 1024;

const readGate: GatePredicate = ({ gates }) =>
  gates.enabled && gates.readEnabled;
const ragGate: GatePredicate = ({ gates }) =>
  gates.enabled && gates.readEnabled && gates.ragEnabled;
const quizGate: GatePredicate = ({ gates }) =>
  gates.enabled && gates.quizEnabled;
const submitGate: GatePredicate = ({ gates }) =>
  gates.enabled && gates.confirmationEnabled && gates.submitEnabled;

function descriptor(value: Omit<Descriptor, 'version'>): Descriptor {
  return { ...value, version: SCHEMA_VERSION };
}

function readDescriptor(
  type: 'resource' | 'resourceTemplate' | 'tool',
  name: string,
  description: string,
  deadlineMs = 5_000,
): Descriptor {
  return descriptor({
    type,
    name,
    description,
    requiredScopes: ['learning:read'],
    effect: 'read',
    idempotency: 'safe_repeat',
    confirmation: 'none',
    maxResultBytes: DEFAULT_RESULT_BYTES,
    deadlineMs,
  });
}

function promptDescriptor(name: string, description: string): Descriptor {
  return descriptor({
    type: 'prompt',
    name,
    description,
    requiredScopes: ['learning:read'],
    effect: 'prompt_only',
    idempotency: 'not_applicable',
    confirmation: 'none',
    maxResultBytes: DEFAULT_RESULT_BYTES,
    deadlineMs: 3_000,
  });
}

const INVENTORY: readonly InventoryEntry[] = Object.freeze([
  {
    descriptor: readDescriptor(
      'resourceTemplate',
      'en-learning://words/{wordId}',
      'Read one rights-filtered dictionary entry.',
    ),
    clientCapability: 'resources',
    gate: readGate,
  },
  {
    descriptor: readDescriptor(
      'resourceTemplate',
      'en-learning://courses/{courseId}/materials/{materialId}',
      'Read one entitled course material summary.',
    ),
    clientCapability: 'resources',
    gate: readGate,
  },
  {
    descriptor: readDescriptor(
      'resource',
      'en-learning://me/reviews/today',
      "Read the current learner's due reviews.",
    ),
    clientCapability: 'resources',
    gate: readGate,
  },
  {
    descriptor: readDescriptor(
      'resource',
      'en-learning://me/reports/summary',
      "Read the current learner's progress summary.",
    ),
    clientCapability: 'resources',
    gate: readGate,
  },
  {
    descriptor: readDescriptor(
      'resource',
      'en-learning://me/weaknesses',
      "Read the current learner's evidence-backed weaknesses.",
    ),
    clientCapability: 'resources',
    gate: readGate,
  },
  {
    descriptor: readDescriptor(
      'tool',
      'search_words',
      'Search rights-filtered dictionary entries.',
      3_000,
    ),
    clientCapability: 'tools',
    gate: readGate,
  },
  {
    descriptor: readDescriptor(
      'tool',
      'get_due_words',
      "List the current learner's due review words.",
      3_000,
    ),
    clientCapability: 'tools',
    gate: readGate,
  },
  {
    descriptor: readDescriptor(
      'tool',
      'search_learning_materials',
      'Search entitled learning materials with verified citations.',
      5_000,
    ),
    clientCapability: 'tools',
    gate: ragGate,
  },
  {
    descriptor: descriptor({
      type: 'tool',
      name: 'create_quiz',
      description:
        'Create an owned quiz without changing mastery or review state.',
      requiredScopes: ['quiz:create'],
      effect: 'create_exercise',
      idempotency: 'required',
      confirmation: 'none',
      maxResultBytes: DEFAULT_RESULT_BYTES,
      deadlineMs: 30_000,
    }),
    clientCapability: 'tools',
    gate: quizGate,
  },
  {
    descriptor: descriptor({
      type: 'tool',
      name: 'submit_answer',
      description:
        'Submit answers and update learning progress after verified confirmation.',
      requiredScopes: ['answer:submit'],
      effect: 'write_learning_progress',
      idempotency: 'required',
      confirmation: 'url_elicitation_required',
      maxResultBytes: DEFAULT_RESULT_BYTES,
      deadlineMs: 30_000,
    }),
    clientCapability: 'tools',
    gate: submitGate,
    requiresUrlElicitation: true,
  },
  {
    descriptor: readDescriptor(
      'tool',
      'get_learning_report',
      "Read the current learner's bounded learning report.",
      5_000,
    ),
    clientCapability: 'tools',
    gate: readGate,
  },
  {
    descriptor: promptDescriptor(
      'english_interview',
      'Build a bounded English interview practice workflow.',
    ),
    clientCapability: 'prompts',
    gate: readGate,
  },
  {
    descriptor: promptDescriptor(
      'business_english',
      'Build a bounded business English practice workflow.',
    ),
    clientCapability: 'prompts',
    gate: readGate,
  },
  {
    descriptor: promptDescriptor(
      'vocabulary_review',
      'Build a bounded vocabulary review workflow.',
    ),
    clientCapability: 'prompts',
    gate: readGate,
  },
]);

function isVisible(
  entry: InventoryEntry,
  input: McpCapabilityRegistryInput,
): boolean {
  if (!input.authorizationActive || !input.gates.enabled) return false;
  if (!input.clientCapabilities[entry.clientCapability]) return false;
  if (
    entry.requiresUrlElicitation &&
    !input.clientCapabilities.urlElicitation
  ) {
    return false;
  }
  if (!entry.gate(input)) return false;
  const scopes = new Set(input.scopes);
  return entry.descriptor.requiredScopes.every((scope) => scopes.has(scope));
}

export class McpCapabilityRegistry {
  manifest(input: McpCapabilityRegistryInput): McpCapabilityManifest {
    return {
      schemaVersion: SCHEMA_VERSION,
      protocolVersion: input.protocolVersion,
      manifestVersion: MANIFEST_VERSION,
      capabilities: INVENTORY.filter((entry) => isVisible(entry, input)).map(
        (entry) => ({ ...entry.descriptor }),
      ),
      traceId: input.traceId,
    };
  }

  canInvoke(
    input: McpCapabilityRegistryInput,
    capability: McpCapabilityReference,
  ): boolean {
    const entry = INVENTORY.find(
      ({ descriptor }) =>
        descriptor.type === capability.type &&
        descriptor.name === capability.name,
    );
    return entry ? isVisible(entry, input) : false;
  }
}
