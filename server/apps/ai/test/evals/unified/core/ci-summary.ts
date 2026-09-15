import { readFileSync } from 'node:fs';
import { z } from '@en/common/coach/zod';
import { verifyBundle } from './verify';
import { safePath } from './control-loader';
import { reportSchema, GateStatus } from '../contracts/report.schema';
const expectedSchema = z
  .array(
    z.strictObject({
      checkId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      runDir: z.string().min(1),
      candidateTreeHash: z.string().regex(/^[a-f0-9]{64}$/),
      controlHash: z.string().regex(/^[a-f0-9]{64}$/),
      scopeClaim: z.string().min(1),
    }),
  )
  .min(1)
  .refine((rows) => new Set(rows.map((r) => r.checkId)).size === rows.length);
export function summarizeCi(input: unknown) {
  const expected = expectedSchema.parse(input);
  const checks = expected.map((check) => {
    try {
      const verified = verifyBundle(check.runDir);
      if ('diagnostic' in verified) throw Error('MISSING_OR_INVALID_REPORT');
      const report = reportSchema.parse(
        JSON.parse(readFileSync(safePath(check.runDir, 'report.json'), 'utf8')),
      );
      if (
        report.versions.candidate.code.candidateTreeHash !==
          check.candidateTreeHash ||
        report.control.controlHash !== check.controlHash ||
        report.scope.scopeClaim !== check.scopeClaim
      )
        throw Error('EXPECTED_CHECK_MISMATCH');
      return {
        checkId: check.checkId,
        gate: report.gate.status,
        reason: 'VERIFIED',
      };
    } catch {
      return {
        checkId: check.checkId,
        gate: 'INCOMPLETE' as GateStatus,
        reason: 'MISSING_OR_MISMATCHED_EVIDENCE',
      };
    }
  });
  const gate: GateStatus = checks.some((c) => c.gate === 'FAIL')
    ? 'FAIL'
    : checks.some((c) => c.gate === 'INCOMPLETE')
      ? 'INCOMPLETE'
      : checks.some((c) => c.gate === 'REVIEW')
        ? 'REVIEW'
        : 'PASS';
  return {
    schemaVersion: 'ai-evaluation-ci-summary.v1',
    gate,
    exitCode: { PASS: 0, FAIL: 1, INCOMPLETE: 2, REVIEW: 3 }[gate],
    checks,
    trust: 'caller_supplied_expected_manifest',
    remoteBranchProtectionVerified: false,
  };
}
