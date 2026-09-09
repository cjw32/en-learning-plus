# Server test evidence

Date: 2026-09-03  
Jest: 30.2.0

| Command | Exit | Result |
|---|---:|---|
| `pnpm --filter @en/server exec jest --runInBand` | 0 | 35 suites, 149 tests, 1 snapshot passed |
| `pnpm --filter @en/server exec jest --config apps/ai/test/jest-e2e.json --runInBand` | 0 | 10 suites, 44 tests passed |
| `NODE_OPTIONS=--experimental-vm-modules COACH_E2E_DATABASE_URL=<localhost-test-url> ... pnpm --filter @en/server exec jest --config apps/server/test/jest-e2e.json --runInBand` | 0 | 2 suites, 4 isolated legacy-flow tests passed |
| `pnpm --filter @en/server exec jest --runInBand apps/ai/test/evals/coach-eval-deterministic.spec.ts apps/ai/test/evals/coach-eval-runner.spec.ts` | 0 | 2 suites, 13 evaluation/gate tests passed |

The quickstart form `pnpm --filter @en/server test -- --runInBand` was also attempted. The repository's existing script forwards the extra `--` as a Jest filename pattern, so it collected zero of the 35 discovered files and exited 1. Direct invocation above is the equivalent working command and is the authoritative result.

Coverage includes contracts, authorization, ownership, controlled graph paths, tool boundaries, grading-before-save, idempotency, cancellation, timeouts, budgets, cost, Trace, redaction, retention, deletion, 60 synthetic evaluation cases, and real AppModule regression against disposable PostgreSQL/Redis.
