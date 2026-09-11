# Synthetic MCP evaluation summary

Recorded: 2026-09-11
Candidate: `3f3ad9f2004fec5a6b255efe70759b57489ab16a+working-tree`
Environment: Node `v24.18.0`, pnpm `10.32.1`, local fake issuer/provider
Status: **NOT_READY**

## Reproduction

```sh
pnpm --filter @en/server test -- --runInBand apps/ai/test/evals/mcp
pnpm --filter @en/server test -- --runInBand \
  apps/ai/test/security/mcp-sensitive-data-scan.security.spec.ts \
  apps/ai/test/integration/mcp-trace-query.integration.spec.ts \
  apps/ai/test/integration/mcp-retention-deletion.integration.spec.ts \
  apps/ai/test/contract/mcp-client-compatibility-harness.contract.spec.ts
pnpm --filter @en/server build
```

The MCP evaluation command passed 6 suites and 35 tests. The cross-cutting command passed 8 suites and 33 tests when run with the evaluation tests; the module/deletion regression passed 3 suites and 8 tests (Supertest used a local ephemeral port). The server build passed.

## Deterministic results

The versioned `mcp-eval-cases.v1` fixture contains 18 synthetic/hand-authored cases: one positive and one failure case in each of protocol, resources, tools, prompts, confirmation, duplicate-write, cancellation, injection, and isolation. All deterministic assertions passed. Zero-tolerance violations and sensitive-canary hits were both zero. Fake-provider token and estimated-cost totals were zero; idempotent replay incremental cost was zero.

Machine-readable artifacts:

- [Evaluation report](synthetic-report.json)
- [Cost report](cost-report.json)
- [Observability/redaction report](observability-report.json)
- [Fail-closed release decision](release-decision.json)

## Interpretation and gates

This is reproducible synthetic evidence, not a billed-cost, production latency, real-provider quality, OAuth, source-rights, retention, or client-interoperability baseline. Quality and P50/P95 fields therefore remain explicitly `null` with missing-data reasons. GATE-B, GATE-D, and GATE-E are unapproved, and all four real client rows remain independent `PENDING` entries. The release evaluator consequently returns **NOT_READY**; no production configuration, external model call, client registration, push, or deployment was performed.
