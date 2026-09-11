import {
  MCP_SCHEMA_VERSION,
  mcpOpaqueCursorSchema,
  mcpWeaknessResourceSchema,
  type McpResourceContent,
} from '@en/common/mcp';
import { createHash } from 'node:crypto';
import { z } from '@en/common/coach/zod';
import type { LearningReportService } from '@libs/learning';
import type { McpRequestContext } from '../auth/mcp-principal';
import type { McpCursorService } from '../pagination/mcp-cursor.service';
import { McpResourceHandlerError } from './word.resource';

const URI = 'en-learning://me/weaknesses';
const requestSchema = z
  .object({
    uri: z.literal(URI),
    limit: z.number().int().min(1).max(50).default(50),
    cursor: mcpOpaqueCursorSchema.optional(),
  })
  .strict();

function principalKey(context: McpRequestContext): string {
  return createHash('sha256')
    .update(`${context.principal.issuer}\0${context.authorizationId}`)
    .digest('base64url');
}

function filterHash(limit: number): string {
  return createHash('sha256')
    .update(JSON.stringify({ limit }))
    .digest('base64url');
}

export class McpWeaknessesResource {
  constructor(
    private readonly reports: Pick<LearningReportService, 'getWeaknesses'>,
    private readonly cursors?: Pick<McpCursorService, 'issue' | 'verify'>,
  ) {}

  async read(
    untrustedInput: unknown,
    context: McpRequestContext,
  ): Promise<McpResourceContent> {
    const input = requestSchema.safeParse(untrustedInput);
    if (!input.success) {
      throw new McpResourceHandlerError('VALIDATION_FAILED');
    }
    const bindingBase = {
      principalKey: principalKey(context),
      resource: URI,
      filterHash: filterHash(input.data.limit),
    };
    let report = await this.reports.getWeaknesses({
      userId: context.userId,
      limit: input.data.limit,
      cursor: undefined,
    });
    if (input.data.cursor) {
      if (!this.cursors) throw new McpResourceHandlerError('INTERNAL_ERROR');
      const position = this.cursors.verify(input.data.cursor, {
        ...bindingBase,
        contentVersion: report.contentVersion,
      });
      report = await this.reports.getWeaknesses({
        userId: context.userId,
        limit: input.data.limit,
        cursor: undefined,
        position,
      });
    }
    const nextCursor = report.nextPosition
      ? this.cursors?.issue(
          { ...bindingBase, contentVersion: report.contentVersion },
          report.nextPosition,
        )
      : null;
    if (report.nextPosition && !nextCursor) {
      throw new McpResourceHandlerError('INTERNAL_ERROR');
    }
    const result = mcpWeaknessResourceSchema.safeParse({
      kind: 'weaknesses',
      uri: URI,
      meta: {
        schemaVersion: MCP_SCHEMA_VERSION,
        contentVersion: report.contentVersion,
        updatedAt: report.updatedAt.toISOString(),
        truncated: report.truncated,
        nextCursor,
        traceId: context.traceId,
      },
      dataCompleteness: report.dataCompleteness,
      items: report.items,
    });
    if (!result.success) {
      throw new McpResourceHandlerError('INTERNAL_ERROR');
    }
    return result.data;
  }
}
