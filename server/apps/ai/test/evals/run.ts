import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CoachEvalCase } from './deterministic-assertions';
import { loadEvalCases } from './deterministic-assertions';
import {
  buildEvalReport,
  type CoachEvalReport,
  type EvalCaseResult,
} from './report';

export type EvalRunVersions = CoachEvalReport['versions'];

function mockResult(item: CoachEvalCase, index: number): EvalCaseResult {
  return Object.freeze({
    caseId: item.id,
    deterministicFailures: Object.freeze([]),
    securityFailures: Object.freeze([]),
    qualityState: 'unscored' as const,
    measurements: {
      ttftMs: 40 + (index % 7),
      totalDurationMs: 100 + (index % 11),
      inputTokens: 20 + (index % 13),
      outputTokens: 10 + (index % 9),
      estimatedCostMicros: 5 + (index % 5),
    },
    toolPath: Object.freeze([...item.expected.toolOrder]),
  });
}

export async function runMockEvaluation(
  cases: readonly CoachEvalCase[],
  versions: EvalRunVersions,
) {
  return buildEvalReport({
    mode: 'mock',
    versions,
    cases: cases.map(mockResult),
  });
}

export async function runLiveEvaluation(
  cases: readonly CoachEvalCase[],
  versions: EvalRunVersions,
  execute: (item: CoachEvalCase) => Promise<EvalCaseResult>,
) {
  const results: EvalCaseResult[] = [];
  for (const item of cases) results.push(await execute(item));
  return buildEvalReport({ mode: 'live', versions, cases: results });
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const mode = option('--mode') ?? 'mock';
  const datasetVersion = option('--dataset');
  const output = option('--output');
  if (!datasetVersion || !output) {
    throw new Error('--dataset and --output are required');
  }
  if (mode !== 'mock') {
    throw new Error(
      'Live evaluation requires an explicitly approved model adapter',
    );
  }
  const cases = loadEvalCases(resolve(__dirname, 'fixtures/cases.jsonl'));
  const report = await runMockEvaluation(cases, {
    datasetVersion,
    promptVersion: process.env.COACH_PROMPT_VERSION ?? 'unapproved',
    modelVersion: 'mock-v1',
    schemaVersion: 'coach.result.v1',
    priceVersion: process.env.COACH_MODEL_PRICE_VERSION ?? 'unapproved',
    generatedAt: new Date().toISOString(),
  });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (process.argv[1]?.endsWith('/run.ts')) {
  void main();
}
