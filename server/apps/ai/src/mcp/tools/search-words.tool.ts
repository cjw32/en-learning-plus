import { createHash } from 'node:crypto';
import {
  MCP_SCHEMA_VERSION,
  mcpSearchWordsInputSchema,
  mcpSearchWordsSuccessSchema,
  type McpToolResult,
} from '@en/common/mcp';
import type { WordDictionaryService } from '@libs/learning';
import type { McpRequestContext } from '../auth/mcp-principal';
import type { McpCursorService } from '../pagination/mcp-cursor.service';
import { validateMcpResult } from '../results/mcp-result-validator';
import {
  assertExecutionOpen,
  createReadToolDefinition,
  McpReadToolError,
  type McpToolExecution,
  normalizeSafeQuery,
} from './mcp-read-tool';

const CURSOR_RESOURCE = 'tool:search_words';
const CURSOR_CONTENT_VERSION = 'word-dictionary-search.v1';

type Dictionary = Pick<WordDictionaryService, 'search'>;

function filterHash(
  input: Readonly<{
    query: string;
    cefr?: string;
    courseId?: string;
    limit: number;
  }>,
): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('base64url');
}

export class McpSearchWordsTool {
  readonly name = 'search_words' as const;
  readonly definition = createReadToolDefinition({
    name: this.name,
    description:
      'Search rights-filtered public dictionary entries without changing learning state.',
    inputSchema: mcpSearchWordsInputSchema,
    outputSchema: mcpSearchWordsSuccessSchema,
    deadlineMs: 3_000,
    budgetPolicy: 'none',
  });

  constructor(
    private readonly dictionary: Dictionary,
    private readonly cursors?: Pick<McpCursorService, 'issue' | 'verify'>,
  ) {}

  async execute(
    untrustedInput: unknown,
    context: McpRequestContext,
    execution?: McpToolExecution,
  ): Promise<McpToolResult> {
    assertExecutionOpen(execution);
    const parsed = mcpSearchWordsInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw new McpReadToolError('VALIDATION_FAILED');
    const query = normalizeSafeQuery(parsed.data.query);
    const filters = {
      query,
      ...(parsed.data.cefr ? { cefr: parsed.data.cefr } : {}),
      ...(parsed.data.courseId ? { courseId: parsed.data.courseId } : {}),
      limit: parsed.data.limit,
    };
    const binding = {
      principalKey: 'public-dictionary',
      resource: CURSOR_RESOURCE,
      filterHash: filterHash(filters),
      contentVersion: CURSOR_CONTENT_VERSION,
    };
    let afterId: string | undefined;
    if (parsed.data.cursor) {
      if (!this.cursors) throw new McpReadToolError('CURSOR_INVALID');
      const position = this.cursors.verify(parsed.data.cursor, binding);
      afterId = position.tieBreaker;
    }

    assertExecutionOpen(execution);
    const page = await this.dictionary.search({
      query,
      limit: parsed.data.limit,
      ...(parsed.data.cefr ? { cefr: parsed.data.cefr } : {}),
      ...(afterId ? { afterId } : {}),
    });
    assertExecutionOpen(execution);
    const last = page.items.at(-1);
    const nextCursor =
      page.hasMore && last
        ? this.cursors?.issue(binding, {
            sortValue: last.word.word,
            tieBreaker: last.word.wordId,
          })
        : null;
    if (page.hasMore && !nextCursor) {
      throw new McpReadToolError('INTERNAL_ERROR');
    }
    return validateMcpResult(mcpSearchWordsSuccessSchema, {
      schemaVersion: MCP_SCHEMA_VERSION,
      ok: true,
      query,
      items: page.items.map((entry) => entry.word),
      nextCursor,
      traceId: context.traceId,
    });
  }
}
