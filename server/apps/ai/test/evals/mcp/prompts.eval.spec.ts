import cases from './fixtures/prompts.cases.json';

describe('mcp-prompts-rubric.v1', () => {
  it('has versioned positive/failure coverage and explicit safe read-tool expectations', () => {
    expect(cases.fixtureVersion).toBe('mcp-prompts.cases.v1');
    expect(cases.rubricVersion).toBe('mcp-prompts-rubric.v1');
    expect(new Set(cases.cases.map(({ kind }) => kind))).toEqual(
      new Set(['positive', 'failure']),
    );
    expect(
      cases.cases.every(({ expectedTool }) =>
        [
          'search_words',
          'get_due_words',
          'search_learning_materials',
          'get_learning_report',
        ].includes(expectedTool),
      ),
    ).toBe(true);
    expect(JSON.stringify(cases)).not.toMatch(
      /submit_answer|create_quiz|real learner|@/iu,
    );
  });
});
