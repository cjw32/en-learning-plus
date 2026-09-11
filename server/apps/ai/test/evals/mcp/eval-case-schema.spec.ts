import { validateEvalPackage } from './mcp-fixture-loader';

describe('MCP eval case schema', () => {
  const categories = [
    'protocol',
    'resources',
    'tools',
    'prompts',
    'confirmation',
    'duplicate_write',
    'cancellation',
    'injection',
    'isolation',
  ] as const;
  const valid = {
    fixtureVersion: 'mcp-eval-cases.v1',
    rubricVersion: 'mcp-rubrics.v1',
    cases: categories.flatMap((category) =>
      (['positive', 'failure'] as const).map((kind) => ({
        id: `${category}_${kind}`,
        category,
        kind,
        synthetic: true,
        expected: {
          source: kind === 'positive' ? 'synthetic://fixture' : null,
          tool: null,
          action: kind === 'positive' ? 'allow' : 'deny',
        },
        zeroTolerance: kind === 'failure' ? ['unauthorized_capability'] : [],
      })),
    ),
  };

  it('loads an immutable, explicit positive/failure pair per capability category', () => {
    const loaded = validateEvalPackage(valid);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(loaded.cases).toHaveLength(categories.length * 2);
  });

  it.each([
    { ...valid, fixtureVersion: 'latest' },
    {
      ...valid,
      cases: valid.cases.filter((item) => item.id !== 'isolation_failure'),
    },
    {
      ...valid,
      cases: valid.cases.map((item, index) =>
        index ? item : { ...item, synthetic: false },
      ),
    },
  ])(
    'rejects drift, missing failure coverage, and learner-derived data',
    (candidate) => {
      expect(() => validateEvalPackage(candidate)).toThrow();
    },
  );
});
