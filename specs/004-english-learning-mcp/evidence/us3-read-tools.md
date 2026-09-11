# US3 read Tool evidence

**Recorded**: 2026-09-11
**Scope**: T062–T074, deterministic local services and official MCP v2 clients
**Requirements**: FR-017–FR-021, FR-033–FR-049, SC-001, SC-003–SC-006, SC-011–SC-014
**Release interpretation**: implementation and test evidence only; not a production SLO, quality, latency, token, cost, or client-compatibility claim

## Outcome

All four read Tools are discoverable and callable through the official client in both supported protocol eras. The focused US3 run passed 8 suites / 58 tests, the official-client E2E passed 1 suite / 8 tests, and `pnpm --filter @en/server build` passed. The implementation reused the existing Learning and Coach retrieval services, public MCP schemas, Prisma-backed domain boundaries, Node crypto, and the three previously approved exact MCP packages. It added no further dependency and changed no production configuration.

| Verified property | Deterministic result |
|---|---:|
| Modern `2026-07-28` correct Tool cases | 4/4 |
| Legacy `2025-11-25` correct Tool cases | 4/4 |
| Modern legal empty/insufficient cases | 4/4 |
| Legacy `2025-11-25` legal empty/insufficient cases | 4/4 |
| Post-revocation calls rejected before a business call | 8/8 |
| Pre-dispatch cancelled calls rejected before a business call | 8/8 |
| Unauthorized/cross-user Tool successes | **0** |
| Unresolved or fabricated citations returned | **0** |
| Learning-state rows changed by read Tools | **0** |
| Focused US3 suites/tests | 8/8 suites, 58/58 tests |
| Official-client both-era E2E | 1/1 suite, 8/8 tests |

The correct and empty counts above are calls made by the in-process official client. The denied and cancelled counts cover four Tools in each of two eras. They are fixture measurements, not production rates.

## Tool contract and behavior matrix

| Tool | Current-user boundary | Correct result | Legal empty result | Deadline / budget metadata |
|---|---|---|---|---|
| `search_words` | Public, rights-filtered dictionary projection; no identity input | Bounded word summaries and optional signed cursor | `items: []`, `nextCursor: null` | 3 s / no model budget |
| `get_due_words` | Server injects current `userId`; stable due/priority/ID order | Current learner's due words and signed cursor | `totalDue: 0`, `items: []` | 3 s / no model budget |
| `search_learning_materials` | Server injects current user/request/trace; bridge reuses `searchV2` and rechecks source/filter/version/citation matches | Only current, authorized, citation-backed passages | `retrievalStatus: insufficient`, empty results/conflicts | 5 s / `mcp-rag-read.v1` |
| `get_learning_report` | Server injects current `userId`; maximum explicit range is 90 days | Summary plus bounded weakness evidence | Zero counts, null average, `dataCompleteness: insufficient` | 5 s / no model budget |

Every definition uses the checked-in public input/output schemas and declares read-only, non-destructive, idempotent, closed-world annotations. The registry applies `learning:read`, capability gates, and active-authorization revalidation to both discovery and direct calls.

## Isolation, provenance, and state integrity

- Learner A receives `word_alpha`, its complete report, and the authorized alpha course passage. Learner B receives no due words or material passage and an insufficient zero-count report. Learner B's combined serialized results contain no learner-A word, material, or identity marker.
- The material E2E resolves `cit_material_alpha_0001` against the fixture's issued citation record and compares title, excerpt, and content version. Security tests separately reject fabricated citations, stale embeddings, unauthorized courses, revoked sources, and result/citation mismatches.
- Before and after every correct, empty, denied, and cancelled E2E case, the test records both row count and SHA-256 content hash for `submissions`, `attempts`, `reviewSchedules`, `mastery`, and `idempotencyIntents`. All ten era/case comparisons are identical and no write port is exposed to a read Tool.
- Result validation rejects unknown or private fields, unsafe prompt/token text, excessive nesting, output above 256 KiB, and a RAG success result without valid citation provenance.
- Cancellation is checked at handler boundaries and between report stages. The both-era E2E also proves an already-cancelled official-client request is never dispatched to any of the four business services.

## Latency, token, and estimated-cost measurements

All values in this section are local deterministic-fixture observations. They are intentionally separated from any unapproved production baseline.

| Measurement | Observed value | Reproducible source | Interpretation |
|---|---:|---|---|
| Official-client both-era E2E Jest time | 0.96 s for 8 tests | [`mcp-read-tools.e2e-spec.ts`](../../../server/apps/ai/test/e2e/mcp-read-tools.e2e-spec.ts) and the E2E command below | Local aggregate test-run time only; not per-call latency |
| Deterministic RAG retrieval stage | 12 ms | first case in [`mcp-cost-meter.spec.ts`](../../../server/apps/ai/test/governance/mcp-cost-meter.spec.ts) | Injected clock measurement |
| Deterministic RAG projection stage | 5 ms | same cost-meter case | Injected clock measurement |
| Deterministic RAG total | 17 ms | same cost-meter case | Injected clock measurement |
| Governance-fixture input token upper bound | 47 | UTF-8 byte count of the fixture query | Conservative estimate, not provider tokenizer output |
| Governance-fixture output token upper bound | 0 | Failure/insufficient result fixture | Conservative estimate |
| Governance-fixture estimated cost | 1 micro-USD | test rates: 10,000 / 20,000 micro-USD per million input/output units | Arithmetic fixture; rates are not approved provider prices |
| E2E success input/output upper bounds | 25 / 33 | UTF-8 bytes of the E2E query/accepted excerpt | Deterministic success-path fixture |
| E2E success estimated cost | 1 micro-USD | test rates: 100 / 200 micro-USD per million units | Arithmetic fixture; not a production forecast |

