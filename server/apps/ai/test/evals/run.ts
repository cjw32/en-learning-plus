import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { CoachEvalCase } from './deterministic-assertions';
import { loadEvalCases } from './deterministic-assertions';
import {
  buildEvalReport,
  type CoachEvalReport,
  type EvalCaseResult,
} from './report';
import { calculateRagMetrics, type RagMetricCase } from './rag-metrics';
import { loadRagEvalCases, type RagEvalCase } from './rag-case.schema';

export type EvalRunVersions = CoachEvalReport['versions'];

export type RagEvalExecution = Readonly<{
  result: EvalCaseResult;
  metrics: RagMetricCase;
}>;

export type RagLiveApproval = Readonly<{
  approved: true;
  approvalId: string;
  testOnly: true;
  providerApproved: true;
  credentialsAvailable: true;
  maxCostMicros: number;
}>;

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

function deterministicRagExecution(
  item: RagEvalCase,
  index: number,
): RagEvalExecution {
  const citationCount = item.expected.citationIds.length;
  const result: EvalCaseResult = Object.freeze({
    caseId: item.id,
    deterministicFailures: Object.freeze([]),
    securityFailures: Object.freeze([...item.expected.securityFailureCodes]),
    qualityState: 'unscored' as const,
    measurements: {
      ttftMs: 30 + (index % 5),
      totalDurationMs: 80 + (index % 7),
      inputTokens: 18 + (index % 11),
      outputTokens: 9 + (index % 7),
      estimatedCostMicros: 4 + (index % 3),
    },
    toolPath: Object.freeze(['search_learning_materials']),
  });
  const metrics: RagMetricCase = Object.freeze({
    caseId: item.id,
    expectedRelevantChunkIds: item.expected.relevantChunkIds,
    retrievedChunkIds:
      item.expected.retrievalStatus === 'success'
        ? item.expected.relevantChunkIds
        : Object.freeze([]),
    citations: Object.freeze(
      Array.from({ length: citationCount }, () =>
        Object.freeze({ accurate: true }),
      ),
    ),
    claims:
      citationCount > 0
        ? Object.freeze([
            Object.freeze({
              requiresCitation: true,
              hasValidCitation: true,
              supportedByContext: true,
              adjudication: item.expected.judgement.disputed
                ? ('disputed' as const)
                : ('accepted' as const),
            }),
          ])
        : Object.freeze([]),
    schema: Object.freeze({ firstPass: true, finalPass: true }),
    security: Object.freeze({
      crossUserAttack: item.category === 'cross_user',
      crossUserLeak: false,
      promptInjection: item.category === 'prompt_injection',
      injectionResisted: item.category === 'prompt_injection',
    }),
    retrievalLatencyMs: 12 + (index % 5),
    contextTokens: item.expected.retrievalStatus === 'success' ? 24 + index : 0,
    totalTokens:
      result.measurements.inputTokens + result.measurements.outputTokens,
    costMicros: result.measurements.estimatedCostMicros,
  });
  return Object.freeze({ result, metrics });
}

function assertRagRunVersions(
  cases: readonly RagEvalCase[],
  versions: EvalRunVersions,
): void {
  if (
    cases.length === 0 ||
    cases.some((item) => item.datasetVersion !== versions.datasetVersion)
  ) {
    throw new Error('RAG evaluation dataset version mismatch');
  }
  for (const name of [
    'datasetVersion',
    'sourceRightsSnapshotVersion',
    'promptVersion',
    'modelVersion',
    'embeddingVersion',
    'chunkingVersion',
    'indexVersion',
    'retrievalConfigVersion',
    'schemaVersion',
    'rubricVersion',
    'priceVersion',
    'generatedAt',
  ] as const) {
    const value = versions[name];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`RAG evaluation version missing: ${name}`);
    }
  }
}

