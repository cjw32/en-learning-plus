import {
  MCP_SCHEMA_VERSION,
  mcpGetLearningReportInputSchema,
  mcpLearningReportSuccessSchema,
  type McpToolResult,
} from '@en/common/mcp';
import type { LearningReportService } from '@libs/learning';
import type { McpRequestContext } from '../auth/mcp-principal';
import { validateMcpResult } from '../results/mcp-result-validator';
import {
  assertExecutionOpen,
  createReadToolDefinition,
  McpReadToolError,
  type McpToolExecution,
} from './mcp-read-tool';

type Reports = Pick<LearningReportService, 'getSummary' | 'getWeaknesses'>;

function assertDateRange(from?: string, to?: string): void {
  if (!from || !to) return;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  const days = Math.floor((end - start) / (24 * 60 * 60 * 1_000)) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 90) {
    throw new McpReadToolError('VALIDATION_FAILED');
  }
}

export class McpGetLearningReportTool {
  readonly name = 'get_learning_report' as const;
  readonly definition = createReadToolDefinition({
    name: this.name,
    description:
      "Read the current learner's bounded progress, review, performance and weakness report.",
    inputSchema: mcpGetLearningReportInputSchema,
    outputSchema: mcpLearningReportSuccessSchema,
    deadlineMs: 5_000,
    budgetPolicy: 'none',
  });

  constructor(private readonly reports: Reports) {}

  async execute(
    untrustedInput: unknown,
    context: McpRequestContext,
    execution?: McpToolExecution,
  ): Promise<McpToolResult> {
    assertExecutionOpen(execution);
    const parsed = mcpGetLearningReportInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw new McpReadToolError('VALIDATION_FAILED');
    assertDateRange(parsed.data.from, parsed.data.to);
    const range = {
      ...(parsed.data.from ? { from: parsed.data.from } : {}),
      ...(parsed.data.to ? { to: parsed.data.to } : {}),
    };

    const summary = await this.reports.getSummary({
      userId: context.userId,
      ...range,
    });
    assertExecutionOpen(execution);
    const includeWeaknesses =
      !parsed.data.dimensions ||
      parsed.data.dimensions.includes('weaknesses') ||
      parsed.data.dimensions.includes('errors');
    const weaknesses = includeWeaknesses
      ? await this.reports.getWeaknesses({
          userId: context.userId,
          limit: parsed.data.limit,
          ...range,
        })
      : { items: [] as const };
    assertExecutionOpen(execution);

    return validateMcpResult(mcpLearningReportSuccessSchema, {
      schemaVersion: MCP_SCHEMA_VERSION,
      ok: true,
      report: summary.report,
      weaknesses: weaknesses.items,
      traceId: context.traceId,
    });
  }
}
