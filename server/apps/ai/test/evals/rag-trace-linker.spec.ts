import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runRagEvaluation } from './run';
import { evaluateReleaseGate } from './release-gate';
import { loadRagEvalCases } from './rag-case.schema';
import { linkRagEvalTrace } from './trace-linker';

describe('RAG eval trace linkage and pending baseline', () => {
  const input = {
    caseId: 'rag_word_meaning',
    datasetVersion: 'rag-eval.synthetic.v1',
    trace: {
      traceId: 'trace_eval_001',
      requestId: 'request_eval_001',
      promptVersion: 'coach.rag.v1',
      modelVersion: 'mock-rag-v1',
      schemaVersion: 'coach.result.v2',
    },
    retrieval: {
      metadataVersion: 'rag-trace.v1' as const,
      status: 'success' as const,
      usedCitationIds: ['cit_eval_used_001'],
      unusedCitationIds: ['cit_eval_unused_001'],
    },
    claims: [
      { claimPath: 'answer.claims.0', citationIds: ['cit_eval_used_001'] },
    ],
    feedback: { feedbackId: 'feedback_eval_001', rating: 'UP' as const },
  };

  it('links case to one Coach Trace, retrieval, claims/citations and feedback', () => {
    const link = linkRagEvalTrace(input);
    expect(link).toMatchObject(input);
    expect(Object.isFrozen(link)).toBe(true);
    expect(JSON.stringify(link)).not.toMatch(/userId|private content|system prompt/i);
  });

  it('rejects claim citations not used by this retrieval', () => {
    expect(() =>
      linkRagEvalTrace({
        ...input,
        claims: [{ claimPath: 'answer.claims.0', citationIds: ['cit_fabricated'] }],
      }),
    ).toThrow('actually used');
  });

  it('keeps the initial measured baseline and release gate pending', async () => {
    const baseline = JSON.parse(
      readFileSync(resolve(__dirname, 'baselines/rag-v1-pending.json'), 'utf8'),
    );
    const cases = loadRagEvalCases(resolve(__dirname, 'fixtures/rag-cases.jsonl'));
    const report = await runRagEvaluation({
      mode: 'deterministic',
      cases,
      versions: {
        datasetVersion: baseline.datasetVersion,
        ...baseline.versions,
        generatedAt: '2026-09-08T00:00:00.000Z',
      },
    });
    const gate = evaluateReleaseGate({
      report,
      baseline: {
        status: baseline.status,
        approved: baseline.approved,
        datasetVersion: baseline.datasetVersion,
      },
      budget: { status: 'pending_measurement', approved: false },
    });
    expect(baseline.releaseGate).toEqual({
      allowed: false,
      reason: 'baseline_not_approved',
    });
    expect(gate.allowed).toBe(false);
    expect(gate.failures).toEqual(
      expect.arrayContaining(['baseline_not_approved', 'budget_not_approved']),
    );
  });
});
