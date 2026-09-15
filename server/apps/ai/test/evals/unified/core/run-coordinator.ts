import { executeAttempts } from './attempt-lineage';
import { summarizeCi } from './ci-summary';
import { recoverRun } from './recovery';
import { loadHistoricalRun, historicalComparison } from './baseline-store';
import { verifyBundle } from './verify';
import { runBounded } from './stop-controller';
import { groupMetrics } from './group-metrics';
import { createHash, randomUUID } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  realpathSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadCatalog } from '../catalog/catalog';
import testRegistry from '../catalog/jest-tests.v1.json';
import coverage from '../catalog/coverage.v1.json';
import { evaluationCaseSchema, EvaluationCase } from '../contracts/case.schema';
import {
  ItemResult,
  ExecutionItem,
  executionItemSchema,
} from '../contracts/run.schema';
import { reportSchema } from '../contracts/report.schema';
import { parseOptions, CliOptions } from './cli-options';
import { selectCases, affectedModules, changedPaths } from './scope';
import { createArtifactStore } from './artifact-store';
import { createJournal, readJournal } from './event-journal';
import { createRunState } from './run-state';
import {
  snapshotCandidate,
  assertCandidateUnchanged,
  hashFiles,
} from './version-snapshot';
import { createWorkerHost } from '../workers/worker-host';
import { runRegisteredJest } from '../adapters/jest.adapter';
import { summarize } from './report';
import { renderReport } from './report-markdown';
import { safePath } from './control-loader';
import { safeDiagnostic } from './redaction';
import { collectObservation } from './observation-collector';

const digest = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const fileHash = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const fixturePath =
  'server/apps/ai/test/evals/unified/fixtures/assurance-cases.jsonl';
const unavailable = {
  value: null,
  unavailableReason: 'not_applicable_to_offline_rules',
};

function additionalCase(
  id: string,
  module: string,
  path: string,
  hash: string,
  tags: string[],
): EvaluationCase {
  return evaluationCaseSchema.parse({
    caseId: id,
    caseVersion: 'unified-case.v1',
    module,
    legacyRef: null,
    tags,
    risk: 'high',
    requirements: [
      { spec: '005-unified-ai-evaluation', ids: ['FR-005', 'FR-050'] },
    ],
    inputRef: { path, hash },
    contextRef: null,
    expectedRef: { path, hash },
    expectedSideEffects: [],
    evaluators: [
      {
        evaluatorId: 'actual-business-rules',
        version: '1',
        type: 'rule',
        rubricRef: null,
        required: true,
        calibrationRef: null,
      },
    ],
    provenance: {
      kind: 'synthetic',
      source: path,
      useBasis:
        'explicit synthetic assurance / existing controlled business tests',
      authorizationRef: null,
      allowedPurposes: ['check'],
      expiresAt: null,
      revocationRule: 'source withdrawal',
      deletionRule: 'synthetic development artifact',
    },
    split: 'development',
    exposure: { groupId: id, nearDuplicateIds: [], events: [] },
    groups: {},
    capabilityRequirements: [],
    datasetVersion: 'unified-development.v1',
  });
}

function sourceSnapshot(
  root: string,
  controlHash: string,
  datasetHash: string,
  limits: CliOptions['limits'],
) {
  const code = snapshotCandidate(root);
  return {
    code,
    evaluation: {
      controlCommit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      adapterVersion: 'unified.v1',
      datasetHash,
      goldHash: datasetHash,
      splitHash: digest('development'),
      exposureHash: digest('development-visible'),
      evaluatorHash: controlHash,
      rubricHash: digest('rule-only'),
      calibrationHash: null,
      aggregationVersion: 'unified.v1',
    },
    runtime: {
      node: process.version,
      pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
      os: process.platform,
      arch: process.arch,
      workerVersion: 'unified-worker.v1',
      limits: { ...limits },
      seed: 0,
      cache: 'disabled',
      isolationFingerprint: 'sanitized-child-env-clean-cwd',
    },
    ai: { provider: unavailable, model: unavailable, prompt: unavailable },
    rag: { index: unavailable, embedding: unavailable },
    pronunciation: { provider: unavailable, audioGold: unavailable },
    mcp: { productClient: unavailable, model: unavailable },
  };
}

