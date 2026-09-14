import type { Summary } from './report';
const cell = (s: unknown) =>
  String(s)
    .replace(/[\r\n]/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/[<>]/g, '');
export function renderSummary(report: Summary) {
  return [
    `# ${report.gate.status} — ${cell(report.scopeClaim)}`,
    `Run: ${cell(report.runId)}`,
    `Planned: ${report.counts.planned}; completed: ${report.counts.completed}; passed: ${report.counts.passed}; failed: ${report.counts.failed}; review: ${report.counts.review}; skipped: ${report.counts.skipped}; error: ${report.counts.error}; not run: ${report.counts.notRun}.`,
    '',
    '| Case | Mode | State | Reasons |',
    '|---|---|---|---|',
    ...report.cases.map(
      (c) =>
        `| ${cell(c.caseId)} | ${cell(c.declaredMode)} | ${c.terminalState} | ${cell(c.reasonCodes.join(', '))} |`,
    ),
    '',
    `Missing: ${report.gate.missingRequirements.map(cell).join(', ') || 'none in declared scope'}`,
    '',
    'Usage: unknown when no per-call observation is available. Mock and rule checks do not establish real model quality.',
    'Evidence: synthetic development checks only; real resources, calibrated quality and release readiness require separate evidence.',
    '',
  ].join('\n');
}

import { z } from '@en/common/coach/zod';
import { reportSchema } from '../contracts/report.schema';
export function renderReport(input: z.infer<typeof reportSchema>) {
  const r = reportSchema.parse(input);
  return [
    renderSummary({
      runId: r.run.id,
      scopeClaim: r.scope.scopeClaim,
      counts: r.counts,
      cases: r.cases,
      gate: r.gate,
      usage: {
        actualCostMicros: null,
        inputTokens: null,
        outputTokens: null,
        unavailableReason: 'NO_USAGE_EVIDENCE',
      },
    }),
    `Control: ${cell(r.control.controlHash)} (${cell(r.control.trust)} trust).`,
    `Candidate: ${cell(r.versions.candidate.code.commit)}; tree ${cell(r.versions.candidate.code.candidateTreeHash)}; dirty ${r.versions.candidate.code.dirty}.`,
    `Dataset: ${cell(r.control.catalogHash)}; policy ${cell(r.control.policyHash)}.`,
    `Selected: ${r.scope.selectedItems.length}; required cases: ${r.scope.requiredItems.length}; excluded: ${r.scope.excludedCases.length}.`,
    `Required modes: ${r.scope.requiredModes.map(cell).join(', ') || 'offline scope'}; ${r.scope.selectionReason.map(cell).join('; ')}.`,
    '',
    '| Case | Requirements | Attempts | Evidence |',
    '|---|---|---|---|',
    ...r.cases.map(
      (c) =>
        `| ${cell(c.caseId)} | ${cell(c.requirements.map((x) => x.spec + ':' + x.ids.join(',')).join('; '))} | ${cell(c.allAttempts.join(', '))} | ${cell(c.actualRef?.path ?? 'missing')} |`,
    ),
    '',
    r.metrics.length
      ? '| Metric | Value | Independent N | Missing reason |\n|---|---|---|---|\n' +
        r.metrics
          .map(
            (m) =>
              `| ${cell(m.metricId)} | ${cell(m.value ?? 'unknown')} | ${m.independentN} | ${cell(m.unavailableReason ?? '')} |`,
          )
          .join('\n')
      : 'Quality metrics: not measured; fixture and controlled business checks only.',
    `Budget micros: ${r.usage.budgetMicros}; reserved: ${r.usage.reservedMicros}; settled: ${r.usage.settledMicros}. Actual call records: ${r.usage.calls.length}.`,
    `Baseline: ${cell(r.comparisonUnavailableReason ?? 'see comparison record')}.`,
    '',
    'Reproduction arguments (JSON array, not a shell command):',
    '```json',
    JSON.stringify(r.reproduction.arguments),
    '```',
    `Prerequisites: ${r.reproduction.prerequisites.map(cell).join('; ')}.`,
    `Limitations: ${r.reproduction.limitations.map(cell).join('; ')}.`,
    '',
  ].join('\n');
}
