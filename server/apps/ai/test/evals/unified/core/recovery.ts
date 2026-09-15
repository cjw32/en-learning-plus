import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { safePath } from './control-loader';
import { createArtifactStore } from './artifact-store';
import { readJournal } from './event-journal';
import { itemResultSchema, executionItemSchema } from '../contracts/run.schema';
import { summarize } from './report';
import { renderSummary } from './report-markdown';
import { failureCodes } from './gate';

// Forensic recovery never resumes business/model calls, releases reservations,
// modifies a sealed result, or claims an in-flight write was rolled back.
export function recoverRun(directory: string) {
  const root = realpathSync(directory);
  const manifest = JSON.parse(
    readFileSync(safePath(root, 'manifest.json'), 'utf8'),
  );
  const journal = readJournal(root, manifest.runId);
  const items = manifest.items.map((value: unknown) =>
    executionItemSchema.parse(value),
  );
  const missing = ['RECOVERY_SNAPSHOT_ONLY', ...manifest.missingRequirements];
  if (!journal.complete) missing.push(journal.reason!);
  const results = items.map((item) => {
    const attempts: any[] = [];
    const started = journal.events.filter(
      (e) => e.type === 'ATTEMPT_FINISHED' && e.payload.itemId === item.itemId,
    );
    for (const event of started) {
      const id =
        typeof event.payload.attemptId === 'string'
          ? event.payload.attemptId
          : `attempt-${item.itemId}-${event.payload.repeat}`;
      try {
        const { repeatIndex, retryIndex, parentAttemptId, ...record } =
          JSON.parse(
            readFileSync(safePath(root, `attempts/${id}.json`), 'utf8'),
          );
        const attempt = itemResultSchema.parse(record);
        if (
          attempt.itemId !== item.itemId ||
          attempt.caseId !== item.caseId ||
          attempt.terminalState !== event.payload.terminalState
        )
          throw Error('ATTEMPT_IDENTITY_MISMATCH');
        attempts.push(attempt);
      } catch {
        missing.push(`${item.itemId}:ATTEMPT_EVIDENCE_MISSING`);
      }
    }
    const failed = attempts.find(
      (a) =>
        a.terminalState === 'failed' &&
        a.reasonCodes.some((c) => failureCodes.has(c)),
    );
    let completed = false;
    const terminal = journal.events.filter(
      (e) => e.type === 'ITEM_FINISHED' && e.payload.itemId === item.itemId,
    );
    if (
      !failed &&
      terminal.length === 1 &&
      terminal[0].payload.terminalState === 'passed' &&
      attempts.length >= item.expectedRepeatCount &&
      attempts.every((a) => a.terminalState === 'passed')
    ) {
      try {
        const ref = terminal[0].payload.actualRef as {
          path: string;
          hash: string;
        };
        const text = readFileSync(safePath(root, ref.path));
        const observed = JSON.parse(text.toString('utf8'));
        completed =
          createHash('sha256').update(text).digest('hex') === ref.hash &&
          observed.terminalState === 'passed' &&
          JSON.stringify(observed.attempts) ===
            JSON.stringify(attempts.flatMap((a) => a.allAttempts));
      } catch {
        missing.push(`${item.itemId}:OBSERVATION_MISSING`);
      }
    }
    return itemResultSchema.parse({
      ...item,
      terminalState: failed ? 'failed' : completed ? 'passed' : 'not_run',
      reasonCodes: failed
        ? failed.reasonCodes
        : completed
          ? []
          : ['REQUIRED_ITEM_MISSING'],
      allAttempts: attempts.flatMap((a) => a.allAttempts),
      requirements: [
        { spec: '005-unified-ai-evaluation', ids: ['FR-033', 'FR-034'] },
      ],
      expectedRef: null,
      actualRef: null,
      evidenceRefs: [],
      steps: attempts.flatMap((a) => a.steps),
    });
  });
  const id = `recovery-${randomUUID()}`;
  const store = createArtifactStore(dirname(root), id);
  const summary = summarize(results, {
    scopeClaim: `recovery:${manifest.scopeClaim}`,
    runId: id,
    policyHash: manifest.policyHash,
    missingRequirements: [...new Set(missing)],
    purpose: manifest.purpose,
  });
  const pending = journal.events
    .filter(
      (e) =>
        ['RESERVED', 'DISPATCHED'].includes(e.type) &&
        !journal.events.some(
          (later) =>
            ['SETTLED', 'RELEASED'].includes(later.type) &&
            later.payload.callId === e.payload.callId,
        ),
    )
    .map((e) => String(e.payload.callId));
  const recovery = {
    schemaVersion: 'ai-evaluation-recovery.v1',
    sourceRunId: manifest.runId,
    sourceManifestHash: createHash('sha256')
      .update(readFileSync(safePath(root, 'manifest.json')))
      .digest('hex'),
    createdAt: new Date().toISOString(),
    operationStatus: 'RECORDED',
    evaluationGate: summary.gate.status,
    summary,
    unresolvedCalls: [...new Set(pending)],
    limitations: [
      'No calls resumed',
      'Unfinished items need a new run',
      'Unsettled reservations remain unresolved',
      'Original report remains immutable',
    ],
  };
  store.write('recovery.json', recovery);
  store.write('recovery.md', renderSummary(summary), { format: 'text' });
  return {
    exitCode: summary.gate.exitCode,
    gate: summary.gate.status,
    runId: id,
    runDir: store.root,
    sourceRunId: manifest.runId,
    operationStatus: 'RECORDED',
  };
}