export async function runEvaluation(
  argv: readonly string[],
  repositoryRoot: string,
): Promise<any> {
  let runDir: string | undefined;
  let options: CliOptions | undefined;
  let knownFailure = false;
  let detach = () => {};
  try {
    options = parseOptions(argv);
    if (options.command === 'summarize')
      return summarizeCi(JSON.parse(readFileSync(options.expected!, 'utf8')));
    if (options.command === 'verify') return verifyBundle(options.runDir!);
    if (options.command === 'recover') return recoverRun(options.runDir!);
    if (!['run', 'inspect'].includes(options.command))
      return { exitCode: 2, diagnostic: 'OPERATION_NOT_YET_AVAILABLE' };
    const controlRoot = realpathSync(repositoryRoot);
    if (
      options.controlRoot &&
      realpathSync(options.controlRoot) !== controlRoot
    )
      throw Error('CONTROL_ROOT_MISMATCH');
    const candidateRoot = realpathSync(options.candidate ?? repositoryRoot);
    const origin = execFileSync(
      'git',
      ['-C', candidateRoot, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8' },
    ).trim();
    if (
      ![
        'https://github.com/cjw32/en-learning-plus.git',
        'git@github.com:cjw32/en-learning-plus.git',
      ].includes(origin)
    )
      throw Error('WRONG_REPOSITORY');
    const output = realpathSync(options.output!);
    for (const root of [candidateRoot, controlRoot])
      if (output === root || !relative(root, output).startsWith('..'))
        throw Error('OUTPUT_INSIDE_SOURCE');
    const runId = `run-${randomUUID()}`;
    const store = createArtifactStore(output, runId);
    runDir = store.root;
    const loaded = loadCatalog(controlRoot);
    const fixtures = readFileSync(safePath(controlRoot, fixturePath), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const fixtureHash = fileHash(safePath(controlRoot, fixturePath));
    const suites = testRegistry.entries.filter(
      (e) =>
        e.profile === 'quick' ||
        options!.profile === 'full' ||
        (options!.profile === 'synthetic' && e.profile === 'synthetic'),
    );
    const allCases = [
      ...loaded.cases,
      ...fixtures.map((f) =>
        additionalCase(f.id, f.module, fixturePath, fixtureHash, [
          'assurance',
          f.default ? 'normal' : 'injected-regression',
        ]),
      ),
      ...suites.map((s) =>
        additionalCase(
          `suite:${s.id}`,
          s.module,
          `server/${s.path}`,
          fileHash(safePath(controlRoot, `server/${s.path}`)),
          ['business-regression'],
        ),
      ),
    ];
    const requestedModules = [...options.modules];
    if (options.changedSince)
      options.modules = [
        ...new Set([
          ...options.modules,
          ...affectedModules(changedPaths(candidateRoot, options.changedSince)),
        ]),
      ];
    const requiredIds = allCases
      .filter(
        (c) =>
          options!.modules.includes(c.module) &&
          !c.tags.includes('injected-regression'),
      )
      .map((c) => c.caseId);
    const selected = selectCases(
      allCases,
      {
        ...options,
        caseIds: options.caseIds.length ? options.caseIds : requiredIds,
      },
      {
        requiredCaseIds: requiredIds,
        requiredModes: coverage.qualificationModes,
      },
    );
    const policyHash = digest(coverage);
    const controlDirectory = 'server/apps/ai/test/evals/unified';
    const controlFiles = (dir: string): string[] =>
      readdirSync(join(repositoryRoot, dir), { withFileTypes: true }).flatMap(
        (entry) =>
          entry.isDirectory()
            ? controlFiles(`${dir}/${entry.name}`)
            : [`${dir}/${entry.name}`],
      );
    const controlSourceHash = hashFiles(
      repositoryRoot,
      controlFiles(controlDirectory),
    );
    const controlCommit = execFileSync(
      'git',
      ['-c', 'core.fsmonitor=false', '-C', repositoryRoot, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();
    const controlHash = digest({
      source: controlSourceHash,
      catalog: loaded.hash,
      policy: policyHash,
      registry: testRegistry,
    });
    const missing = [...selected.missingRequirements];
    if (options.profile === 'full' || options.purpose === 'qualification')
      missing.push(
        'POLICY_PENDING',
        'CALIBRATION_MISSING',
        'ISOLATION_UNVERIFIED',
        'BASELINE_UNAPPROVED',
        'REQUIRED_LIVE_NOT_EXECUTED',
      );
    if (options.baselineCandidate)
      missing.push('PAIRED_CHECKOUT_NOT_IMPLEMENTED');
    const historical = options.baseline
      ? loadHistoricalRun(options.baseline)
      : null;
    if (
      options.config ||
      options.candidateConfig ||
      options.dataset ||
      options.baselineConfig
    )
      missing.push('CONFIG_PROFILE_NOT_IMPLEMENTED');

    const items: ExecutionItem[] = selected.selected.map((c) => ({
      itemId: digest(c.caseId),
      caseId: c.caseId,
      module: c.module,
      side: 'candidate',
      client: null,
      required: true,
      declaredMode: c.caseId.startsWith('suite:')
        ? (suites.find((s) => `suite:${s.id}` === c.caseId)!.mode as any)
        : 'deterministic',
      expectedRepeatCount: options!.limits.repeatCount,
    }));
    const snapshot = sourceSnapshot(
      candidateRoot,
      controlHash,
      digest(
        allCases.map((c) => ({
          id: c.caseId,
          input: c.inputRef,
          expected: c.expectedRef,
        })),
      ),
      options.limits,
    );
    const createdAt = new Date().toISOString();
    const manifest = {
      schemaVersion: 'ai-eval-manifest.v1',
      runId,
      createdAt,
      candidateHash: snapshot.code.candidateTreeHash,
      controlHash,
      scopeClaim: `${options.profile}/${options.purpose}:${options.modules.join(',')}`,
      items,
      missingRequirements: [...new Set(missing)],
      expectedArtifactKinds: [
        'results',
        'report-json',
        'report-markdown',
        'events',
        'evidence-index',
      ],
      purpose: options.purpose,
      policyHash,
    };
    const log = createJournal(runDir, runId, manifest);
    if (options.command === 'inspect') {
      const preflight = {
        operationStatus: missing.length ? 'INCOMPLETE' : 'OK',
        evaluationGate: null,
        runId,
        selectedCaseIds: items.map((i) => i.caseId),
        missingRequirements: [...new Set(missing)],
        liveQualityEvidenceMissing: loaded.missingMetadata.filter((m) =>
          items.some((i) => i.caseId === m.caseId),
        ),
      };
      store.write('preflight.json', preflight);
      return { exitCode: missing.length ? 2 : 0, runDir, ...preflight };
    }
    const state = createRunState(items);
    const controller = new AbortController();
    const deadline = Date.now() + options.limits.runTimeoutMs;
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    const timer = setTimeout(cancel, options.limits.runTimeoutMs);
    detach = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    };
    const entryPath =
      'server/apps/ai/test/evals/unified/workers/rule.worker.ts';
    const host = createWorkerHost({
      registry: {
        rules: {
          engine: 'ts-node',
          controlRoot,
          candidateRoot,
          entry: {
            path: entryPath,
            hash: fileHash(safePath(controlRoot, entryPath)),
          },
        },
      },
      runRoot: runDir,
      serverRoot: join(controlRoot, 'server'),
      environment: process.env,
      profile: 'quick',
      reserve: () => {
        throw Error('BUDGET_STOPPED');
      },
    });
    await runBounded(
      items,
      options!.limits.concurrency,
      controller.signal,
      async (item) => {
        if (controller.signal.aborted) return;
        const c = selected.selected.find((c) => c.caseId === item.caseId)!;
        const observed: ItemResult = {
          ...(await executeAttempts({
            itemId: item.itemId,
            repeatCount: options!.limits.repeatCount,
            retryLimit: options!.limits.retryLimit,
            signal: controller.signal,
            execute: async (repeat, retry) => {
              if (missing.some((m) => m.includes('NOT_IMPLEMENTED')))
                throw Error('DEPENDENCY_UNAVAILABLE');
              if (!options!.modes.includes(item.declaredMode))
                throw Error('REQUIRED_LIVE_NOT_EXECUTED');
              log.append('ITEM_STARTED', {
                itemId: item.itemId,
                repeat,
                retry,
              });
              const timeoutMs = Math.max(
                1,
                Math.min(options!.limits.caseTimeoutMs, deadline - Date.now()),
              );
              let current: ItemResult;
              if (item.caseId.startsWith('suite:')) {
                const actual = await runRegisteredJest(
                  item.caseId.slice(6),
                  join(candidateRoot, 'server'),
                  runDir!,
                  timeoutMs,
                  controller.signal,
                  {
                    sourceHash: c.inputRef.hash,
                    configHash: fileHash(
                      safePath(
                        controlRoot,
                        'server/' +
                          suites.find((s) => 'suite:' + s.id === item.caseId)!
                            .config,
                      ),
                    ),
                  },
                );
                const suiteEvidencePath = `observations/jest-${item.itemId}-${repeat}-${retry}.json`;
                const suiteEvidence = store.write(suiteEvidencePath, actual);
                const bad = actual.results.some((r) => r.state === 'failed');
                const incomplete =
                  actual.missingOrSkipped.length > 0 ||
                  (actual.exitCode !== 0 && !bad);
                current = {
                  ...item,
                  terminalState: bad
                    ? 'failed'
                    : incomplete
                      ? 'error'
                      : 'passed',
                  reasonCodes: bad
                    ? ['CONTRACT_BREAK']
                    : incomplete
                      ? ['REQUIRED_ITEM_MISSING']
                      : [],
                  allAttempts: [`${item.itemId}-repeat-${repeat}`],
                  requirements: c.requirements,
                  expectedRef: c.expectedRef,
                  actualRef: null,
                  evidenceRefs: [
                    { path: suiteEvidencePath, hash: fileHash(suiteEvidence) },
                  ],
                  steps: [
                    collectObservation({
                      stage: 'rule',
                      actualMode: item.declaredMode,
                      dependencyKind:
                        item.declaredMode === 'mock' ? 'mock' : 'none',
                      input: { suite: item.caseId },
                      output: actual,
                      version: testRegistry.version,
                    }),
                  ],
                };
              } else
                current = await host.execute(
                  'rules',
                  { ...item, expectedRepeatCount: 1 },
                  { timeoutMs, signal: controller.signal },
                );

              return { ...current, ...item, requirements: c.requirements };
            },
            failure: (error) => {
              const reason = controller.signal.aborted
                ? 'CANCELLED'
                : /TIMEOUT/.test(String(error))
                  ? 'TIMEOUT'
                  : /REQUIRED_LIVE_NOT_EXECUTED/.test(String(error))
                    ? 'REQUIRED_LIVE_NOT_EXECUTED'
                    : 'DEPENDENCY_UNAVAILABLE';
              return {
                ...item,
                terminalState: 'error',
                reasonCodes: [reason],
                allAttempts: [],
                requirements: c.requirements,
                expectedRef: c.expectedRef,
                actualRef: null,
                evidenceRefs: [],
                steps: [],
              };
            },
            record: (current, lineage) => {
              if (current.terminalState === 'failed') knownFailure = true;
              store.write(`attempts/${lineage.attemptId}.json`, {
                ...current,
                repeatIndex: lineage.repeatIndex,
                retryIndex: lineage.retryIndex,
                parentAttemptId: lineage.parentAttemptId,
              });
              log.append('ATTEMPT_FINISHED', {
                itemId: item.itemId,
                attemptId: lineage.attemptId,
                repeat: lineage.repeatIndex,
                retry: lineage.retryIndex,
                terminalState: current.terminalState,
              });
            },
          })),
          ...item,
        };
        const actualPath = `observations/${item.itemId}.json`;
        store.write(actualPath, {
          terminalState: observed.terminalState,
          steps: observed.steps,
          reasonCodes: observed.reasonCodes,
          attempts: observed.allAttempts,
        });
        observed.actualRef = {
          path: actualPath,
          hash: fileHash(join(runDir!, actualPath)),
        };
        log.append('ITEM_FINISHED', {
          itemId: item.itemId,
          terminalState: observed.terminalState,
          actualRef: observed.actualRef,
        });
        state.finish(observed);
      },
    );
    const results = state.finalize();
    if (controller.signal.aborted) missing.push('CANCELLED');
    try {
      assertCandidateUnchanged(candidateRoot, snapshot.code);
    } catch {
      missing.push('CANDIDATE_CHANGED_DURING_RUN');
    }
    const comparison = historical
      ? historicalComparison(
          runId,
          snapshot,
          results,
          historical.report,
          options.intentionalDifferences,
        )
      : null;
    if (comparison?.comparability === 'incomparable')
      missing.push('COMPARISON_MISMATCH');
    if (historical) store.write('baseline/report.json', historical.report);
    const metrics = groupMetrics(results, selected.selected);
    if (historical && comparison?.comparability === 'comparable') {
      for (const metric of metrics) {
        const prior = historical.report.metrics.find(
          (m) =>
            m.side === 'candidate' &&
            m.metricId === metric.metricId &&
            m.module === metric.module &&
            m.mode === metric.mode &&
            JSON.stringify(m.group) === JSON.stringify(metric.group),
        );
        if (prior?.value != null && metric.value != null)
          metric.comparisonDelta = metric.value - prior.value;
      }
    }
    const summary = summarize(results, {
      scopeClaim: manifest.scopeClaim,
      runId,
      policyHash,
      missingRequirements: [...new Set(missing)],
      purpose: options.purpose,
    });
    const baselineRegistryPath = store.write('control/baselines.json', {
      schemaVersion: 'ai-eval-baseline-registry.v1',
      status: 'pending_approval',
      entries: [],
    });
    const approvalRegistryPath = store.write('control/approvals.json', {
      schemaVersion: 'ai-eval-approval-registry.v1',
      status: 'pending_approval',
      entries: [],
    });
    const policyPath = store.write('control/coverage.json', coverage);
    store.write('control/cases.json', selected.selected);
    store.write('control/catalog-mapping.json', {
      missingMetadata: loaded.missingMetadata,
      mappings: Object.fromEntries(loaded.mappings),
    });
    const jsonReport = reportSchema.parse({
      schemaVersion: 'ai-evaluation-report.v1',
      run: {
        id: runId,
        parentRunId: null,
        createdAt,
        startedAt: createdAt,
        endedAt: new Date().toISOString(),
        state: 'FINISHED',
        purpose: options.purpose,
        profile: options.profile,
        executionCompleteness: summary.gate.executionCompleteness,
        revisionOf: null,
      },
      control: {
        controlCommit,
        controlHash,
        adapterHash: controlSourceHash,
        catalogHash: loaded.hash,
        policyHash,
        evaluatorHash: digest('rules'),
        impactHash: digest('unified-change-impact.v1'),
        baselineRegistryRef: {
          path: 'control/baselines.json',
          hash: fileHash(baselineRegistryPath),
        },
        approvalRegistryRef: {
          path: 'control/approvals.json',
          hash: fileHash(approvalRegistryPath),
        },
        trust: 'local',
        subject: 'local-developer',
        time: createdAt,
      },
      scope: {
        requested: requestedModules,
        expanded: options.modules,
        selectedItems: items,
        requiredItems: requiredIds,
        requiredGroups: [],
        requiredModes:
          options.profile === 'full' || options.purpose === 'qualification'
            ? ['live']
            : [],
        excludedCases: selected.excluded,
        notApplicable: [],
        missingRequirements: [...new Set(missing)],
        policyRef: {
          path: 'control/coverage.json',
          hash: fileHash(policyPath),
        },
        selectionReason: [
          'Frozen control catalog',
          'Injected regression cases require explicit selection',
          'Legacy rows validate development fixture contracts; business suites execute actual services with declared substitutes',
        ],
        scopeClaim: manifest.scopeClaim,
      },
      versions: {
        candidate: snapshot,
        baseline: historical?.report.versions.candidate ?? null,
      },
      comparison,
      comparisonUnavailableReason: historical
        ? null
        : 'NOT_A_BASELINE_COMPARISON',
      counts: summary.counts,
      cases: results,
      metrics,
      usage: {
        calls: [],
        budgetMicros: options.limits.budgetMicros,
        reservedMicros: 0,
        settledMicros: 0,
      },
      gate: summary.gate,
      artifacts: [],
      reproduction: {
        arguments: [...argv],
        prerequisites: [
          'Existing declared dependencies',
          'Non-production synthetic assets',
        ],
        limitations: [
          'Rule/mock checks do not establish real model quality',
          'No Provider call accounting is fabricated',
          'Real resource identity not verified',
          ...(historical
            ? [
                'Historical comparison is development evidence; no baseline approval is granted',
              ]
            : []),
        ],
        configHash: digest(options.limits),
      },
    });
    log.append('RUN_FINISHED', {
      gate: summary.gate.status,
      exitCode: summary.gate.exitCode,
    });
    store.write('results.jsonl', results, { format: 'jsonl' });
    store.write('report.json', jsonReport);
    store.write('report.md', renderReport(jsonReport), { format: 'text' });
    store.write('evidence/index.json', {
      schemaVersion: 'ai-eval-evidence-index.v1',
      runId,
      observations: results.map((r) => r.actualRef),
      sensitivity: 'synthetic_public',
    });
    const files = (directory: string, prefix = ''): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(join(directory, entry.name), `${prefix}${entry.name}/`)
          : [`${prefix}${entry.name}`],
      );
    store.write('bundle.json', {
      runId,
      hashes: Object.fromEntries(
        files(runDir).map((name) => [name, fileHash(safePath(runDir!, name))]),
      ),
    });
    return {
      exitCode: summary.gate.exitCode,
      gate: summary.gate.status,
      runId,
      runDir,
      counts: summary.counts,
    };
  } catch (error) {
    const diagnostic = safeDiagnostic(
      error instanceof Error ? error.message : 'EVALUATION_ERROR',
    );
    if (runDir)
      try {
        writeFileSync(
          join(runDir, 'diagnostic.json'),
          JSON.stringify({
            gate: knownFailure ? 'FAIL' : 'INCOMPLETE',
            executionCompleteness: 'incomplete',
            diagnostic,
          }),
          { flag: 'wx', mode: 0o600 },
        );
      } catch {
        /* Preserve the original non-passing outcome when diagnostics cannot be written. */
      }
    return {
      exitCode: knownFailure ? 1 : 2,
      gate: knownFailure ? 'FAIL' : 'INCOMPLETE',
      runDir,
      diagnostic,
    };
  } finally {
    detach();
  }
}