The cost meter emits exactly one record for each started RAG retrieval, including a started retrieval that is later cancelled. Each record is at most 2 KiB and includes only HMAC correlation, provider/model labels, cache outcome, cancellation outcome, UTF-8-byte token upper bounds, estimated cost, and stage timings. Tests verify it excludes raw query text, learner/user/request/trace IDs, bearer tokens, prompts, and chain-of-thought.

No baseline, threshold, percentile, SLO, provider price, production model, cache-hit expectation, or budget approval has been supplied. Therefore latency/token/cost acceptance under GATE-E remains unapproved.

## Reproducible commands

Focused contracts, registry, result safety, state integrity, RAG provenance/boundaries, cost accounting, and official-client E2E:

```sh
pnpm --dir server exec jest --runInBand --testRegex '.*\.(spec|e2e-spec)\.ts$' --testPathPatterns 'mcp-(read-tools|material-search|result-validator|tool-registry|cost-meter)'
```

Result recorded on 2026-09-11: **8 suites passed; 58 tests passed**.

Official-client both-era E2E only:

```sh
pnpm --dir server exec jest --runInBand --testRegex '.*\.e2e-spec\.ts$' --testPathPatterns 'mcp-read-tools\.e2e-spec\.ts$'
```

Result recorded on 2026-09-11: **1 suite passed; 8 tests passed**; Jest-reported time was **0.96 s**. `pnpm --filter @en/server build` also passed.

## Evidence map

| Task / concern | Executable or implementation evidence | Result |
|---|---|---|
| T062 strict public Tool contracts | [`mcp-read-tools.contract.spec.ts`](../../../server/apps/ai/test/contract/mcp-read-tools.contract.spec.ts) | Four handlers validate input before service calls and return schema-valid public output |
| T063 read-only state integrity | [`mcp-read-tools-state.integration.spec.ts`](../../../server/apps/ai/test/integration/mcp-read-tools-state.integration.spec.ts) | Success/failure and two-user state snapshots preserve row counts and content hashes |
| T064/T069/T070 RAG boundary | [`mcp-material-search.security.spec.ts`](../../../server/apps/ai/test/security/mcp-material-search.security.spec.ts), [`mcp-learning.bridge.ts`](../../../server/apps/ai/src/coach/mcp/mcp-learning.bridge.ts) | Existing `searchV2` reused through a narrow read-only bridge; stale/unauthorized/unresolved evidence is removed |
| T065 unsafe input and cancellation | [`mcp-read-tools-boundary.security.spec.ts`](../../../server/apps/ai/test/security/mcp-read-tools-boundary.security.spec.ts) | File/HTTP/SQL/identity overrides, excessive report ranges, deadlines, cancellation, and unsafe/oversized results fail closed |
| T066–T068 four read projections | [`search-words.tool.ts`](../../../server/apps/ai/src/mcp/tools/search-words.tool.ts), [`get-due-words.tool.ts`](../../../server/apps/ai/src/mcp/tools/get-due-words.tool.ts), [`get-learning-report.tool.ts`](../../../server/apps/ai/src/mcp/tools/get-learning-report.tool.ts) | Correct and legal empty projections pass |
| T071 final outbound validation | [`mcp-result-validator.spec.ts`](../../../server/apps/ai/test/security/mcp-result-validator.spec.ts) | Schema, size, depth, unsafe-text, and citation invariants pass |
| T072 discovery/direct-call parity | [`mcp-tool-registry.contract.spec.ts`](../../../server/apps/ai/test/contract/mcp-tool-registry.contract.spec.ts) | Exact four read Tools; scope, gate, and next-call revocation enforced |
| T073 cost/observability | [`mcp-cost-meter.spec.ts`](../../../server/apps/ai/test/governance/mcp-cost-meter.spec.ts) | One bounded, redacted metric per started RAG call, including cancellation |
| T074 official-client workflow | [`mcp-read-tools.e2e-spec.ts`](../../../server/apps/ai/test/e2e/mcp-read-tools.e2e-spec.ts) | 8/8 correct, empty, denied, and cancelled cases across both eras; citation/isolation/state assertions pass |

## Readiness boundary

US3 is independently demonstrable with local deterministic services and official SDK/client transports. GATE-B production OAuth, GATE-C production configuration, GATE-D source-rights/retention approval, and GATE-E real-client quality/latency/token/cost/cancellation baselines remain open. No production gate was enabled, no provider was contacted, no learner content was sent externally, and no deployment, commit, or push was performed. Overall release status remains **NOT_READY**.
