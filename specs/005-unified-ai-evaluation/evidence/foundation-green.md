# T009–T016 — Foundational behavior verification

Date: 2026-09-14. Command: `pnpm --filter @en/server exec jest --runInBand apps/ai/test/evals/unified/tests/schemas.spec.ts apps/ai/test/evals/unified/tests/control-isolation.spec.ts apps/ai/test/evals/unified/tests/journal-state.spec.ts apps/ai/test/evals/unified/tests/budget-admission.spec.ts`

Actual exit 0: 4 suites, 40 tests passed, 0 skipped. Initial RED: [foundation-red.md](./foundation-red.md). No Provider calls.

| Task | Implemented behavior and verification |
|---|---|
| T009 | Strict versioned E1–E9 schemas: 16 schema cases including bad metadata, finite values, bounded quick, terminal and gate/exit. |
| T010 | Verified content hash, trusted registry lookup, candidate approval denied; traversal/symlink rejection. |
| T011 | Clean cwd and explicit environment; exact identity matching and production-access refusal under controlled probe. Actual credentials/DB isolation remains G-03/T066, not proven here. |
| T012 | Content fingerprint changes on source edits, sensitive input names refused; snapshot implementation reads Git without branch/fetch mutations. |
| T013 | Manifest first, fsynced append/hash chain, reservation-before-dispatch, truncation/tamper and failed-write state. |
| T014 | Whole-ledger reservation, idempotency, unknown charge retained, durable admission, overcharge stop, quick denies external calls. |
| T015 | Permissions 0700/0600, no-replace atomic result publication, path confinement and secret rejection. Restricted persistence remains closed until US6 approved policy integration. |
| T016 | One terminal per item, missing planned items retained, counts and FAIL/INCOMPLETE/REVIEW/PASS priority. |

The first isolation run after implementation passed 8/9: the remaining assertion compared macOS `/var` with canonical `/private/var`. The fixture was corrected to compare canonical roots; security canonicalization was retained. The approval fixture was corrected to use a SHA-256 and required reason, matching the defined contract.

This evidence is foundation-only; no live quality, real resource identity or feature acceptance claimed.
