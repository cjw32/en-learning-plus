# T017–T019 — Foundation checkpoint

Date: 2026-09-14.

- T017: actual subprocess boundary tests authored. First RED run included incorrect async matcher shape with absent implementation; corrected the test-only absent subject to reject UNIMPLEMENTED_WORKER. Valid RED rerun: 7/7 fail against missing behavior, exit 1.
- T018: registered worker entry/hash, no shell or inherited credential/preload environment, private clean cwd, strict/bound IPC, quick call denial, deadlines and controlled process-group termination implemented. Actual local child tests: 7/7 pass, exit 0.
- T019: `pnpm --filter @en/server exec jest --runInBand apps/ai/test/evals/unified/tests`: 5 suites, 47/47 pass, no skips, exit 0. `pnpm --filter @en/server build`: Nest build succeeds, exit 0 (before and after worker implementation).

Public contracts and worker/ledger/artifact primitives are now available for US1. Quick mode cannot obtain external call permission. No production AppModule was started; no Provider/embedding/judge calls. This is controlled local behavior evidence only, not an OS security sandbox certification or real database isolation evidence. Live credentials and actual resource probes remain closed under G-03.

Existing production bindings, lockfile and package/config files were not edited. The generated server build is covered by the existing ignore rules; no ignore changes needed.
