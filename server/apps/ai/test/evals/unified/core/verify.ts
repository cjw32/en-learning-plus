import { groupMetrics } from './group-metrics';
import { compareCases, compareSnapshots } from './comparability';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { safePath } from './control-loader';
import { readJournal } from './event-journal';
import { summarize } from './report';
import { renderReport } from './report-markdown';
import { reportSchema } from '../contracts/report.schema';
import { executionItemSchema } from '../contracts/run.schema';
const fileHash = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
export function verifyBundle(root: string) {
  try {
    const bundle = JSON.parse(
      readFileSync(safePath(root, 'bundle.json'), 'utf8'),
    );
    for (const name of [
      ...new Set([
        'manifest.json',
        'events.jsonl',
        'results.jsonl',
        'report.json',
        'report.md',
        'evidence/index.json',
        ...Object.keys(bundle.hashes ?? {}),
      ]),
    ])
      if (fileHash(safePath(root, name)) !== bundle.hashes?.[name])
        throw Error('BUNDLE_HASH_MISMATCH');
    const report = reportSchema.parse(
      JSON.parse(readFileSync(safePath(root, 'report.json'), 'utf8')),
    );
    const manifest = JSON.parse(
      readFileSync(safePath(root, 'manifest.json'), 'utf8'),
    );
    const results = readFileSync(safePath(root, 'results.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    if (
      report.run.id !== bundle.runId ||
      manifest.runId !== bundle.runId ||
      report.control.controlHash !== manifest.controlHash ||
      report.control.policyHash !== manifest.policyHash ||
      report.run.purpose !== manifest.purpose ||
      report.scope.scopeClaim !== manifest.scopeClaim ||
      !manifest.missingRequirements.every((reason: string) =>
        report.gate.missingRequirements.includes(reason),
      ) ||
      !readJournal(root, bundle.runId).complete
    )
      throw Error('BUNDLE_IDENTITY_MISMATCH');
    const frozenItems = manifest.items.map((item: unknown) =>
      executionItemSchema.parse(item),
    );
    if (
      JSON.stringify(frozenItems) !== JSON.stringify(report.scope.selectedItems)
    )
      throw Error('FROZEN_PLAN_MISMATCH');
    if (
      JSON.stringify(manifest.items.map((i) => i.itemId)) !==
        JSON.stringify(report.cases.map((i) => i.itemId)) ||
      JSON.stringify(report.cases) !== JSON.stringify(results)
    )
      throw Error('AGGREGATE_MISMATCH');
    for (const reference of [
      report.control.baselineRegistryRef,
      report.control.approvalRegistryRef,
      report.scope.policyRef,
    ]) {
      if (fileHash(safePath(root, reference.path)) !== reference.hash)
        throw Error('CONTROL_EVIDENCE_MISMATCH');
    }
    const journal = readJournal(root, bundle.runId);
    const completion = journal.events.filter((e) => e.type === 'RUN_FINISHED');
    if (
      completion.length !== 1 ||
      completion[0].payload.gate !== report.gate.status ||
      completion[0].payload.exitCode !== report.gate.exitCode
    )
      throw Error('JOURNAL_RESULT_MISMATCH');
    for (const item of report.cases) {
      const frozen = frozenItems.find(
        (planned) => planned.itemId === item.itemId,
      );
      if (
        !frozen ||
        Object.entries(frozen).some(([key, value]) => item[key] !== value)
      )
        throw Error('FROZEN_PLAN_MISMATCH');
      const terminalEvents = journal.events.filter(
        (e) => e.type === 'ITEM_FINISHED' && e.payload.itemId === item.itemId,
      );
      if (
        item.terminalState !== 'not_run' &&
        (terminalEvents.length !== 1 ||
          terminalEvents[0].payload.terminalState !== item.terminalState)
      )
        throw Error('JOURNAL_RESULT_MISMATCH');
      if (
        item.actualRef &&
        fileHash(safePath(root, item.actualRef.path)) !== item.actualRef.hash
      )
        throw Error('EVIDENCE_HASH_MISMATCH');
      if (item.actualRef) {
        const observed = JSON.parse(
          readFileSync(safePath(root, item.actualRef.path), 'utf8'),
        );
        if (
          observed.terminalState !== item.terminalState ||
          JSON.stringify(observed.steps) !== JSON.stringify(item.steps) ||
          JSON.stringify(observed.attempts) !==
            JSON.stringify(item.allAttempts) ||
          JSON.stringify(observed.reasonCodes) !==
            JSON.stringify(item.reasonCodes)
        )
          throw Error('OBSERVATION_MISMATCH');
      }
      for (const evidence of item.evidenceRefs)
        if (
          !bundle.hashes[evidence.path] ||
          fileHash(safePath(root, evidence.path)) !== evidence.hash
        )
          throw Error('EVIDENCE_HASH_MISMATCH');
      const recordedAttempts = journal.events
        .filter(
          (e) =>
            e.type === 'ATTEMPT_FINISHED' && e.payload.itemId === item.itemId,
        )
        .map(
          (e) =>
            e.payload.attemptId ?? `attempt-${item.itemId}-${e.payload.repeat}`,
        );
      if (JSON.stringify(recordedAttempts) !== JSON.stringify(item.allAttempts))
        throw Error('ATTEMPT_HISTORY_MISMATCH');
      for (const attemptId of item.allAttempts) {
        const path = `attempts/${attemptId}.json`;
        if (
          !bundle.hashes[path] ||
          fileHash(safePath(root, path)) !== bundle.hashes[path]
        )
          throw Error('ATTEMPT_EVIDENCE_MISSING');
        const attempt = JSON.parse(readFileSync(safePath(root, path), 'utf8'));
        if (
          attempt.itemId !== item.itemId ||
          attempt.caseId !== item.caseId ||
          Object.entries(frozen).some(
            ([key, value]) =>
              key !== 'expectedRepeatCount' && attempt[key] !== value,
          )
        )
          throw Error('ATTEMPT_IDENTITY_MISMATCH');
        const lineage = item.attemptLineage?.find(
          (a) => a.attemptId === attemptId,
        );
        if (
          lineage &&
          (lineage.repeatIndex !== attempt.repeatIndex ||
            lineage.retryIndex !== attempt.retryIndex ||
            lineage.parentAttemptId !== attempt.parentAttemptId)
        )
          throw Error('ATTEMPT_LINEAGE_MISMATCH');
        if (
          attempt.terminalState !== 'passed' &&
          item.terminalState === 'passed'
        )
          throw Error('EARLIER_FAULT_HIDDEN');
        if (
          attempt.terminalState === 'failed' &&
          item.terminalState !== 'failed'
        )
          throw Error('FIRST_FAILURE_HIDDEN');
      }
    }
    const catalog = JSON.parse(
      readFileSync(safePath(root, 'control/cases.json'), 'utf8'),
    );
    if (!bundle.hashes['control/cases.json'])
      throw Error('CATALOG_EVIDENCE_MISSING');
    const calculatedMetrics = groupMetrics(report.cases, catalog);
    if (report.comparison) {
      if (!bundle.hashes['baseline/report.json'])
        throw Error('BASELINE_EVIDENCE_MISSING');
      const baseline = reportSchema.parse(
        JSON.parse(
          readFileSync(safePath(root, 'baseline/report.json'), 'utf8'),
        ),
      );
      const pairs = compareCases(report.cases, baseline.cases);
      const mismatches = [
        ...pairs.mismatches,
        ...compareSnapshots(
          report.versions.candidate,
          baseline.versions.candidate,
          report.comparison.intentionalDifferences,
        ),
      ];
      const comparable =
        pairs.comparability === 'comparable' && !mismatches.length;
      if (
        JSON.stringify(report.versions.baseline) !==
          JSON.stringify(baseline.versions.candidate) ||
        report.comparison.baselineId !== baseline.run.id ||
        report.comparison.candidateId !== report.run.id ||
        JSON.stringify(report.comparison.missingPairs) !==
          JSON.stringify(pairs.missingPairs) ||
        JSON.stringify(report.comparison.pairedCaseIds) !==
          JSON.stringify(pairs.pairedCaseIds) ||
        JSON.stringify(report.comparison.mismatches) !==
          JSON.stringify(mismatches) ||
        report.comparison.comparability !==
          (comparable ? 'comparable' : 'incomparable')
      )
        throw Error('COMPARISON_MISMATCH');
      if (comparable)
        for (const metric of calculatedMetrics) {
          const prior = baseline.metrics.find(
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
    if (JSON.stringify(calculatedMetrics) !== JSON.stringify(report.metrics))
      throw Error('METRIC_MISMATCH');
    if (
      readFileSync(safePath(root, 'report.md'), 'utf8') !== renderReport(report)
    )
      throw Error('MARKDOWN_MISMATCH');
    const summary = summarize(report.cases, {
      scopeClaim: report.gate.scopeClaim,
      policyHash: report.gate.policyHash,
      runId: bundle.runId,
      missingRequirements: report.gate.missingRequirements,
      purpose: report.run.purpose,
    });
    if (
      JSON.stringify(summary.counts) !== JSON.stringify(report.counts) ||
      summary.gate.status !== report.gate.status ||
      summary.gate.exitCode !== report.gate.exitCode ||
      report.gate.scopeClaim !== manifest.scopeClaim ||
      report.gate.policyHash !== manifest.policyHash ||
      report.run.executionCompleteness !== summary.gate.executionCompleteness ||
      report.gate.executionCompleteness !== summary.gate.executionCompleteness
    )
      throw Error('AGGREGATE_MISMATCH');
    return {
      exitCode: summary.gate.exitCode,
      gate: summary.gate.status,
      runId: bundle.runId,
      runDir: root,
    };
  } catch {
    return {
      exitCode: 2,
      gate: 'INCOMPLETE',
      diagnostic: 'BUNDLE_VERIFICATION_FAILED',
      runDir: root,
    };
  }
}
