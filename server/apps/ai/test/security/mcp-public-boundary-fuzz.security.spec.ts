import { EventEmitter } from 'node:events';
import {
  MCP_SCHEMA_VERSION,
  mcpConfirmationSelectorSchema,
  mcpCreateQuizInputSchema,
  mcpIdentifierSchema,
  mcpInitializeInputSchema,
  mcpOpaqueCursorSchema,
  mcpPromptRequestSchema,
  mcpSubmitAnswerInputSchema,
} from '@en/common/mcp';
import { McpResourceRegistry } from '../../src/mcp/resources/mcp-resource.registry';
import { bindMcpAbortSignal } from '../../src/mcp/transport/mcp-http-boundary';

function seededStrings(seed = 0x5eed, count = 128): string[] {
  let state = seed >>> 0;
  const alphabet = [
    'a',
    '/',
    '.',
    '%',
    '\\',
    '\u0000',
    '\u202e',
    '💥',
    '[',
    '{',
    ':',
  ];
  return Array.from({ length: count }, (_, index) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    const length = index % 11 === 0 ? 600 : state % 160;
    return Array.from(
      { length },
      (__, offset) => alphabet[(state + offset * 17) % alphabet.length],
    ).join('');
  });
}

describe('MCP public-boundary seeded fuzz', () => {
  it('rejects malformed identifiers, cursors and URL selectors deterministically without throwing', () => {
    for (const value of seededStrings()) {
      const first = [
        mcpIdentifierSchema.safeParse(value).success,
        mcpOpaqueCursorSchema.safeParse(value).success,
        mcpConfirmationSelectorSchema.safeParse(value).success,
      ];
      const second = [
        mcpIdentifierSchema.safeParse(value).success,
        mcpOpaqueCursorSchema.safeParse(value).success,
        mcpConfirmationSelectorSchema.safeParse(value).success,
      ];
      expect(second).toEqual(first);
    }
  });

  it('rejects malformed/deep/oversized public payloads before any business handler', async () => {
    const business = jest.fn();
    const context = { principal: { scopes: ['learning:read'] } } as never;
    const registry = new McpResourceRegistry({
      authorization: { assertActive: async () => undefined },
      handlers: {
        word: { read: business },
        courseMaterial: { read: business },
        reviewsToday: { read: business },
        reportSummary: { read: business },
        weaknesses: { read: business },
      },
    });
    const malformed = seededStrings(1234, 96).map((value, index) =>
      index % 3 === 0
        ? { uri: value, nested: { value } }
        : index % 3 === 1
          ? { uri: `https://attacker.invalid/${value}` }
          : { uri: ['en-learning://me/weaknesses'] },
    );
    for (const input of malformed)
      await expect(registry.read(input, context)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    expect(business).not.toHaveBeenCalled();

    const payloads = [
      {
        schema: mcpInitializeInputSchema,
        value: {
          protocolVersion: '0',
          capabilities: {},
          clientInfo: { name: 'x'.repeat(121), version: '1' },
          extra: true,
        },
      },
      {
        schema: mcpCreateQuizInputSchema,
        value: {
          schemaVersion: MCP_SCHEMA_VERSION,
          types: ['SHORT_ANSWER'],
          count: 1,
          difficulty: 'MEDIUM',
          scenario: 'x'.repeat(1001),
          idempotencyKey: 'k'.repeat(16),
        },
      },
      {
        schema: mcpSubmitAnswerInputSchema,
        value: {
          schemaVersion: MCP_SCHEMA_VERSION,
          exerciseId: 'exercise_123',
          answers: Array.from({ length: 51 }, (_, index) => ({
            itemId: `i_${index}`,
            value: 'x',
          })),
          idempotencyKey: 'k'.repeat(16),
        },
      },
      {
        schema: mcpPromptRequestSchema,
        value: {
          name: 'english_interview',
          arguments: { role: { nested: { deeper: true } } },
        },
      },
    ];
    for (const item of payloads)
      expect(item.schema.safeParse(item.value).success).toBe(false);
  });

  it('propagates request/response cancellation without starting work', () => {
    for (const event of ['aborted', 'close']) {
      const request = new EventEmitter();
      const response = new EventEmitter();
      const signal = bindMcpAbortSignal(request, response);
      expect(signal.aborted).toBe(false);
      (event === 'aborted' ? request : response).emit(event);
      expect(signal.aborted).toBe(true);
    }
  });
});
