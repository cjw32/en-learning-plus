import { resolve } from 'node:path';
import { subject, evaluationCase } from './test-support';
const cli = subject('core/cli-options');
const scope = subject('core/scope');
const catalog = subject('catalog/catalog');
const root = resolve(__dirname, '../../../../../../..');
const entries = [
  evaluationCase,
  {
    ...evaluationCase,
    caseId: 'rag:one',
    module: 'rag',
    tags: ['retrieval'],
    risk: 'low',
  },
];
describe('T020 scope and CLI contract', () => {
  test('defaults to all modules, bounded zero-cost quick check', () => {
    expect(
      cli.parseOptions?.(['run', '--output', '/tmp/test-run']),
    ).toMatchObject({
      command: 'run',
      modules: ['coach', 'rag', 'pronunciation', 'mcp'],
      profile: 'quick',
      purpose: 'check',
      modes: ['deterministic', 'mock', 'replay'],
      limits: { budgetMicros: 0, concurrency: 1 },
    });
  });
  test.each([
    ['run', '--unknown', 'yes'],
    ['run', '--modules', 'all,coach'],
    ['run', '--modules', 'bad'],
    ['run', '--concurrency', '0'],
    ['run', '--repeat', '1.5'],
    ['run', '--budget-micros', 'NaN'],
    ['run', '--profile', 'quick', '--mode', 'live'],
    ['run', '--profile', 'quick', '--budget-micros', '2'],
    ['run', '--modules', 'coach', '--modules', 'rag'],
    ['run', '--api-key', 'not-allowed'],
    ['run', '--baseline', 'one', '--baseline-candidate', 'two'],
    ['run', '--baseline-config', 'orphan'],
  ])('rejects invalid configuration %#', (args) =>
    expect(() =>
      cli.parseOptions?.([...args, '--output', '/tmp/test-run']),
    ).toThrow(),
  );
  test('filters OR within category, AND across categories; qualification required set is independent', () => {
    const filter = {
      modules: ['coach', 'rag'],
      caseIds: [],
      tags: ['schema', 'retrieval'],
      risks: ['high'],
      modes: ['mock'],
      purpose: 'qualification',
    };
    expect(
      scope.selectCases?.(entries, filter, {
        requiredCaseIds: entries.map((c) => c.caseId),
        requiredModes: ['live'],
      }),
    ).toMatchObject({
      selected: [evaluationCase],
      missingRequirements: expect.arrayContaining(['rag:one', 'mode:live']),
    });
    expect(() =>
      scope.selectCases?.(
        entries,
        { ...filter, tags: ['misspelt'] },
        { requiredCaseIds: [], requiredModes: [] },
      ),
    ).toThrow('INVALID_FILTER');
    expect(() =>
      scope.selectCases?.(
        entries,
        { ...filter, caseIds: ['rag:one'], tags: ['schema'] },
        { requiredCaseIds: [], requiredModes: [] },
      ),
    ).toThrow('ZERO_CASES');
  });
  test('unmapped change expands to all; shared contracts expand affected modules', () => {
    expect(scope.affectedModules?.(['unknown/new-file.ts'])).toEqual([
      'coach',
      'rag',
      'pronunciation',
      'mcp',
    ]);
    expect(
      scope.affectedModules?.([
        'server/apps/ai/src/coach/workflow/coach.graph.ts',
      ]),
    ).toEqual(expect.arrayContaining(['coach', 'rag', 'mcp']));
  });
  test('catalog preserves stable IDs, mandatory coverage and source hashes', () => {
    const loaded = catalog.loadCatalog?.(root);
    expect(loaded?.cases.length).toBeGreaterThanOrEqual(123);
    expect(new Set(loaded?.cases.map((c) => c.caseId)).size).toBe(
      loaded?.cases.length,
    );
    expect(
      loaded?.cases.every(
        (c) =>
          c.legacyRef?.hash &&
          c.split === 'development' &&
          c.requirements.length,
      ),
    ).toBe(true);
  });
});

test.each(['--run-timeout-ms', '--case-timeout-ms'])(
  'rejects %s beyond Node timer range instead of silently scheduling 1ms',
  (flag) => {
    expect(() =>
      cli.parseOptions(['run', '--output', '/tmp', flag, '2147483648']),
    ).toThrow();
  },
);
