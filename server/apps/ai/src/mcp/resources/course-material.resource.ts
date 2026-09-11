import {
  MCP_SCHEMA_VERSION,
  mcpCourseMaterialResourceSchema,
  type McpResourceContent,
} from '@en/common/mcp';
import { z } from '@en/common/coach/zod';
import type { LearningResourceReadService } from '@libs/learning';
import type { McpRequestContext } from '../auth/mcp-principal';
import { McpResourceHandlerError } from './word.resource';

const requestSchema = z.object({ uri: z.string().max(512) }).strict();
const identifier = /^[A-Za-z0-9_-]{1,128}$/;

function identifiersFromUri(uri: string): Readonly<{
  courseId: string;
  materialId: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new McpResourceHandlerError('VALIDATION_FAILED');
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const [courseId, materials, materialId] = segments;
  if (
    parsed.protocol !== 'en-learning:' ||
    parsed.hostname !== 'courses' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    segments.length !== 3 ||
    materials !== 'materials' ||
    !courseId ||
    courseId.length > 64 ||
    !identifier.test(courseId) ||
    !materialId ||
    !identifier.test(materialId)
  ) {
    throw new McpResourceHandlerError('VALIDATION_FAILED');
  }
  return Object.freeze({ courseId, materialId });
}

export class McpCourseMaterialResource {
  constructor(
    private readonly resources: Pick<
      LearningResourceReadService,
      'readCourseMaterial'
    >,
  ) {}

  async read(
    untrustedInput: unknown,
    context: McpRequestContext,
  ): Promise<McpResourceContent> {
    const input = requestSchema.safeParse(untrustedInput);
    if (!input.success) {
      throw new McpResourceHandlerError('VALIDATION_FAILED');
    }
    const identifiers = identifiersFromUri(input.data.uri);
    const material = await this.resources.readCourseMaterial({
      userId: context.userId,
      ...identifiers,
    });
    const result = mcpCourseMaterialResourceSchema.safeParse({
      kind: 'course_material',
      uri: input.data.uri,
      meta: {
        schemaVersion: MCP_SCHEMA_VERSION,
        contentVersion: material.contentVersion,
        updatedAt: material.updatedAt.toISOString(),
        truncated: false,
        nextCursor: null,
        traceId: context.traceId,
      },
      courseId: material.courseId,
      materialId: material.materialId,
      title: material.title,
      summary: material.summary,
      locator: material.locator,
      source: material.source,
    });
    if (!result.success) {
      throw new McpResourceHandlerError('INTERNAL_ERROR');
    }
    return result.data;
  }
}
