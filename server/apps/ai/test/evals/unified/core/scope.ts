import { execFileSync } from 'node:child_process';
import { EvaluationCase, evaluationCaseSchema } from '../contracts/case.schema';
import impact from '../catalog/change-impact.v1.json';
import { modules } from '../catalog/catalog';

export function affectedModules(paths: readonly string[]): string[] {
  const matched = new Set<string>();
  for (const path of paths) {
    const rules = impact.rules.filter((rule) => path.startsWith(rule.prefix));
    (rules.length
      ? rules.flatMap((rule) => rule.modules)
      : impact.unknown
    ).forEach((module) => matched.add(module));
  }
  return modules.filter((module) => matched.has(module));
}
export function changedPaths(root: string, ref: string) {
  if (!ref || ref.startsWith('-')) throw Error('INVALID_CHANGE_REF');
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=/dev/null',
        '-C',
        root,
        ...args,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          GIT_TERMINAL_PROMPT: '0',
          TMPDIR: '/tmp',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        },
      },
    );
  const base = git('merge-base', 'HEAD', ref).trim();
  const committed = git(
    'diff',
    '--name-only',
    '-z',
    '--no-ext-diff',
    base,
    'HEAD',
    '--',
  ).split('\0');
  const staged = git(
    'diff',
    '--name-only',
    '-z',
    '--no-ext-diff',
    'HEAD',
    '--',
  ).split('\0');
  const untracked = git(
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ).split('\0');
  return [...new Set([...committed, ...staged, ...untracked].filter(Boolean))];
}
export function selectCases(
  input: readonly EvaluationCase[],
  filter: {
    modules: readonly string[];
    caseIds: readonly string[];
    tags: readonly string[];
    risks: readonly string[];
    modes: readonly string[];
    purpose: string;
  },
  trustedCoverage: {
    requiredCaseIds: readonly string[];
    requiredModes: readonly string[];
  },
) {
  const cases = input.map((c) => evaluationCaseSchema.parse(c));
  if (new Set(cases.map((c) => c.caseId)).size !== cases.length)
    throw Error('DUPLICATE_CASE_ID');
  const validIds = new Set(cases.map((c) => c.caseId));
  const validTags = new Set(cases.flatMap((c) => c.tags));
  if (
    filter.modules.some((m) => !modules.includes(m as never)) ||
    filter.caseIds.some((id) => !validIds.has(id)) ||
    filter.tags.some((tag) => !validTags.has(tag)) ||
    filter.risks.some((r) => !['low', 'medium', 'high', 'critical'].includes(r))
  )
    throw Error('INVALID_FILTER');
  const selected = cases.filter(
    (c) =>
      filter.modules.includes(c.module) &&
      (!filter.caseIds.length || filter.caseIds.includes(c.caseId)) &&
      (!filter.tags.length || filter.tags.some((t) => c.tags.includes(t))) &&
      (!filter.risks.length || filter.risks.includes(c.risk)),
  );
  if (!selected.length) throw Error('ZERO_CASES');
  const selectedIds = new Set(selected.map((c) => c.caseId));
  const missingRequirements =
    filter.purpose === 'qualification'
      ? [
          ...trustedCoverage.requiredCaseIds.filter(
            (id) => !selectedIds.has(id),
          ),
          ...trustedCoverage.requiredModes
            .filter((mode) => !filter.modes.includes(mode))
            .map((mode) => `mode:${mode}`),
        ]
      : [];
  return {
    selected,
    excluded: cases
      .filter((c) => !selectedIds.has(c.caseId))
      .map((c) => ({ caseId: c.caseId, reason: 'FILTERED_OUT' })),
    missingRequirements,
    requiredCaseIds: [...trustedCoverage.requiredCaseIds],
    requiredModes: [...trustedCoverage.requiredModes],
  };
}
