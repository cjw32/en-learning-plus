# MCP final verification manifest

Recorded: 2026-09-11
Candidate: `3f3ad9f2004fec5a6b255efe70759b57489ab16a+working-tree`
Decision: **NOT_READY** (missing T146 approvals and real-provider/four-client baselines)

## Commands and exit status

| Coverage | Exact command | Exit | Result |
|---|---|---:|---|
| Complete server default Jest config, including MCP contract/security/integration/compatibility/eval/sensitive/release suites | `pnpm --filter @en/server exec jest --runInBand` | 0 | 213 suites / 1,251 tests passed; 1 DB-gated suite / 5 tests skipped |
| MCP both-era E2E | `pnpm --dir server exec jest --config ./apps/ai/test/jest-e2e.json --runInBand apps/ai/test/e2e/mcp-` | 0 | 6 suites / 34 tests passed |
| MCP contract/drift focus | `pnpm --filter @en/server exec jest --runInBand apps/ai/test/contract/mcp-schema-drift.contract.spec.ts apps/ai/test/contract/mcp-write-confirmation-openapi.contract.spec.ts apps/ai/test/contract/mcp-common-schemas.contract.spec.ts apps/ai/test/contract/mcp-prompts.contract.spec.ts apps/ai/test/contract/mcp-read-tools.contract.spec.ts apps/ai/test/contract/mcp-resources.contract.spec.ts` | 0 | 6 suites / 71 tests passed |
| MCP synthetic evaluation | `pnpm --filter @en/server test -- --runInBand apps/ai/test/evals/mcp` | 0 | 6 suites / 35 tests passed |
| Seeded public-boundary fuzz | `pnpm --filter @en/server test -- --runInBand apps/ai/test/security/mcp-public-boundary-fuzz.security.spec.ts` | 0 | 1 suite / 3 tests passed |
| Module/deletion regression | `pnpm --filter @en/server test -- --runInBand apps/ai/test/setup/mcp-module-shell.spec.ts libs/learning/src/privacy/learning-data-deletion.registry.spec.ts libs/learning/src/privacy/learning-data-deletion.pronunciation.spec.ts` | 0 | 3 suites / 8 tests passed; local ephemeral port only |
| Server static build | `pnpm --filter @en/server build` | 0 | Nest build passed |
| Web type/unit/build | `pnpm --filter @en/web type-check`; `pnpm --filter @en/web test:unit`; `pnpm --filter @en/web build` | 0 / 0 / 0 | 24 files / 135 tests; Vite build passed |
| Disposable PostgreSQL MCP invariants | `MCP_TEST_DATABASE_URL=postgresql://… pnpm --filter @en/server exec jest --runInBand apps/ai/test/integration/mcp-persistence-schema.integration.spec.ts` | 0 | 1 suite / 4 tests passed; loopback synthetic database only |
| Experimental bounded query load | `pgbench -h 127.0.0.1 -p 55491 -U woofeel -d mcp_load -n -c 8 -j 4 -T 10 -P 5 -f specs/004-english-learning-mcp/evidence/query-load.sql -l` | 0 | 6,937 transactions; 0 failures; P50 9.988 ms; P95 18.977 ms |

The complete default server run covers the named trace-query, retention/deletion, sensitive-data scan, client matrix, metrics, release gate, security and integration suites. Supertest was rerun outside the sandbox solely to permit ephemeral localhost binding. No external provider, real client, production service, push, or deployment was used.

## Artifact hashes (SHA-256)

| Artifact | SHA-256 |
|---|---|
| `contracts/mcp-capabilities.schema.json` | `5a37ba95e630bc6eb7e67b8ea7542ba9b9588db89f63e471e10e9e32a1c4d1e0` |
| `contracts/write-confirmation.openapi.yaml` | `9cf312c9c6154dbe8eb721b4d8e2d3558714faec7af5b99499180bab9a950bde` |
| `fixtures/mcp-eval-cases.v1.json` | `8b8de76545c57bbbb67c966ebb9f8ac337c4f45d082ef80f2826d8f33cc24449` |
| `evidence/evals/synthetic-report.json` | `a2ca47a2485f02e49dc350d72bb8c5bd18a3c9b709e04fe452ba0af85ebb3406` |
| `evidence/evals/cost-report.json` | `e014c9734fb76396a51e979c62df5f988caafd00cd234fee6e7154e0fe98385b` |
| `evidence/evals/observability-report.json` | `d1316dd4dcb7abd24ffe367ca989277ee64ec8eaaf39272491019bfa46ffcbb0` |
| `evidence/evals/release-decision.json` | `58ec2708f15f077ccee5ab8a999c2fa2d2ff2874a903949bb8646653ef800255` |
| `evidence/server-regression.md` | `65ae6768dcfc33b4f15033482749533f61dc3e20d4a6244ee6cc7e26b3e4e4eb` |
| `evidence/web-regression.md` | `4c530f43fd689e4ee65af5b37de433772015f5c0c5f4948be0aec968df467d07` |
| `evidence/query-load.sql` | `b5648c3e9bc228e850628a33fac1eda91f8a16172082a43601444bbae554dfce` |
| `evidence/query-load-baseline.md` | `2ff8bd6014918ce82807de4bb1799b47aee7f526c3d351e8b9407a15e6a17242` |

## Fail-closed interpretation

Synthetic/local verification is green and T149 now has explicitly experimental disposable-database evidence. The full regression's pre-existing pronunciation database tests remain gated, the load run is not a production-parity application-pool baseline, and T146 has no GATE-B/D/E or four-client authorization. The machine-readable release decision therefore remains `NOT_READY`.
