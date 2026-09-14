import { resolve } from 'node:path';
import { subject } from './test-support';
const root = resolve(__dirname, '../../../../../../..');
const modules = ['coach', 'rag', 'pronunciation', 'mcp'];
describe('T021 legacy catalog preservation', () => {
  test.each([
    ['coach', 60],
    ['rag', 42],
    ['pronunciation', 3],
    ['mcp', 18],
  ])('preserves %s primary cases', (module, count) => {
    const api = subject(`catalog/${module}.catalog`);
    const loaded = api.sources?.(root);
    expect(loaded?.primaryCount).toBe(count);
    expect(loaded?.records.length).toBeGreaterThanOrEqual(count);
    expect(loaded?.records.every((r) => r.id && r.path && r.hash)).toBe(true);
  });
});
describe('T021 adapters observe calls, never manufacture actual from expected', () => {
  test.each(modules)(
    '%s retains the actual returned value and explicit mode',
    async (module) => {
      const adapter = subject(`adapters/${module}.adapter`);
      const observed: unknown[] = [];
      const value = {
        input: { query: 'synthetic' },
        expected: { answer: 'never-copy' },
      };
      const result = await adapter.observe?.(value.input, {
        mode: 'mock',
        invoke: async (input) => {
          observed.push(input);
          return { answer: 'actual' };
        },
      });
      expect(observed).toEqual([value.input]);
      expect(result).toMatchObject({
        output: { answer: 'actual' },
        actualMode: 'mock',
        dependencyKind: 'mock',
      });
      expect(JSON.stringify(result)).not.toContain('never-copy');
    },
  );
  test('live cannot be requested with a mock dependency and missing preflight', async () => {
    const adapter = subject('adapters/coach.adapter');
    const invoke = jest.fn(async () => ({}));
    const result = await adapter.observe?.(
      {},
      { mode: 'live', invoke, dependencyKind: 'mock' },
    );
    expect(result).toMatchObject({
      errorCategory: 'DEPENDENCY_UNAVAILABLE',
      output: null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });
  test('Jest adapter parses each test; zero/skip/missing cannot pass', () => {
    const adapter = subject('adapters/jest.adapter');
    expect(
      adapter.parseJestResult?.(
        {
          testResults: [
            {
              assertionResults: [
                { fullName: 'a', status: 'passed' },
                { fullName: 'b', status: 'pending' },
              ],
            },
          ],
        },
        ['a', 'b', 'c'],
      ),
    ).toEqual([
      { name: 'a', state: 'passed' },
      { name: 'b', state: 'skipped' },
      { name: 'c', state: 'not_run' },
    ]);
    expect(() => adapter.parseJestResult?.({ testResults: [] }, [])).toThrow(
      'ZERO_CASES',
    );
  });
});

describe('T023–T027 legacy requirements and evidence boundaries', () => {
  test('Coach retains tool paths, six hashed rubrics and explicit v1/v2 migration', () => {
    const loaded = subject('catalog/coach.catalog').sources(root);
    expect(
      new Set(
        loaded.records.flatMap((r) => r.mapping.rubrics.map((x) => x.version)),
      ).size,
    ).toBe(6);
    for (const row of loaded.records) {
      expect(row.mapping.tools).toEqual(row.raw.expected);
      expect(row.mapping.compatibility).toEqual({
        source: 'coach.result.v1',
        candidate: ['coach.result.v1', 'coach.result.v2'],
        status: 'requires_actual_validation',
      });
      expect(row.mapping.requirementIds.length).toBeGreaterThan(0);
      for (const rubric of row.mapping.rubrics)
        expect(rubric.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
  test('RAG preserves source families and labels fixture-derived observations', () => {
    const loaded = subject('catalog/rag.catalog').sources(root);
    expect(
      loaded.records.reduce((a, r) => {
        a[r.mapping.family] = (a[r.mapping.family] ?? 0) + 1;
        return a;
      }, {}),
    ).toEqual({
      retrieval: 20,
      lifecycle: 6,
      degradation: 9,
      personalization: 7,
    });
    expect(
      loaded.records.every(
        (r) =>
          r.mapping.observationBasis === 'fixture_self_test_only' &&
          r.mapping.versions,
      ),
    ).toBe(true);
  });
  test('synthetic audio has no human gold or real-audio authorization', () => {
    const loaded = subject('catalog/pronunciation.catalog').sources(root);
    expect(
      loaded.records.every(
        (r) =>
          r.mapping.qualityEligible === false &&
          r.mapping.missing.includes('authorized_audio') &&
          r.mapping.missing.includes('human_gold'),
      ),
    ).toBe(true);
  });
  test('MCP keeps positive/failure pairs and all distinct client requirements', () => {
    const loaded = subject('catalog/mcp.catalog').sources(root);
    expect(
      loaded.records.filter(
        (r) => r.primary && r.mapping.polarity === 'positive',
      ),
    ).toHaveLength(9);
    expect(
      loaded.records.filter(
        (r) => r.primary && r.mapping.polarity === 'failure',
      ),
    ).toHaveLength(9);
    expect(
      loaded.records.every(
        (r) =>
          r.mapping.clients.join(',') ===
            'codex,claude-desktop,vscode,inspector' &&
          r.mapping.clientEvidence === null,
      ),
    ).toBe(true);
  });
});

test('Jest parameterized tests with equal titles retain each occurrence and extra failures', () => {
  const adapter = subject('adapters/jest.adapter');
  const parsed = adapter.parseJestResult(
    {
      testResults: [
        {
          assertionResults: [
            { fullName: 'parameterized', status: 'passed' },
            { fullName: 'parameterized', status: 'failed' },
            { fullName: 'new regression', status: 'failed' },
          ],
        },
      ],
    },
    ['parameterized', 'parameterized', 'parameterized'],
  );
  expect(parsed.map((x) => x.state)).toEqual([
    'passed',
    'failed',
    'not_run',
    'failed',
  ]);
  expect(new Set(parsed.map((x) => x.name)).size).toBe(4);
});
