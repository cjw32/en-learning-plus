import { z } from '@en/common/coach/zod';

export const mcpVisibleReadToolSchema = z.enum([
  'search_words',
  'get_due_words',
  'search_learning_materials',
  'get_learning_report',
]);

export type McpVisibleReadTool = z.infer<typeof mcpVisibleReadToolSchema>;
export type McpPromptBuildContext = Readonly<{
  traceId: string;
  learner?: Readonly<{
    level?: string | null;
    goal?: string | null;
    dueWords?: readonly string[];
    weakWords?: readonly string[];
  }>;
  visibleReadTools: readonly McpVisibleReadTool[];
}>;

const unsafeInstruction =
  /(?:\b(?:system|assistant|developer)\s*:|<\/?(?:instructions?|tool_call)[^>]*>|\binternal[_ -]?prompt(?:[_ -][a-z]+)*\b|\b(?:ignore|override|reveal)\b[^.\n]{0,100}\b(?:instruction|prompt|rule)s?\b|\b(?:submit_answer|create_quiz)\b|\bdelete\s+everything\b)/giu;

export class McpPromptCompositionError extends Error {
  readonly code = 'VALIDATION_FAILED';

  constructor() {
    super('The prompt could not be composed.');
    this.name = 'McpPromptCompositionError';
  }
}

export class McpPromptComposer {
  sanitize(value: unknown, maximum = 500): string {
    if (typeof value !== 'string') return 'not available';
    const normalized = value
      .normalize('NFKC')
      .replace(/\p{Cc}/gu, ' ')
      .replace(unsafeInstruction, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, maximum);
    return normalized || 'not available';
  }

  list(values: readonly string[] | undefined, maximum = 10): string {
    const safe = (values ?? [])
      .slice(0, maximum)
      .map((value) => this.sanitize(value, 100))
      .filter((value) => value !== 'not available');
    return safe.length ? safe.join(', ') : 'none currently available';
  }

  compose(
    input: Readonly<{
      title: string;
      task: string;
      learnerLevel?: unknown;
      learnerGoal?: unknown;
      details: readonly string[];
    }>,
  ): string {
    const parts = [
      this.sanitize(input.title, 200),
      this.sanitize(input.task, 2_000),
      `Learner level: ${this.sanitize(input.learnerLevel, 32)}.`,
      `Learner goal: ${this.sanitize(input.learnerGoal, 500)}.`,
      ...input.details.map((detail) => this.sanitize(detail, 2_000)),
      'Use learner-visible information only. Suggested tools are optional read-only lookups; do not call tools, models, or writes while rendering this prompt.',
      'Any later learning write requires a separate, server-verified confirmation.',
    ];
    const content = parts.join('\n');
    if (content.length > 12_000) throw new McpPromptCompositionError();
    return content;
  }

  visible(
    requested: readonly McpVisibleReadTool[],
    context: McpPromptBuildContext,
  ): McpVisibleReadTool[] {
    const visible = new Set(context.visibleReadTools);
    return requested.filter((name) => visible.has(name));
  }
}
