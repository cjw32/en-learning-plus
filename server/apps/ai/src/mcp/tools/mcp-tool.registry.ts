import type { McpServer } from '@modelcontextprotocol/server';
import type { McpRequestContext } from '../auth/mcp-principal';
import type { McpToolExecution } from './mcp-read-tool';

export type McpReadToolName =
  | 'search_words'
  | 'get_due_words'
  | 'search_learning_materials'
  | 'get_learning_report';
export type McpToolName = McpReadToolName | 'create_quiz' | 'submit_answer';

type ToolDefinition = Readonly<{
  description: string;
  inputSchema: object;
  outputSchema: object;
  annotations: object;
  _meta: Readonly<Record<string, unknown>>;
}>;

type ToolHandler = Readonly<{
  name: McpToolName;
  definition: ToolDefinition;
  execute(
    input: unknown,
    context: McpRequestContext,
    execution?: McpToolExecution,
  ): Promise<unknown>;
}>;

type RegistryOptions = Readonly<{
  authorization: Readonly<{
    assertActive(context: McpRequestContext): Promise<void>;
  }>;
  handlers: Readonly<Record<McpToolName, ToolHandler>>;
  isCapabilityEnabled?: (
    tool: McpToolName,
    context: McpRequestContext,
  ) => boolean;
}>;

const names = Object.freeze([
  'search_words',
  'get_due_words',
  'search_learning_materials',
  'get_learning_report',
  'create_quiz',
  'submit_answer',
] as const);

export class McpToolRegistryError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'INSUFFICIENT_SCOPE'
      | 'CAPABILITY_UNAVAILABLE',
  ) {
    super('The Tool is unavailable.');
    this.name = 'McpToolRegistryError';
  }
}

function isName(value: string): value is McpToolName {
  return names.includes(value as McpToolName);
}

function requiredScope(name: McpToolName) {
  if (name === 'create_quiz') return 'quiz:create' as const;
  if (name === 'submit_answer') return 'answer:submit' as const;
  return 'learning:read' as const;
}

export class McpToolRegistry {
  constructor(private readonly options: RegistryOptions) {}

  async call(
    name: string,
    untrustedInput: unknown,
    context: McpRequestContext,
    execution?: McpToolExecution,
  ): Promise<unknown> {
    if (!isName(name)) throw new McpToolRegistryError('VALIDATION_FAILED');
    await this.options.authorization.assertActive(context);
    if (!context.principal.scopes.includes(requiredScope(name))) {
      throw new McpToolRegistryError('INSUFFICIENT_SCOPE');
    }
    if (!this.isAllowed(name, context)) {
      throw new McpToolRegistryError('CAPABILITY_UNAVAILABLE');
    }
    return this.options.handlers[name].execute(
      untrustedInput,
      context,
      execution,
    );
  }

  register(
    server: McpServer,
    context: McpRequestContext,
  ): readonly McpToolName[] {
    const registered: McpToolName[] = [];
    for (const name of names) {
      if (!this.isAllowed(name, context)) continue;
      const handler = this.options.handlers[name];
      server.registerTool(
        name,
        handler.definition as never,
        (async (input: unknown, sdkContext: { signal?: AbortSignal }) => {
          const result = await this.call(name, input, context, {
            ...(sdkContext.signal ? { signal: sdkContext.signal } : {}),
          });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result),
              },
            ],
            structuredContent: result as Record<string, unknown>,
          };
        }) as never,
      );
      registered.push(name);
    }
    return Object.freeze(registered);
  }

  private isAllowed(name: McpToolName, context: McpRequestContext): boolean {
    return (
      context.principal.scopes.includes(requiredScope(name)) &&
      (this.options.isCapabilityEnabled?.(name, context) ?? true)
    );
  }
}
