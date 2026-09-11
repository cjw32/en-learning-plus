import type { McpServer } from '@modelcontextprotocol/server';
import type { McpRequestContext } from '../auth/mcp-principal';
import type { McpVisibleReadTool } from './mcp-prompt-composer';

export type McpPromptName =
  | 'english_interview'
  | 'business_english'
  | 'vocabulary_review';

type Handler = Readonly<{
  name: McpPromptName;
  build(
    args: unknown,
    context: McpRequestContext,
    visibleReadTools: readonly McpVisibleReadTool[],
  ): unknown;
}>;

export class McpPromptRegistryError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'INSUFFICIENT_SCOPE'
      | 'CAPABILITY_UNAVAILABLE',
  ) {
    super('The Prompt is unavailable.');
    this.name = 'McpPromptRegistryError';
  }
}

const promptNames = Object.freeze([
  'english_interview',
  'business_english',
  'vocabulary_review',
] as const);

export class McpPromptRegistry {
  constructor(
    private readonly options: Readonly<{
      authorization: Readonly<{
        assertActive(context: McpRequestContext): Promise<void>;
      }>;
      handlers: Partial<Record<McpPromptName, Handler>>;
      visibleReadTools(
        context: McpRequestContext,
      ): readonly McpVisibleReadTool[];
      isCapabilityEnabled?: (
        name: McpPromptName,
        context: McpRequestContext,
      ) => boolean;
    }>,
  ) {}

  names(context: McpRequestContext): readonly McpPromptName[] {
    if (!context.principal.scopes.includes('learning:read')) return [];
    return promptNames.filter(
      (name) =>
        Boolean(this.options.handlers[name]) &&
        (this.options.isCapabilityEnabled?.(name, context) ?? true),
    );
  }

  async get(
    name: string,
    args: unknown,
    context: McpRequestContext,
  ): Promise<unknown> {
    await this.options.authorization.assertActive(context);
    if (!context.principal.scopes.includes('learning:read')) {
      throw new McpPromptRegistryError('INSUFFICIENT_SCOPE');
    }
    if (!promptNames.includes(name as McpPromptName)) {
      throw new McpPromptRegistryError('VALIDATION_FAILED');
    }
    const promptName = name as McpPromptName;
    const handler = this.options.handlers[promptName];
    if (
      !handler ||
      !(this.options.isCapabilityEnabled?.(promptName, context) ?? true)
    ) {
      throw new McpPromptRegistryError('CAPABILITY_UNAVAILABLE');
    }
    const visible = Object.freeze([
      ...new Set(this.options.visibleReadTools(context)),
    ]);
    return handler.build(args, context, visible);
  }

  register(
    server: McpServer,
    context: McpRequestContext,
  ): readonly McpPromptName[] {
    const names = this.names(context);
    for (const name of names) {
      server.registerPrompt(
        name,
        { description: `${name.replaceAll('_', ' ')} guided learning prompt` },
        (async (args: unknown) => {
          const result = (await this.get(name, args, context)) as {
            messages: readonly { role: 'user'; content: string }[];
          };
          return {
            messages: result.messages.map((message) => ({
              role: message.role,
              content: { type: 'text' as const, text: message.content },
            })),
          };
        }) as never,
      );
    }
    return names;
  }
}
