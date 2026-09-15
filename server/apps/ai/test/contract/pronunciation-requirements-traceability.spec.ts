import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type TraceabilityRow = {
  ids: string;
  tasks: string;
  implementation: string;
  verification: string;
};

const repositoryRoot = resolve(__dirname, '../../../../..');
const featureRoot = resolve(
  repositoryRoot,
  'specs/003-pronunciation-assessment',
);
const traceability = readFileSync(
  resolve(featureRoot, 'requirements-traceability.md'),
  'utf8',
);
const tasks = readFileSync(resolve(featureRoot, 'tasks.md'), 'utf8');

function expandIds(value: string, prefix: 'FR' | 'SC' | 'T'): string[] {
  const width = 3;
  const separator = prefix === 'T' ? '' : '-';
  const ids = new Set<string>();
  const rangeExpression = new RegExp(
    `\\b${prefix}${separator}(\\d{${width}})\\s*[–-]\\s*(?:${prefix}${separator})?(\\d{${width}})\\b`,
    'g',
  );
  const withoutRanges = value.replace(
    rangeExpression,
    (_match, startText: string, endText: string) => {
      const start = Number(startText);
      const end = Number(endText);
      for (let value = start; value <= end; value += 1) {
        ids.add(`${prefix}${separator}${String(value).padStart(width, '0')}`);
      }
      return ' ';
    },
  );

  const singleExpression = new RegExp(
    `\\b${prefix}${separator}(\\d{${width}})\\b`,
    'g',
  );
  for (const match of withoutRanges.matchAll(singleExpression)) {
    ids.add(`${prefix}${separator}${match[1]}`);
  }
  return [...ids].sort();
}

function section(
  markdown: string,
  heading: string,
  nextHeading: string,
): string {
  const start = markdown.indexOf(heading);
  const end = markdown.indexOf(nextHeading, start + heading.length);
  if (start < 0 || end < 0) {
    throw new Error(`Missing traceability section: ${heading}`);
  }
  return markdown.slice(start, end);
}

function tableRows(markdownSection: string): TraceabilityRow[] {
  return markdownSection
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .map(([ids, taskIds, implementation, verification = implementation]) => ({
      ids,
      tasks: taskIds,
      implementation,
      verification,
    }));
}

function expectedIds(prefix: 'FR' | 'SC', count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + 1).padStart(3, '0')}`,
  );
}

function assertRowsAreActionable(rows: TraceabilityRow[]): void {
  const knownTasks = new Set(expandIds(tasks, 'T'));

  for (const row of rows) {
    const mappedTasks = expandIds(row.tasks, 'T');
    expect(mappedTasks.length).toBeGreaterThan(0);
    expect(mappedTasks.every((taskId) => knownTasks.has(taskId))).toBe(true);
    expect(row.implementation).toMatch(/`[^`]+`/);
    expect(`${row.implementation} ${row.verification}`).toMatch(
      /(?:\.spec\.ts|\.md`|E2E|suite|test|evaluation|评测)/i,
    );
  }
}

describe('pronunciation requirements traceability', () => {
  const functionalRows = tableRows(
    section(
      traceability,
      '## Functional requirement coverage',
      '## Success-criteria coverage',
    ),
  );
  const successRows = tableRows(
    section(
      traceability,
      '## Success-criteria coverage',
      '## User-story independence',
    ),
  );

  it('maps every functional requirement to a real task and verification artifact', () => {
    expect(
      functionalRows.flatMap((row) => expandIds(row.ids, 'FR')).sort(),
    ).toEqual(expectedIds('FR', 95));
    expect(new Set(expandIds(tasks, 'FR'))).toEqual(
      new Set(expectedIds('FR', 95)),
    );
    assertRowsAreActionable(functionalRows);
  });

  it('maps every success criterion to a real task and verification artifact', () => {
    expect(
      successRows.flatMap((row) => expandIds(row.ids, 'SC')).sort(),
    ).toEqual(expectedIds('SC', 18));
    expect(new Set(expandIds(tasks, 'SC'))).toEqual(
      new Set(expectedIds('SC', 18)),
    );
    assertRowsAreActionable(successRows);
  });
});
