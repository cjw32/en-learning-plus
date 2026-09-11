import {
  MCP_SCHEMA_VERSION,
  mcpSearchMaterialsInputSchema,
  mcpSearchMaterialsSuccessSchema,
  type McpToolResult,
} from '@en/common/mcp';
import type {
  McpLearningBridge,
  McpLearningMaterialSearchResult,
} from '../../coach/mcp/mcp-learning.bridge';
import type { McpRequestContext } from '../auth/mcp-principal';
import { validateMcpResult } from '../results/mcp-result-validator';
import {
  assertExecutionOpen,
  createReadToolDefinition,
  McpReadToolError,
  type McpToolExecution,
  normalizeSafeQuery,
} from './mcp-read-tool';

type Bridge = Pick<McpLearningBridge, 'searchMaterials'>;

function normalizeBridgeResult(raw: unknown): McpLearningMaterialSearchResult {
  if (!raw || typeof raw !== 'object') {
    throw new McpReadToolError('INTERNAL_ERROR');
  }
  const value = raw as Partial<McpLearningMaterialSearchResult>;
  if (value.retrievalStatus === 'insufficient') {
    return Object.freeze({
      retrievalStatus: 'insufficient' as const,
      results: Object.freeze([]),
      conflicts: Object.freeze([]),
    });
  }
  if (
    value.retrievalStatus !== 'success' ||
    !Array.isArray(value.results) ||
    value.results.length === 0 ||
    !Array.isArray(value.conflicts)
  ) {
    throw new McpReadToolError('INTERNAL_ERROR');
  }
  return value as McpLearningMaterialSearchResult;
}

export class McpSearchLearningMaterialsTool {
  readonly name = 'search_learning_materials' as const;
  readonly definition = createReadToolDefinition({
    name: this.name,
    description:
      'Search currently authorized learning materials and return only verified bounded citations.',
    inputSchema: mcpSearchMaterialsInputSchema,
    outputSchema: mcpSearchMaterialsSuccessSchema,
    deadlineMs: 5_000,
    budgetPolicy: 'mcp-rag-read.v1',
  });

  constructor(private readonly bridge: Bridge) {}

  async execute(
    untrustedInput: unknown,
    context: McpRequestContext,
    execution?: McpToolExecution,
  ): Promise<McpToolResult> {
    assertExecutionOpen(execution);
    const parsed = mcpSearchMaterialsInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw new McpReadToolError('VALIDATION_FAILED');
    const query = normalizeSafeQuery(parsed.data.query);

    const domain = normalizeBridgeResult(
      await this.bridge.searchMaterials({
        userId: context.userId,
        requestId: context.requestId,
        traceId: context.traceId,
        input: {
          query,
          categories: parsed.data.categories,
          ...(parsed.data.levels ? { levels: parsed.data.levels } : {}),
          ...(parsed.data.courseIds
            ? { courseIds: parsed.data.courseIds }
            : {}),
          ...(parsed.data.wordIds ? { wordIds: parsed.data.wordIds } : {}),
          topK: parsed.data.topK,
          ...(parsed.data.minimumRelevance === undefined
            ? {}
            : { minimumRelevance: parsed.data.minimumRelevance }),
        },
        ...(execution?.deadline ? { deadline: execution.deadline } : {}),
        ...(execution?.signal ? { signal: execution.signal } : {}),
      }),
    );
    assertExecutionOpen(execution);

    return validateMcpResult(mcpSearchMaterialsSuccessSchema, {
      schemaVersion: MCP_SCHEMA_VERSION,
      ok: true,
      retrievalStatus: domain.retrievalStatus,
      results:
        domain.retrievalStatus === 'success'
          ? domain.results.slice(0, parsed.data.topK)
          : [],
      conflicts:
        domain.retrievalStatus === 'success'
          ? domain.conflicts.slice(0, 20)
          : [],
      traceId: context.traceId,
    });
  }
}
