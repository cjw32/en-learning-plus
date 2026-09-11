export const MCP_EVAL_CATEGORIES = Object.freeze([
  'protocol',
  'resources',
  'tools',
  'prompts',
  'confirmation',
  'duplicate_write',
  'cancellation',
  'injection',
  'isolation',
] as const);

export type McpEvalCategory = (typeof MCP_EVAL_CATEGORIES)[number];
export type McpEvalCaseKind = 'positive' | 'failure';
export type McpEvalCase = Readonly<{
  id: string;
  category: McpEvalCategory;
  kind: McpEvalCaseKind;
  synthetic: true;
  expected: Readonly<{
    source: string | null;
    tool: string | null;
    action: 'allow' | 'deny' | 'cancel';
  }>;
  zeroTolerance: readonly string[];
}>;
export type McpEvalPackage = Readonly<{
  fixtureVersion: 'mcp-eval-cases.v1';
  rubricVersion: 'mcp-rubrics.v1';
  cases: readonly McpEvalCase[];
}>;

export type McpEvalObservation = Readonly<{
  id: string;
  passed: boolean;
  qualityScore: number | null;
  toolAccurate: boolean;
  schemaAccurate: boolean;
  citationValid: boolean | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number | null;
  cancelled: boolean;
  client: string;
}>;
