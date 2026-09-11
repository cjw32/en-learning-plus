import { McpPromptRegistry } from '../../src/mcp/prompts/mcp-prompt.registry';

function context(scopes: readonly string[] = ['learning:read']) {
  return {
    principal: { scopes },
    userId: 'learner_prompt_registry',
    traceId: 'trace_prompt_registry_0001',
  } as never;
}

describe('MCP prompt registry visibility', () => {
  it('degrades missing learner data and intersects recommended tools with the visible manifest', async () => {
    const build = jest.fn(async (_args, _context, visibleReadTools) => ({
      visibleReadTools,
    }));
    const registry = new McpPromptRegistry({
      authorization: { assertActive: jest.fn(async () => undefined) },
      handlers: {
        english_interview: { name: 'english_interview', build },
      } as never,
      visibleReadTools: () => ['search_words'],
    });
    await expect(
      registry.get('english_interview', { role: 'Engineer' }, context()),
    ).resolves.toEqual({ visibleReadTools: ['search_words'] });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('hides and rejects prompts immediately after scope revocation', async () => {
    const build = jest.fn();
    const registry = new McpPromptRegistry({
      authorization: { assertActive: jest.fn(async () => undefined) },
      handlers: {
        english_interview: { name: 'english_interview', build },
      } as never,
      visibleReadTools: () => [],
    });
    expect(registry.names(context([]))).toEqual([]);
    await expect(
      registry.get('english_interview', {}, context([])),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
    expect(build).not.toHaveBeenCalled();
  });
});
