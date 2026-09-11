import {
  MCP_SCHEMA_VERSION,
  mcpWordResourceSchema,
  type McpResourceContent,
} from '@en/common/mcp';
import { z } from '@en/common/coach/zod';
import type { WordDictionaryService } from '@libs/learning';
import type { McpRequestContext } from '../auth/mcp-principal';

const requestSchema = z.object({ uri: z.string().max(512) }).strict();
const wordIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

export class McpResourceHandlerError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'INTERNAL_ERROR') {
    super(
      code === 'VALIDATION_FAILED'
        ? 'The Resource request is invalid.'
        : 'The Resource result is unavailable.',
    );
    this.name = 'McpResourceHandlerError';
  }
}

function wordIdFromUri(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new McpResourceHandlerError('VALIDATION_FAILED');
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const wordId = segments[0];
  if (
    parsed.protocol !== 'en-learning:' ||
    parsed.hostname !== 'words' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    segments.length !== 1 ||
    !wordId ||
    !wordIdPattern.test(wordId)
  ) {
    throw new McpResourceHandlerError('VALIDATION_FAILED');
  }
  return wordId;
}

export class McpWordResource {
  constructor(
    private readonly dictionary: Pick<WordDictionaryService, 'get'>,
  ) {}

  async read(
    untrustedInput: unknown,
    context: McpRequestContext,
  ): Promise<McpResourceContent> {
    const input = requestSchema.safeParse(untrustedInput);
    if (!input.success) {
      throw new McpResourceHandlerError('VALIDATION_FAILED');
    }
    const wordId = wordIdFromUri(input.data.uri);
    const entry = await this.dictionary.get({ wordId });
    const result = mcpWordResourceSchema.safeParse({
      kind: 'word',
      uri: input.data.uri,
      meta: {
        schemaVersion: MCP_SCHEMA_VERSION,
        contentVersion: entry.contentVersion,
        updatedAt: entry.updatedAt.toISOString(),
        truncated: false,
        nextCursor: null,
        traceId: context.traceId,
      },
      word: entry.word,
      forms: entry.forms,
      examples: entry.examples,
      source: entry.source,
    });
    if (!result.success) {
      throw new McpResourceHandlerError('INTERNAL_ERROR');
    }
    return result.data;
  }
}
