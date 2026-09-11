import { createHash } from 'node:crypto';
import {
  MCP_SCHEMA_VERSION,
  mcpGetDueWordsInputSchema,
  mcpGetDueWordsSuccessSchema,
  type McpToolResult,
} from '@en/common/mcp';
import type { ReviewScheduleService } from '@libs/learning';
import type { McpRequestContext } from '../auth/mcp-principal';
import type { McpCursorService } from '../pagination/mcp-cursor.service';
import { validateMcpResult } from '../results/mcp-result-validator';
import {
  assertExecutionOpen,
  createReadToolDefinition,
  McpReadToolError,
  type McpToolExecution,
} from './mcp-read-tool';

const CURSOR_RESOURCE = 'tool:get_due_words';

type Schedules = Pick<ReviewScheduleService, 'getDueWords'>;

function principalKey(context: McpRequestContext): string {
  return createHash('sha256')
    .update(`${context.principal.issuer}\0${context.authorizationId}`)
    .digest('base64url');
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new McpReadToolError('INTERNAL_ERROR');
  return date.toISOString();
}

export class McpGetDueWordsTool {
  readonly name = 'get_due_words' as const;
  readonly definition = createReadToolDefinition({
    name: this.name,
    description:
      "Read the current learner's due words in stable schedule order without changing review state.",
    inputSchema: mcpGetDueWordsInputSchema,
    outputSchema: mcpGetDueWordsSuccessSchema,
    deadlineMs: 3_000,
    budgetPolicy: 'none',
  });

  constructor(
    private readonly schedules: Schedules,
    private readonly cursors?: Pick<McpCursorService, 'issue' | 'verify'>,
  ) {}

  async execute(
    untrustedInput: unknown,
    context: McpRequestContext,
    execution?: McpToolExecution,
  ): Promise<McpToolResult> {
    assertExecutionOpen(execution);
    const parsed = mcpGetDueWordsInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw new McpReadToolError('VALIDATION_FAILED');

    const filters = {
      learningDate: parsed.data.learningDate,
      timezone: parsed.data.timezone,
      ...(parsed.data.courseId ? { courseId: parsed.data.courseId } : {}),
    };
    const domain = await this.schedules.getDueWords(context.userId, {
      ...filters,
      // Fetch one bounded stable window so an opaque keyset cursor can page it.
      limit: 100,
    });
    assertExecutionOpen(execution);
    const ordered = [...domain.words]
      .map((word) => ({
        wordId: word.wordId,
        word: word.word,
        reviewState: word.reviewState,
        dueAt: isoDateTime(word.dueAt),
        priority: word.priority,
        reason: word.reason,
      }))
      .sort(
        (left, right) =>
          left.dueAt.localeCompare(right.dueAt) ||
          left.priority - right.priority ||
          left.wordId.localeCompare(right.wordId),
      );
    const contentVersion = `due.${hash({
      userId: context.userId,
      totalDue: domain.totalDue,
      items: ordered.map(({ wordId, reviewState, dueAt }) => ({
        wordId,
        reviewState,
        dueAt,
      })),
    }).slice(0, 32)}`;
    const binding = {
      principalKey: principalKey(context),
      resource: CURSOR_RESOURCE,
      filterHash: hash(filters),
      contentVersion,
    };
    let start = 0;
    if (parsed.data.cursor) {
      if (!this.cursors) throw new McpReadToolError('CURSOR_INVALID');
      const position = this.cursors.verify(parsed.data.cursor, binding);
      const index = ordered.findIndex(
        (item) =>
          item.dueAt === position.sortValue &&
          item.wordId === position.tieBreaker,
      );
      if (index < 0) throw new McpReadToolError('CURSOR_INVALID');
      start = index + 1;
    }
    const items = ordered.slice(start, start + parsed.data.limit);
    const hasMore =
      ordered.length > start + items.length || domain.totalDue > ordered.length;
    const last = items.at(-1);
    const nextCursor =
      hasMore && last
        ? this.cursors?.issue(binding, {
            sortValue: last.dueAt,
            tieBreaker: last.wordId,
          })
        : null;
    if (hasMore && !nextCursor) throw new McpReadToolError('INTERNAL_ERROR');
    return validateMcpResult(mcpGetDueWordsSuccessSchema, {
      schemaVersion: MCP_SCHEMA_VERSION,
      ok: true,
      asOf: isoDateTime(domain.asOf),
      totalDue: domain.totalDue,
      items,
      nextCursor,
      traceId: context.traceId,
    });
  }
}
