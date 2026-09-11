import {
  MCP_SCHEMA_VERSION,
  mcpEnglishInterviewArgsSchema,
  mcpPromptResultSchema,
} from '@en/common/mcp';
import {
  McpPromptComposer,
  type McpPromptBuildContext,
} from './mcp-prompt-composer';

export class EnglishInterviewPromptBuilder {
  readonly name = 'english_interview' as const;

  constructor(private readonly composer: McpPromptComposer) {}

  build(untrusted: unknown, context: McpPromptBuildContext) {
    const args = mcpEnglishInterviewArgsSchema.safeParse(untrusted);
    if (!args.success)
      throw Object.assign(new Error('Invalid prompt arguments'), {
        code: 'VALIDATION_FAILED',
      });
    return mcpPromptResultSchema.parse({
      schemaVersion: MCP_SCHEMA_VERSION,
      name: this.name,
      promptVersion: 'english-interview.v1',
      messages: [
        {
          role: 'user',
          content: this.composer.compose({
            title: 'English interview practice',
            task: `Run ${args.data.rounds} interview rounds for the role ${this.composer.sanitize(args.data.role, 120)} within about ${args.data.durationMinutes} minutes. ${args.data.feedbackEachRound ? 'Give concise feedback after each round.' : 'Give consolidated feedback after the final round.'}`,
            learnerLevel: args.data.level ?? context.learner?.level,
            learnerGoal: context.learner?.goal,
            details: [
              `Difficulty: ${args.data.difficulty ?? 'adapt to the learner level'}.`,
              'Ask one question at a time and wait for the learner response.',
            ],
          }),
        },
      ],
      recommendedReadTools: this.composer.visible(
        ['get_learning_report', 'search_learning_materials'],
        context,
      ),
      writesRequireSeparateConfirmation: true,
      traceId: context.traceId,
    });
  }
}
