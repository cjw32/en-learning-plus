import { readFileSync } from 'node:fs';
import {
  MCP_EVAL_CATEGORIES,
  type McpEvalCase,
  type McpEvalPackage,
} from './mcp-eval.types';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

export function validateEvalPackage(value: unknown): McpEvalPackage {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid MCP eval package');
  const input = value as Record<string, unknown>;
  if (
    input.fixtureVersion !== 'mcp-eval-cases.v1' ||
    input.rubricVersion !== 'mcp-rubrics.v1' ||
    !Array.isArray(input.cases)
  )
    throw new Error('Unversioned MCP eval package');
  const ids = new Set<string>();
  for (const raw of input.cases) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid MCP eval case');
    const item = raw as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      !/^[a-z0-9_]{4,80}$/u.test(item.id) ||
      ids.has(item.id)
    )
      throw new Error('Invalid or duplicate eval id');
    ids.add(item.id);
    if (
      !MCP_EVAL_CATEGORIES.includes(item.category as never) ||
      !['positive', 'failure'].includes(String(item.kind)) ||
      item.synthetic !== true
    )
      throw new Error('Invalid eval provenance or category');
    const expected = item.expected as Record<string, unknown> | undefined;
    if (
      !expected ||
      !['allow', 'deny', 'cancel'].includes(String(expected.action)) ||
      !(expected.source === null || typeof expected.source === 'string') ||
      !(expected.tool === null || typeof expected.tool === 'string') ||
      !Array.isArray(item.zeroTolerance)
    )
      throw new Error('Ambiguous eval expectation');
  }
  for (const category of MCP_EVAL_CATEGORIES) {
    for (const kind of ['positive', 'failure']) {
      if (
        !(input.cases as McpEvalCase[]).some(
          (item) => item.category === category && item.kind === kind,
        )
      )
        throw new Error(`Missing ${category}/${kind} coverage`);
    }
  }
  return deepFreeze(input as unknown as McpEvalPackage);
}

export function loadEvalPackage(path: string): McpEvalPackage {
  return validateEvalPackage(JSON.parse(readFileSync(path, 'utf8')));
}
