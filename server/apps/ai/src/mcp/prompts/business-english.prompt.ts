import {
  MCP_SCHEMA_VERSION,
  mcpBusinessEnglishArgsSchema,
  mcpPromptResultSchema,
} from '@en/common/mcp';
import {
  McpPromptComposer,
  type McpPromptBuildContext,
} from './mcp-prompt-composer';

export class BusinessEnglishPromptBuilder {
  readonly name = 'business_english' as const;

  constructor(private readonly composer: McpPromptComposer) {}

  build(untrusted: unknown, context: McpPromptBuildContext) {
    const args = mcpBusinessEnglishArgsSchema.safeParse(untrusted);
    if (!args.success)
      throw Object.assign(new Error('Invalid prompt arguments'), {
        code: 'VALIDATION_FAILED',
      });
    return mcpPromptResultSchema.parse({
      schemaVersion: MCP_SCHEMA_VERSION,
      name: this.name,
      promptVersion: 'business-english.v1',
      messages: [
        {
          role: 'user',
          content: this.composer.compose({
            title: 'Business English guided practice',
            task: `Create a realistic ${args.data.scenario} practice with clear roles, an objective, model phrases, and a short reflection.`,
            learnerLevel: args.data.level ?? context.learner?.level,
            learnerGoal: context.learner?.goal,
            details: [
              `Difficulty: ${args.data.difficulty ?? 'adapt to the learner level'}.`,
              `Target expression: ${this.composer.sanitize(args.data.targetExpression, 500)}.`,
            ],
          }),
        },
      ],
      recommendedReadTools: this.composer.visible(
        ['search_learning_materials', 'search_words', 'get_learning_report'],
        context,
      ),
      writesRequireSeparateConfirmation: true,
      traceId: context.traceId,
    });
  }
}
