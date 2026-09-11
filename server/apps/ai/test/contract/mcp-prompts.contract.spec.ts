import {
  mcpBusinessEnglishArgsSchema,
  mcpEnglishInterviewArgsSchema,
  mcpPromptResultSchema,
  mcpVocabularyReviewArgsSchema,
} from '@en/common/mcp';
import { McpPromptComposer } from '../../src/mcp/prompts/mcp-prompt-composer';
import { EnglishInterviewPromptBuilder } from '../../src/mcp/prompts/english-interview.prompt';
import { BusinessEnglishPromptBuilder } from '../../src/mcp/prompts/business-english.prompt';
import { VocabularyReviewPromptBuilder } from '../../src/mcp/prompts/vocabulary-review.prompt';

const context = Object.freeze({
  traceId: 'trace_prompt_contract_0001',
  learner: Object.freeze({
    level: 'B1',
    goal: 'Business fluency',
    dueWords: ['agenda'],
    weakWords: ['schedule'],
  }),
  visibleReadTools: Object.freeze([
    'search_words',
    'get_due_words',
    'search_learning_materials',
    'get_learning_report',
  ] as const),
});

describe('MCP prompt contracts', () => {
  it('keeps all argument schemas strict and bounded', () => {
    expect(
      mcpEnglishInterviewArgsSchema.safeParse({
        role: 'Engineer',
        unknown: true,
      }).success,
    ).toBe(false);
    expect(
      mcpBusinessEnglishArgsSchema.safeParse({
        scenario: 'meeting',
        targetExpression: 'x'.repeat(501),
      }).success,
    ).toBe(false);
    expect(mcpVocabularyReviewArgsSchema.safeParse({ count: 21 }).success).toBe(
      false,
    );
  });

  it.each([
    [
      'english_interview',
      () =>
        new EnglishInterviewPromptBuilder(new McpPromptComposer()).build(
          {
            role: 'Engineer',
            rounds: 5,
            durationMinutes: 20,
            feedbackEachRound: true,
          },
          context,
        ),
    ],
    [
      'business_english',
      () =>
        new BusinessEnglishPromptBuilder(new McpPromptComposer()).build(
          { scenario: 'meeting' },
          context,
        ),
    ],
    [
      'vocabulary_review',
      () =>
        new VocabularyReviewPromptBuilder(new McpPromptComposer()).build(
          { scope: 'due_today', count: 10 },
          context,
        ),
    ],
  ] as const)('returns a strict %s MCP prompt result', (name, build) => {
    const result = build();
    expect(mcpPromptResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      name,
      writesRequireSeparateConfirmation: true,
      traceId: context.traceId,
    });
    expect(result.messages.every(({ role }) => role === 'user')).toBe(true);
  });
});
