import {
  MCP_SCHEMA_VERSION,
  mcpPromptResultSchema,
  mcpVocabularyReviewArgsSchema,
} from '@en/common/mcp';
import {
  McpPromptComposer,
  type McpPromptBuildContext,
} from './mcp-prompt-composer';

export class VocabularyReviewPromptBuilder {
  readonly name = 'vocabulary_review' as const;

  constructor(private readonly composer: McpPromptComposer) {}

  build(untrusted: unknown, context: McpPromptBuildContext) {
    const args = mcpVocabularyReviewArgsSchema.safeParse(untrusted);
    if (!args.success)
      throw Object.assign(new Error('Invalid prompt arguments'), {
        code: 'VALIDATION_FAILED',
      });
    const words =
      args.data.scope === 'weak_words'
        ? context.learner?.weakWords
        : context.learner?.dueWords;
    return mcpPromptResultSchema.parse({
      schemaVersion: MCP_SCHEMA_VERSION,
      name: this.name,
      promptVersion: 'vocabulary-review.v1',
      messages: [
        {
          role: 'user',
          content: this.composer.compose({
            title: 'Vocabulary review',
            task: `Guide a ${args.data.count}-item ${args.data.scope.replaceAll('_', ' ')} vocabulary review. If the supplied list is empty, explain that no current items are available and suggest a read-only lookup.`,
            learnerLevel: context.learner?.level,
            learnerGoal: context.learner?.goal,
            details: [
              `Available words: ${this.composer.list(words, args.data.count)}.`,
              `Exercise types: ${(args.data.types ?? ['MULTIPLE_CHOICE']).join(', ')}. Difficulty: ${args.data.difficulty ?? 'adaptive'}.`,
              `Course reference: ${this.composer.sanitize(args.data.courseId, 64)}.`,
            ],
          }),
        },
      ],
      recommendedReadTools: this.composer.visible(
        ['get_due_words', 'search_words'],
        context,
      ),
      writesRequireSeparateConfirmation: true,
      traceId: context.traceId,
    });
  }
}