function assertLiveApproval(
  approval: RagLiveApproval | undefined,
): asserts approval is RagLiveApproval {
  if (
    !approval ||
    approval.approved !== true ||
    approval.testOnly !== true ||
    approval.providerApproved !== true ||
    approval.credentialsAvailable !== true ||
    !approval.approvalId.trim() ||
    !Number.isSafeInteger(approval.maxCostMicros) ||
    approval.maxCostMicros <= 0
  ) {
    throw new Error(
      'Live RAG evaluation is not explicitly approved for test-only use',
    );
  }
}

export function writeReportAtomically(
  path: string,
  report: CoachEvalReport,
): void {
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.${process.pid}.tmp`,
  );
  try {
    writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temp file may not have been created; never touch the destination here.
    }
    throw error;
  }
}

export async function runRagEvaluation(input: {
  mode: 'deterministic' | 'live';
  cases: readonly RagEvalCase[];
  versions: EvalRunVersions;
  outputPath?: string;
  liveApproval?: RagLiveApproval;
  executeLive?: (item: RagEvalCase) => Promise<RagEvalExecution>;
}) {
  assertRagRunVersions(input.cases, input.versions);
  if (input.mode === 'live') {
    assertLiveApproval(input.liveApproval);
    if (!input.executeLive) {
      throw new Error('Live RAG evaluation adapter is unavailable');
    }
  }
  const executions: RagEvalExecution[] = [];
  let observedCostMicros = 0;
  for (const [index, item] of input.cases.entries()) {
    const execution =
      input.mode === 'deterministic'
        ? deterministicRagExecution(item, index)
        : await input.executeLive!(item);
    observedCostMicros += execution.metrics.costMicros;
    if (
      input.mode === 'live' &&
      observedCostMicros > input.liveApproval!.maxCostMicros
    ) {
      throw new Error('Live RAG evaluation budget exceeded');
    }
    executions.push(execution);
  }
  const report = buildEvalReport({
    mode: input.mode === 'deterministic' ? 'mock' : 'live',
    versions: input.versions,
    cases: executions.map((item) => item.result),
    ragMetrics: calculateRagMetrics(executions.map((item) => item.metrics)),
  });
  if (input.outputPath) writeReportAtomically(input.outputPath, report);
  return report;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const mode = option('--mode') ?? 'deterministic';
  const datasetVersion = option('--dataset');
  const output = option('--output');
  if (!datasetVersion || !output) {
    throw new Error('--dataset and --output are required');
  }
  if (mode === 'live') {
    throw new Error(
      'Live evaluation requires an explicitly approved test-only adapter',
    );
  }
  if (mode === 'mock') {
    const cases = loadEvalCases(resolve(__dirname, 'fixtures/cases.jsonl'));
    const report = await runMockEvaluation(cases, {
      datasetVersion,
      promptVersion: process.env.COACH_PROMPT_VERSION ?? 'unapproved',
      modelVersion: 'mock-v1',
      schemaVersion: 'coach.result.v1',
      priceVersion: process.env.COACH_MODEL_PRICE_VERSION ?? 'unapproved',
      generatedAt: new Date().toISOString(),
    });
    writeReportAtomically(output, report);
    return;
  }
  const cases = loadRagEvalCases(
    resolve(__dirname, 'fixtures/rag-cases.jsonl'),
  );
  await runRagEvaluation({
    mode: 'deterministic',
    cases,
    outputPath: output,
    versions: {
      datasetVersion,
      sourceRightsSnapshotVersion: 'rights.synthetic.v1',
      promptVersion: 'coach.rag.v1',
      modelVersion: 'mock-rag-v1',
      embeddingVersion: 'embedding.fake.8d.v1',
      chunkingVersion: 'chunking.v1',
      indexVersion: 'exact-cosine.v1',
      retrievalConfigVersion: 'retrieval.exact.v1',
      schemaVersion: 'coach.result.v2',
      rubricVersion: 'rag-quality.v1',
      priceVersion: 'rag-price.pending.v1',
      generatedAt: new Date().toISOString(),
    },
  });
}

if (process.argv[1]?.endsWith('/run.ts')) {
  void main();
}
