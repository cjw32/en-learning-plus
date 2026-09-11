import {
  MCP_SCHEMA_VERSION,
  mcpReportResourceSchema,
  type McpResourceContent,
} from '@en/common/mcp';
import { z } from '@en/common/coach/zod';
import type { LearningReportService } from '@libs/learning';
import type { McpRequestContext } from '../auth/mcp-principal';
import { McpResourceHandlerError } from './word.resource';

const URI = 'en-learning://me/reports/summary';
const requestSchema = z.object({ uri: z.literal(URI) }).strict();

export class McpReportSummaryResource {
  constructor(
    private readonly reports: Pick<LearningReportService, 'getSummary'>,
  ) {}

  async read(
    untrustedInput: unknown,
    context: McpRequestContext,
  ): Promise<McpResourceContent> {
    const input = requestSchema.safeParse(untrustedInput);
    if (!input.success) {
      throw new McpResourceHandlerError('VALIDATION_FAILED');
    }
    const summary = await this.reports.getSummary({ userId: context.userId });
    const result = mcpReportResourceSchema.safeParse({
      kind: 'learning_report',
      uri: URI,
      meta: {
        schemaVersion: MCP_SCHEMA_VERSION,
        contentVersion: summary.contentVersion,
        updatedAt: summary.updatedAt.toISOString(),
        truncated: false,
        nextCursor: null,
        traceId: context.traceId,
      },
      report: summary.report,
    });
    if (!result.success) {
      throw new McpResourceHandlerError('INTERNAL_ERROR');
    }
    return result.data;
  }
}
