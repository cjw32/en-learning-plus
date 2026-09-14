# T005–T008 — Foundational RED evidence

Date: 2026-09-14. Command: `pnpm --filter @en/server exec jest --runInBand apps/ai/test/evals/unified/tests/schemas.spec.ts apps/ai/test/evals/unified/tests/control-isolation.spec.ts apps/ai/test/evals/unified/tests/journal-state.spec.ts apps/ai/test/evals/unified/tests/budget-admission.spec.ts`

Actual exit: 1. Four suites executed; 40 tests failed, 0 passed, 0 skipped. Missing behavior assertions failed (valid schema input yielded undefined; unsafe access was not rejected; no reservation/result/chain existed). The test-only loader returns no implementation when its source does not yet exist; it neither mocks behavior nor swallows errors from existing modules. No test failed because Jest could not compile/import its test file.

T005: strict contracts/invalid fields/finite values. T006: control, path, environment, fingerprints, private artifacts. T007: durable manifest/event chain, dispatch ordering, terminal/count/gate invariants. T008: global reservations, unknown charges, quick zero-call, durable admission.

This completes test-authoring RED tasks only; implementation is not yet passing. Provider calls: 0.
