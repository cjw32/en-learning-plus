# Server regression evidence

Recorded: 2026-09-11
Candidate: `3f3ad9f2004fec5a6b255efe70759b57489ab16a+working-tree`

## Result

```sh
pnpm --filter @en/server exec jest --runInBand
pnpm --filter @en/server build
```

The complete Jest unit/integration configuration passed **213 suites and 1,251 tests**; **1 database-gated suite / 5 tests** was skipped because no disposable test database URL was configured. The Nest build passed. The complete run was repeated outside the filesystem/network sandbox only so two Supertest suites could bind ephemeral localhost ports; it made no external request.

The first sandbox run exposed two stale security assertions that enumerated the constrained bridge methods. They were updated to include the intentionally added `prepareSubmitAnswer` method, then both suites passed 13/13 before the complete green run. This does not widen the bridge beyond the read, quiz-create, and answer-preparation operations specified by the feature.

## Baseline comparison

T001's selected baseline passed 5 suites / 13 tests. Those Coach auth, RAG material search, exercise contract, review schedule, and learning-deletion areas are included in the full green run. The larger count reflects MCP contracts/security/integration/evaluation coverage added by this feature. No previously passing regression failed. After the full run, the MCP persistence schema suite was rerun against a disposable loopback PostgreSQL database and passed 4/4; the separate T149 load evidence is experimental. No production database or migration was touched.
