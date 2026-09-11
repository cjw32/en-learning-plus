import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from '@en/common/coach/zod';
import type { McpRequestContext } from '../auth/mcp-principal';
import { McpResourceHandlerError } from './word.resource';

type ResourceHandler = Readonly<{
  read(input: unknown, context: McpRequestContext): Promise<unknown>;
}>;

export type McpResourceName =
  | 'word'
  | 'courseMaterial'
  | 'reviewsToday'
  | 'reportSummary'
  | 'weaknesses';

type RegistryOptions = Readonly<{
  authorization: Readonly<{
    assertActive(context: McpRequestContext): Promise<void>;
  }>;
  handlers: Readonly<Record<McpResourceName, ResourceHandler>>;
  isCapabilityEnabled?: (
    resource: McpResourceName,
    context: McpRequestContext,
  ) => boolean;
}>;

const genericRequestSchema = z
  .object({
    uri: z.string().min(1).max(512),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().min(24).max(512).optional(),
  })
  .strict();

const descriptors = Object.freeze([
  Object.freeze({
    key: 'word' as const,
    name: 'word',
    uri: 'en-learning://words/{wordId}',
    template: true,
    description: 'Read one rights-filtered dictionary entry.',
  }),
  Object.freeze({
    key: 'courseMaterial' as const,
    name: 'course-material',
    uri: 'en-learning://courses/{courseId}/materials/{materialId}',
    template: true,
    description: 'Read one entitled course material summary.',
  }),
  Object.freeze({
    key: 'reviewsToday' as const,
    name: 'reviews-today',
    uri: 'en-learning://me/reviews/today',
    template: false,
    description: "Read the current learner's due reviews.",
  }),
  Object.freeze({
    key: 'reportSummary' as const,
    name: 'report-summary',
    uri: 'en-learning://me/reports/summary',
    template: false,
    description: "Read the current learner's progress summary.",
  }),
  Object.freeze({
    key: 'weaknesses' as const,
    name: 'weaknesses',
    uri: 'en-learning://me/weaknesses',
    template: false,
    description: "Read the current learner's evidence-backed weaknesses.",
  }),
]);

function route(uri: string): McpResourceName {
  if (/^en-learning:\/\/words\/[A-Za-z0-9_-]{1,64}$/u.test(uri)) {
    return 'word';
  }
  if (
    /^en-learning:\/\/courses\/[A-Za-z0-9_-]{1,64}\/materials\/[A-Za-z0-9_-]{1,128}$/u.test(
      uri,
    )
  ) {
    return 'courseMaterial';
  }
  if (uri === 'en-learning://me/reviews/today') return 'reviewsToday';
  if (uri === 'en-learning://me/reports/summary') return 'reportSummary';
  if (uri === 'en-learning://me/weaknesses') return 'weaknesses';
  throw new McpResourceHandlerError('VALIDATION_FAILED');
}

export class McpResourceRegistry {
  constructor(private readonly options: RegistryOptions) {}

  async read(
    untrustedInput: unknown,
    context: McpRequestContext,
  ): Promise<unknown> {
    const input = genericRequestSchema.safeParse(untrustedInput);
    if (!input.success) {
      throw new McpResourceHandlerError('VALIDATION_FAILED');
    }
    const resource = route(input.data.uri);
    await this.options.authorization.assertActive(context);
    if (!this.isAllowed(resource, context)) {
      throw Object.assign(new Error('The capability is unavailable.'), {
        code: context.principal.scopes.includes('learning:read')
          ? 'CAPABILITY_UNAVAILABLE'
          : 'INSUFFICIENT_SCOPE',
      });
    }
    return this.options.handlers[resource].read(input.data, context);
  }

  register(
    server: McpServer,
    context: McpRequestContext,
  ): readonly McpResourceName[] {
    const registered: McpResourceName[] = [];
    for (const descriptor of descriptors) {
      if (!this.isAllowed(descriptor.key, context)) continue;
      const callback = async (requested: URL) => ({
        contents: [
          {
            uri: requested.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              await this.read({ uri: requested.href }, context),
            ),
          },
        ],
      });
      if (descriptor.template) {
        server.registerResource(
          descriptor.name,
          new ResourceTemplate(descriptor.uri, { list: undefined }),
          {
            description: descriptor.description,
            mimeType: 'application/json',
          },
          callback,
        );
      } else {
        server.registerResource(
          descriptor.name,
          descriptor.uri,
          {
            description: descriptor.description,
            mimeType: 'application/json',
          },
          callback,
        );
      }
      registered.push(descriptor.key);
    }
    return Object.freeze(registered);
  }

  private isAllowed(
    resource: McpResourceName,
    context: McpRequestContext,
  ): boolean {
    return (
      context.principal.scopes.includes('learning:read') &&
      (this.options.isCapabilityEnabled?.(resource, context) ?? true)
    );
  }
}
