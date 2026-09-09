# Implementation Evidence: 英语学习知识库 RAG 与来源引用

This file records reproducible, non-production evidence for each completed task. It must not contain credentials, production learner content, or unredacted identifiers.

## Evidence fields

- **Task ID**: Stable identifier from `tasks.md`.
- **Command**: Exact validation command or deterministic assertion.
- **Environment**: Local/test-only execution context.
- **Version**: Relevant runtime, schema, dataset, prompt, model, or policy version.
- **Result**: PASS, FAIL, BLOCKED, or PENDING with observed counts.
- **Approval**: Required external approval, or `not-required` for offline deterministic checks.

## Phase 1

### T001

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-fixtures`
- **Environment**: local; offline deterministic Jest; no database/network
- **Version**: Node v24.18.0; pnpm 10.32.1; synthetic corpus v1
- **Result**: PASS — 1 suite, 2 tests
- **Approval**: not-required

### T002

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-access-fixtures`
- **Environment**: local; offline deterministic Jest; synthetic identities only
- **Version**: Node v24.18.0; pnpm 10.32.1; access fixture v1
- **Result**: PASS — 1 suite, 2 tests
- **Approval**: not-required

### T003

- **Command**: `pnpm --filter @en/server test -- --runInBand knowledge-versions` and `pnpm --filter @en/server build`
- **Environment**: local; no database/network
- **Version**: Node v24.18.0; pnpm 10.32.1; `RAG_KNOWLEDGE_VERSIONS`
- **Result**: PASS — 1 suite, 2 tests; Nest build succeeded
- **Approval**: not-required

### T004

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-test-environment`
- **Environment**: local; synthetic environment values; no database/network
- **Version**: Node v24.18.0; pnpm 10.32.1; test environment policy v1
- **Result**: PASS — 1 suite, 6 tests
- **Approval**: not-required

### T005

- **Command**: `rg -n 'Task ID|Command|Environment|Version|Result|Approval' specs/002-rag-source-citations/implementation-evidence.md`
- **Environment**: local documentation validation
- **Version**: implementation evidence v1
- **Result**: PASS — all six evidence field labels found
- **Approval**: not-required

## Subsequent phases

Append one section per completed Task ID with the same six fields. Record unavailable infrastructure or approval gates as BLOCKED; never relabel them as PASS without observed evidence.

## Phase 2 — test-first red evidence

### T006

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-config`
- **Environment**: local; offline Jest
- **Version**: configuration contract v1
- **Result**: PASS — default-off configuration and all invalid approval/dimension/relevance/budget combinations passed 9 tests
- **Approval**: not-required

### T007

- **Command**: `NODE_OPTIONS='--experimental-vm-modules' RAG_TEST_DATABASE_URL='<approved-disposable-db>' pnpm --filter @en/server exec jest --config ./apps/ai/test/jest-e2e.json --runInBand rag-schema`
- **Environment**: local disposable Docker database on loopback; tmpfs storage; no production data/configuration
- **Version**: migration contract v1; PostgreSQL 17; `pgvector/pgvector:pg17` image digest `sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f`
- **Result**: PASS — 1 suite, 2 tests; pgvector extension present and zero ACTIVE releases after migration
- **Approval**: user approved starting Docker, downloading `pgvector/pgvector`, and creating a temporary test database on 2026-09-08

### T008

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-source-rights`
- **Environment**: local; offline Jest
- **Version**: source-rights policy v1
- **Result**: RED AS EXPECTED — source-rights module missing
- **Approval**: not-required

### T009

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-content-validator`
- **Environment**: local; offline Jest
- **Version**: content-validation policy v1
- **Result**: RED AS EXPECTED — content-validator module missing
- **Approval**: not-required

### T010

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-embedding-gateway`
- **Environment**: local; mocked HTTP and deterministic fake only
- **Version**: embedding gateway contract v1
- **Result**: PASS — 1 suite, 7 tests; deterministic fake, minimal HTTP payload, response validation, and pre-network approval gate passed
- **Approval**: not-required for mock/fake; live Provider remains unapproved

### T011

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-outbox`
- **Environment**: local; offline repository contract
- **Version**: outbox contract v1
- **Result**: PASS — 1 suite, 3 tests; duplicate enqueue is idempotent, active lease blocks duplicate claims, and payload contains no private content
- **Approval**: not-required for contract; disposable DB still required for persistence E2E

### T012

- **Command**: `pnpm --filter @en/server exec prisma validate --schema prisma/schema.prisma` and `pnpm --filter @en/server exec prisma generate --schema prisma/schema.prisma`
- **Environment**: local schema generation; no database connection
- **Version**: Prisma 7.6; RAG data model v1
- **Result**: PASS — schema valid; Prisma client generated
- **Approval**: not-required

### T013

- **Command**: `DATABASE_URL='<approved-disposable-db>' pnpm --filter @en/server exec prisma migrate deploy --schema prisma/schema.prisma` (twice), then the T007 command above
- **Environment**: local disposable Docker database on loopback; tmpfs storage; isolated test credentials; no project `.env` read
- **Version**: Prisma 7.6; PostgreSQL 17; migration `20260908000000_rag_knowledge`; image digest `sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f`
- **Result**: PASS — all 5 migrations applied once; second deploy reported no pending migrations; T007 passed 2/2 and confirmed zero ACTIVE releases
- **Approval**: user approved the disposable Docker pgvector environment on 2026-09-08

### T014

- **Command**: `pnpm --filter @en/server test -- --runInBand knowledge.types` and `pnpm --filter @en/server build`
- **Environment**: local; offline TypeScript/Jest
- **Version**: knowledge domain contract v1
- **Result**: PASS — 1 suite, 5 tests; Nest build succeeded; invalid release/ingestion/citation transitions rejected
- **Approval**: not-required

### T015

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-source-rights`
- **Environment**: local; offline in-memory rights repository
- **Version**: source-rights policy v1
- **Result**: PASS — 1 suite, 9 tests; inactive, expired, disabled-use, and unlisted fields fail closed
- **Approval**: not-required

### T016

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-content-validator`
- **Environment**: local; offline deterministic validation
- **Version**: content-validation policy v1
- **Result**: PASS — 1 suite, 9 tests; unsafe structure/PII/access mismatches rejected and instruction text classified as untrusted
- **Approval**: not-required

### T017

- **Command**: `pnpm --filter @en/server build`
- **Environment**: local; type-level gateway contract; no network
- **Version**: embedding gateway contract v1
- **Result**: PASS — Nest build succeeded; request, response, usage, version/dimension validation, cancellation, and retryable error shape compile
- **Approval**: not-required

### T018

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-embedding-gateway`, `git diff -- package.json server/package.json pnpm-lock.yaml`, and `pnpm --filter @en/server build`
- **Environment**: local; mocked native fetch; no live Provider/network
- **Version**: HTTP embedding adapter v1
- **Result**: PASS — 1 suite, 7 shared contract tests; build passed; dependency diff empty; unapproved/private-ineligible requests fail before network
- **Approval**: live embedding Provider remains unapproved and disabled

### T019

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-embedding-gateway`
- **Environment**: local; deterministic SHA-256 fake; network disabled by implementation
- **Version**: `embedding.fake.8d.v1`
- **Result**: PASS — same text/version produced identical finite non-zero vectors; 1 suite, 7 shared contract tests
- **Approval**: not-required

### T020

- **Command**: `pnpm --filter @en/server test -- --runInBand vector.repository rag-embedding-gateway`, static `rag-schema`, `pnpm --filter @en/server build`, and `rg -n '\$queryRawUnsafe|\$executeRawUnsafe' server/libs/learning/src/knowledge`
- **Environment**: local; tagged Prisma SQL mocked for unit test; live pgvector migration previously proven by T007
- **Version**: vector repository foundation v1; exact-cosine index policy v1
- **Result**: PASS — 2 suites, 9 tests; build passed; unsafe raw SQL API scan returned zero matches
- **Approval**: not-required

### T021

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-outbox`, `pnpm --filter @en/server build`, and unsafe raw SQL scan
- **Environment**: local; in-memory contract plus compiled tagged-SQL Prisma persistence
- **Version**: knowledge ingestion outbox v1
- **Result**: PASS — 1 suite, 3 tests; build passed; idempotency, bounded leasing, stale retry, and minimal payload assertions passed
- **Approval**: not-required

### T022

- **Command**: `pnpm --filter @en/server build` and `pnpm --filter @en/server test -- --runInBand coach-module-wiring knowledge.types`
- **Environment**: local Nest module metadata and TypeScript build
- **Version**: Learning knowledge module wiring v1
- **Result**: PASS — build succeeded; 2 suites, 7 tests; Prisma-backed rights/outbox/vector providers export through `@libs/learning`
- **Approval**: not-required

### T023

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-config coach-module-wiring`, `pnpm --filter @en/server build`, and Phase 2 aggregate tests
- **Environment**: local; no live embedding Provider; all environment flags absent/default-off
- **Version**: RAG runtime configuration v1; AI knowledge module wiring v1
- **Result**: PASS — focused 2 suites/11 tests, aggregate 8 suites/46 tests, Nest build, and live T007 2/2 all passed
- **Approval**: not-required; live Provider and all production RAG flags remain unapproved/off

## Phase 3 — US1 test-first evidence

### T024

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-search-learning-materials.contract`
- **Environment**: local; offline Zod contract test
- **Version**: planned `coach.tool.v2`; search contract v2
- **Result**: PASS — 1 suite, 7 tests; v2 bounds, strict identity exclusion, rank/score/state invariants, and outcome unions passed
- **Approval**: not-required

### T025

- **Command**: `pnpm --filter @en/server test -- --runInBand public-content.chunkers`
- **Environment**: local; offline deterministic chunking test
- **Version**: chunking.v1 test contract
- **Result**: PASS — 1 suite, 3 tests; word senses stay separate, empty grammar stays unavailable, and invalid source fields are rejected
- **Approval**: not-required

### T026

- **Command**: `pnpm --filter @en/server exec jest --config ./apps/ai/test/jest-e2e.json --runInBand knowledge-ingestion`
- **Environment**: local; deterministic fake embedding and in-memory publication boundary
- **Version**: ingestion contract v1; chunking.v1; embedding.fake.8d.v1
- **Result**: PASS — 1 suite, 2 integration tests; complete pipeline activates atomically and partial embedding failure leaves zero searchable chunks
- **Approval**: not-required

### T027

- **Command**: `NODE_OPTIONS='--experimental-vm-modules' RAG_TEST_DATABASE_URL='<approved-disposable-db>' pnpm --filter @en/server exec jest --config ./apps/ai/test/jest-e2e.json --runInBand rag-retrieval`
- **Environment**: approved local PostgreSQL 17 + pgvector temporary database; synthetic rows only
- **Version**: exact-cosine.v1; embedding.fake.8d.v1; retrieval.exact.v1
- **Result**: PASS — 1 suite, 2 live pgvector tests; stable exact rank, score 1.0, category/level/status/version/dimension filters, and incompatible-version empty result passed
- **Approval**: covered by the user-approved disposable Docker database

### T028

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-context-citations`
- **Environment**: local; offline security contract with synthetic injection and forged citation values
- **Version**: RAG context/citation safety contract v1
- **Result**: PASS — 1 suite, 5 security tests; token budget, untrusted boundary, server IDs, stale/forged claim rejection, one-repair downgrade, and generated-example labeling passed
- **Approval**: not-required

### T029

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-search-learning-materials.contract` and `pnpm --filter @en/server build`
- **Environment**: local; offline Zod validation
- **Version**: `coach.tool.v2`; search contract v2
- **Result**: PASS — 1 suite, 7 tests and Nest build; v1 exports preserved and v2 public/tool schemas reject `userId`
- **Approval**: not-required

### T030

- **Command**: contract generator twice; `pnpm --filter @en/server test -- --runInBand coach-contract-artifacts rag-contract-artifacts rag-search-learning-materials.contract`; `jq empty` on three JSON artifacts
- **Environment**: local; existing `tsx`/Zod toolchain; no network
- **Version**: v1 Coach contracts plus `coach.tool.v2`; generated search schema SHA-256 `0185d985c58ea1883cae4735e28018dad3fb0651f8453f3c9fa6983dbc8e24c7`
- **Result**: PASS — 3 suites, 10 tests; JSON parsed; second generation produced the identical hash
- **Approval**: not-required

### T033

- **Command**: `pnpm --filter @en/server test -- --runInBand public-content.chunkers` and `pnpm --filter @en/server build`
- **Environment**: local; offline SHA-256 deterministic chunking
- **Version**: chunking.v1; content.sha256.v1
- **Result**: PASS — 1 suite, 3 tests; stable boundaries/IDs/hashes and no invented content; Nest build succeeded
- **Approval**: not-required

### T031

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-source-rights public-content.chunkers public-source-adapters` and build
- **Environment**: local; synthetic rights ledger/WordBook record
- **Version**: WordBook source adapter v1; rights.test.v1
- **Result**: PASS — aggregate 3 suites, 14 tests; only explicitly approved fields projected; Oxford/Collins/BNC/FRQ content absent
- **Approval**: not-required

### T032

- **Command**: same source-adapter aggregate command as T031
- **Environment**: local; synthetic grammar availability record
- **Version**: grammar source adapter v1
- **Result**: PASS — missing grammar source returns unavailable and creates no rule/example/collocation; Nest build succeeded
- **Approval**: not-required

### T034

- **Command**: `pnpm --filter @en/server exec jest --config ./apps/ai/test/jest-e2e.json --runInBand knowledge-ingestion` and `pnpm --filter @en/server build`
- **Environment**: local; in-memory publication persistence; deterministic fake embedding; synthetic authorized source
- **Version**: ingestion pipeline v1; chunking.v1; embedding.fake.8d.v1
- **Result**: PASS — 1 suite, 2 tests; rights/content/version gates and all-or-nothing activation passed; Nest build succeeded
- **Approval**: not-required

### T035

- **Command**: `pnpm --filter @en/server test -- --runInBand retrieval-request.factory rag-search-learning-materials.contract`, build, and live T027
- **Environment**: local unit tests plus approved disposable pgvector integration
- **Version**: retrieval request factory v1; `coach.tool.v2`
- **Result**: PASS — 2 local suites/9 tests, build, and live T027 2/2; absent level is explicit and requested scopes cannot widen server policy
- **Approval**: disposable database covered by prior user approval

### T036

- **Command**: live T027 plus `EXPLAIN (ANALYZE, BUFFERS)` on the synthetic exact-cosine query
- **Environment**: disposable PostgreSQL 17 + pgvector; 2 synthetic 8d chunks; no ANN index
- **Version**: exact-cosine.v1; retrieval.exact.v1; embedding.fake.8d.v1
- **Result**: PASS — T027 2/2; planning 4.831 ms, execution 0.736 ms, 13 shared-buffer hits; baseline saved in `exact-search-baseline.md`
- **Approval**: disposable database covered by prior user approval; HNSW remains unapproved/not introduced

### T037

- **Command**: `pnpm --filter @en/server test -- --runInBand retrieval-ranking.service`, build, and live T027 baseline
- **Environment**: local deterministic ranking over already-authorized candidates
- **Version**: retrieval ranking policy v1
- **Result**: PASS — 1 suite, 2 tests; best within-source duplicate retained, independent sources preserved, ranks regenerated; Nest build succeeded
- **Approval**: not-required

### T039

- **Command**: focused `rag-context-citations` test `issues unpredictable` and `pnpm --filter @en/server build`
- **Environment**: local; injected deterministic server random source; in-memory citation persistence
- **Version**: citation issuer v1
- **Result**: PASS — focused citation test 1/1 (4 unrelated tests skipped); caller-proposed ID removed, exact version binding stored, Nest build succeeded
- **Approval**: not-required

### T040

- **Command**: `pnpm --filter @en/server test -- --runInBand learning-material.service rag-search-learning-materials.contract`, build, and live T027
- **Environment**: local flags-off legacy path plus approved disposable pgvector retrieval test
- **Version**: legacy `coach.tool.v1`; production-wired, default-off RAG search port `coach.tool.v2`
- **Result**: PASS — existing `search()` behavior remains unchanged with flags off; `KnowledgeModule` now provides the concrete embedding→permission-first exact search→ranking/context budget→server Citation implementation, `CoachModule` injects it into the existing tool, focused runtime/module tests pass, and Nest build succeeds
- **Approval**: not-required; production RAG remains disabled

### T041

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-search-learning-materials.contract coach-tool-boundary coach-read-tools` and build
- **Environment**: local; RAG mode injected in test, production/default flags absent
- **Version**: `coach.tool.v2` with flags-off v1 compatibility
- **Result**: PASS — 3 suites, 13 tests; RAG mode rejects identity override and calls service only with immutable context subject; Nest build succeeded
- **Approval**: not-required; RAG remains default-off

### T038

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-context.builder rag-context-citations` and build
- **Environment**: local; deterministic injected token counter; synthetic untrusted knowledge
- **Version**: RAG context builder v1
- **Result**: PASS — dedicated budget test plus combined 5/5 security tests; serialized context stayed within budget and fallback mode remained explicit
- **Approval**: not-required

### T042

- **Command**: AI `coach-runtime` E2E, `coach-control-plane`, `coach-read-tools`, T028, and build
- **Environment**: local; flags-off regression with injectable enabled/shadow routes; no live Provider
- **Version**: Coach RAG routing v1
- **Result**: PASS — final runtime E2E includes a live in-process v2 route proving the issued Citation survives retrieval, Prompt input, structured model output, final result and Trace claim links; flags-off control/read regressions and Nest build also pass
- **Approval**: not-required; enabled/shadow production flags remain off

### T043

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-context-citations coach-prompts rag-search-learning-materials.contract`, AI `coach-runtime` E2E, and build
- **Environment**: local; synthetic forged/stale citations and Prompt Injection text
- **Version**: `coach.result.v2` grounded answer Prompt/model/final validation
- **Result**: PASS — the model receives only request-issued IDs with bounded evidence, emits strict grounded claims, and receives at most one controlled retry; forged, stale, mismatched or unsupported links never reach the user and downgrade to a citation-free v2 `insufficient` result. Focused Prompt/security/runtime tests and Nest build pass
- **Approval**: not-required

## Phase 4 — US2 test-first evidence

### T044

- **Command**: live AI E2E `rag-access` with `RAG_TEST_DATABASE_URL=<approved-disposable-db>`
- **Environment**: disposable PostgreSQL 17 + pgvector; synthetic User A/User B/course/private canary
- **Version**: access isolation contract v1; embedding.fake.8d.v1
- **Result**: RED AS EXPECTED — User B leaks zero rows, but User A receives none because repository currently allows only PUBLIC
- **Approval**: disposable database covered by prior user approval

### T045

- **Command**: `pnpm --filter @en/server test -- --runInBand private-learning-projection`
- **Environment**: local; synthetic saved/unsaved grading facts and deterministic timestamps
- **Version**: private learning projection contract v1
- **Result**: RED AS EXPECTED — Jest cannot resolve the not-yet-implemented wrong-answer projector and private-summary service; the test fixes eligibility, minimal-payload, PII-rejection, and deterministic-summary expectations before implementation
- **Approval**: not-required

### T046

- **Command**: live AI E2E `rag-private-deletion` with `RAG_TEST_DATABASE_URL=<approved-disposable-db>`
- **Environment**: disposable PostgreSQL 17 + pgvector; isolated User A/User B private summaries, chunks, and citations
- **Version**: private deletion lifecycle contract v1
- **Result**: RED AS EXPECTED — valid fixtures seed successfully, but current deletion repository leaves User A document/chunk ACTIVE and does not physically remove the private document; User B preservation assertions are fixed by the test
- **Approval**: disposable database covered by prior user approval

### T047

- **Command**: `pnpm --filter @en/server test -- --runInBand course.source private-learning-projection` and server build
- **Environment**: local; synthetic licensed course hierarchy; no network
- **Version**: course source adapter v1
- **Result**: PASS — real chapter/lesson/knowledge-point boundaries remain separate, access defaults to `OWNED_COURSE`, missing body is unavailable, and mixed content versions fail closed; aggregate 2 suites/8 tests and Nest build passed
- **Approval**: not-required

### T048

- **Command**: same focused projection command as T047 and server build
- **Environment**: local; synthetic saved/invalid grading facts
- **Version**: wrong-answer projection v1
- **Result**: PASS — only saved validated facts project; answer keys, grading rubric, conversation/trace data, drafts, unverified grades, and contact PII do not enter output
- **Approval**: not-required

### T049

- **Command**: same focused projection command as T047 and server build
- **Environment**: local; deterministic same-topic saved facts
- **Version**: private learning summary v1
- **Result**: PASS — stable topic/time/evidence version produced from saved facts; empty input makes no inference; aggregate build passed
- **Approval**: not-required

### T050

- **Command**: focused `coach-attempt` test, `apps/ai/test/integration/rag-outbox.spec.ts`, and server build
- **Environment**: local transactional in-memory repository; no network
- **Version**: private wrong-answer pipeline v1; private summary pipeline v1
- **Result**: PASS — 6 focused tests total; exactly one minimal rebuild command is committed after a validated first save, replay does not duplicate it, invalid/cancelled/rolled-back saves produce none, and generic outbox idempotency remains green; Nest build passed
- **Approval**: not-required

### T051

- **Command**: live AI E2E `rag-access rag-retrieval`, focused vector repository unit test, and server build
- **Environment**: disposable PostgreSQL 17 + pgvector with User A/User B/course entitlement/private canary
- **Version**: exact-cosine.v1; access SQL policy v1
- **Result**: PASS — 2 live suites/4 tests and 1 unit suite/2 tests; PUBLIC, purchased-course entitlement, and exact private owner checks run inside the eligible SQL CTE before scoring/return; cross-user leak count is zero; Nest build passed
- **Approval**: disposable database covered by prior user approval

### T052

- **Command**: focused `rag-personalization-filters` + T045 tests, live T044 access E2E, and server build
- **Environment**: local deterministic profile/due snapshots plus disposable pgvector access fixtures
- **Version**: verified personalization filter policy v1
- **Result**: PASS — local 2 suites/8 tests, live 1 suite/2 tests, and Nest build; only AVAILABLE user-declared level/current course/current weak/due facts widen filters, private categories require both the private flag and verified signals, and missing/stale states are recorded as unapplied without inferred filters
- **Approval**: disposable database covered by prior user approval

### T053

- **Command**: focused `rag-embedding-gateway` + T045 projection tests and server build
- **Environment**: local mocked HTTPS Provider; no network
- **Version**: private-embedding-minimal.v1
- **Result**: PASS — 2 suites/16 tests; private content requires explicit approved eligibility/purpose/version, normalized body contains only model + text, and identity fields, JWT/contact patterns, answer keys, grading rubrics, and technical context fail closed before fetch; Nest build passed
- **Approval**: not-required

### T054

- **Command**: server build and live AI E2E `rag-private-deletion coach-retention`
- **Environment**: disposable PostgreSQL 17 + pgvector; isolated User A/User B private documents, summaries, citations, and requests
- **Version**: private-purge.v1; private deletion lifecycle v1
- **Result**: PASS — 2 suites/6 tests; immediate transaction invalidates User A release/document/chunk/embedding eligibility, redacts and marks citations, marks summaries deleting, and writes an idempotent minimal PURGE outbox row; purge removes owned private content and detaches sanitized citation history while User B remains active; existing Trace unlink/replay deletion lifecycle remains green
- **Approval**: disposable database covered by prior user approval

### T055

- **Command**: `jq -s -e` structural/version/coverage validation over `rag-personalization.cases.jsonl`
- **Environment**: local synthetic JSONL only; no production or user data
- **Version**: rag-personalization-case.v1; rag-personalization.synthetic.v1
- **Result**: PASS — 7 cases cover paired CEFR levels, owned course, private wrong answer, private summary, missing signals, cross-owner canaries, and deleted private content; every case fixes allowed/forbidden source IDs, expected chunks, all retrieval versions, and cost/quality measurement fields
- **Approval**: not-required

### T056

- **Command**: `pnpm --filter @en/server exec jest --runInBand apps/ai/test/evals/rag-personalization.eval.spec.ts` and server build
- **Environment**: local deterministic synthetic evaluator; no Provider/network
- **Version**: rag-personalization.synthetic.v1; coach.tool.v2; retrieval.exact.v1
- **Result**: PASS — 1 suite/3 tests; exact allowed evidence differs by user/level, missing signals do not infer private filters, deleted content returns insufficient, Recall@K/Precision@K/MRR are reproducibly measured as 1 for the fixed cases, leak count is 0, and deterministic Provider cost is 0; Nest build passed
- **Approval**: not-required

## Phase 5 — US3 test-first evidence

### T057

- **Command**: focused `rag-degradation.workflow` test
- **Environment**: local deterministic synthetic retrieval outcomes
- **Version**: degradation outcome contract v1
- **Result**: RED AS EXPECTED — retrieval outcome service and RAG-specific fallback API do not yet exist
- **Approval**: not-required

### T058

- **Command**: focused `conflict-detector` test
- **Environment**: local structured factKey/hash/version/authority fixtures
- **Version**: conflict policy contract v1
- **Result**: RED AS EXPECTED — conflict detector does not yet exist
- **Approval**: not-required

### T059

- **Command**: AI E2E `rag-failure-cancellation`
- **Environment**: local mocked cancellation/auth/account state; no network
- **Version**: late-result consumption guard contract v1
- **Result**: RED AS EXPECTED — all six tests reach the not-yet-implemented post-retrieval consumption guard
- **Approval**: not-required

### T060

- **Command**: focused `rag-injection-citation` security test
- **Environment**: local malicious synthetic tool input, knowledge text, and forged citation
- **Version**: coach.tool.v2; grounded-claim validation v1
- **Result**: PASS — 1 suite/3 tests; strict input rejects identity/budget/tool overrides, document instructions remain untrusted delimited data, and forged citation IDs are rejected/removed with no claim support
- **Approval**: not-required

### T061

- **Command**: focused `conflict-detector` test and server build
- **Environment**: local structured factKey/hash/version/authority fixtures
- **Version**: conflict policy v1
- **Result**: PASS — 1 suite/4 tests; same-value duplicates collapse deterministically, a strictly newer active version can resolve a conflict, inactive facts are excluded, and unresolved same-version/equal-authority facts enter only `conflict_context` with no factual result; Nest build passed
- **Approval**: not-required

### T062

- **Command**: focused `rag-degradation.workflow` test and server build
- **Environment**: local deterministic success/empty/low/invalid/unavailable/timeout/rate/error outcomes
- **Version**: retrieval outcome policy v1
- **Result**: PASS — 1 suite/10 tests; stable `success`/`insufficient`/`failed` classification is complete, failed and insufficient results carry no evidence, diagnostic codes remain separate from answer evidence, and safe fallback contract passes; Nest build passed
- **Approval**: not-required

### T063

- **Command**: focused `rag-embedding-gateway`, AI E2E T059, and server build
- **Environment**: local mocked Provider/cancellation boundary; no network
- **Version**: embedding HTTP retry policy v1
- **Result**: PASS — embedding suite 12/12 and T059 6/6; only timeout/rate/5xx classes are retryable, attempts are capped, caller deadline bounds per-attempt timeout, and cancellation/expired deadline prevents starting or retrying fetch; Nest build passed
- **Approval**: not-required

### T064

- **Command**: focused T057 + `coach-control-plane`, AI E2E `coach-runtime rag-failure-cancellation`, and server build
- **Environment**: local deterministic workflow failures; RAG default-off regression
- **Version**: RAG degradation fallback v1
- **Result**: PASS — 4 suites/23 tests; insufficient and failed paths produce distinct safe wording with zero citations/examples, no model generation starts after insufficient retrieval, failed evidence cannot create exercises or learning writes, and legacy Coach runtime remains green
- **Approval**: not-required

### T065

- **Command**: AI E2E `rag-failure-cancellation coach-stream-recovery coach-runtime` and server build
- **Environment**: local mocked JWT clock/cancellation/account/access state; no network
- **Version**: late-result consumption guard v1
- **Result**: PASS — 3 suites/17 tests; ownership, JWT expiry, cancellation state, account deletion, and current access are rechecked after retrieval and before model/exercise use; rejected late results reach no Prompt/content Trace/replay/write callback; existing stream cancellation remains green
- **Approval**: not-required

### T066

- **Command**: `jq -s -e` coverage validation, focused `rag-degradation.eval` + T060 security tests, and server build
- **Environment**: local nine-case synthetic JSONL evaluator; no Provider/network
- **Version**: rag-degradation-case.v1; rag-degradation.synthetic.v1
- **Result**: PASS — 9 scenarios cover empty, low relevance, unresolved conflict, revoked source, timeout, exception, Prompt Injection, forged citation, and non-material requests; deterministic status/citation/override assertions passed in 2 suites/5 tests; Nest build passed
- **Approval**: not-required

## Phase 6 — US4 test-first evidence

### T067

- **Command**: focused `coach-result-v2.contract` test
- **Environment**: local strict Zod contract fixtures; no network or user data
- **Version**: coach.result.v2 draft contract; coach.result.v1 compatibility
- **Result**: RED AS EXPECTED — v1 compatibility passes; the four v2 stored/public union, safe path, and de-duplication assertions fail because the v2 schemas are not implemented yet
- **Approval**: not-required

### T068

- **Command**: AI E2E `rag-citation-resolver` against the disposable pgvector database
- **Environment**: loopback-only temporary PostgreSQL/pgvector with synthetic users, entitlement, and public/course/private evidence
- **Version**: citation projection access contract v1
- **Result**: RED AS EXPECTED — the E2E suite is collected but cannot construct the not-yet-implemented Prisma citation repository/projection service
- **Approval**: covered by the user's explicit disposable Docker/pgvector authorization

### T069

- **Command**: AI E2E `rag-citation-history` against the disposable pgvector database
- **Environment**: loopback-only temporary PostgreSQL/pgvector with synthetic version, revocation, deletion, and excerpt canaries
- **Version**: dynamic citation projection contract v1
- **Result**: RED AS EXPECTED — the suite is collected but cannot construct the not-yet-implemented citation repository/projection service
- **Approval**: covered by the user's explicit disposable Docker/pgvector authorization

### T070

- **Command**: `pnpm --filter @en/web test:unit -- coach-citations`
- **Environment**: local Vue/Vitest synthetic citation fixtures; no network
- **Version**: coach.result.v2 citation UI contract v1
- **Result**: RED AS EXPECTED — all 30 existing web tests remain green; the new suite cannot resolve the not-yet-created `CitationCard.vue`
- **Approval**: not-required

### T071

- **Command**: focused `coach-result-v2.contract` test and server build
- **Environment**: local strict Zod contracts; no network
- **Version**: coach.result.v2 stored/public schemas; coach.result.v1 compatibility
- **Result**: PASS — 1 suite/5 tests; v2 stored payload permits only citation IDs and grounded claims, public citations use a strict active/unavailable union, IDs and safe result paths are validated/de-duplicated, and v1 remains accepted; Nest build passed
- **Approval**: not-required

### T072

- **Command**: existing TypeScript contract generator, focused `rag-contract-artifacts` + T067 tests, and server build
- **Environment**: local deterministic generation; no network
- **Version**: Coach RAG contracts 2.0.0
- **Result**: PASS — 2 suites/6 tests; v2 result JSON Schema and citation OpenAPI are deterministically generated and match committed artifacts, both parse as JSON (and therefore YAML 1.2), the public contract contains no `userId`, and Nest build passed
- **Approval**: not-required; generator required an out-of-sandbox IPC socket after the sandbox denied it

### T073

- **Command**: server build (live version/status behavior is exercised with T074)
- **Environment**: local Prisma generated client; no database mutation for this task-level compile check
- **Version**: citation repository v1
- **Result**: PASS — repository compiles with collision-preserving batch persistence, citation ID lookup, request-subject-scoped candidate reads, exact chunk/document/content-version fields, and current purchased-course entitlement lookup; Nest build passed and T074's live E2E later verified the stored bindings
- **Approval**: not-required

### T074

- **Command**: AI E2E `rag-citation-resolver rag-citation-history` against the disposable pgvector database
- **Environment**: loopback-only temporary PostgreSQL/pgvector with synthetic public/course/private, replacement-version, revocation, deletion, and canary rows
- **Version**: citation projection v1; coach.result.v2
- **Result**: PASS — 2 suites/5 tests; each read reauthorizes request ownership, course purchase, private owner, source/release/document/chunk/citation state, version and excerpt hash; unauthorized/nonexistent inputs share a generic response, old IDs never bind replacement content, and unavailable results expose no stale excerpts or internal identifiers
- **Approval**: covered by the user's explicit disposable Docker/pgvector authorization

### T075

- **Command**: focused `coach-request-state` + T067 contract tests and server build
- **Environment**: local captured Prisma transaction writes with synthetic v2 private excerpt canary; no database/network
- **Version**: coach.result.v2 storage projection
- **Result**: PASS — 2 suites/10 tests; both CoachRequest.finalResult and CoachMessage.structuredResult writes retain only unique citation IDs and grounded claims, dynamic excerpt/locator/source details are absent, v1 behavior remains compatible, and Nest build passed
- **Approval**: not-required

### T076

- **Command**: focused `rag-openapi-contract` + generated artifact tests, server build, and live AI E2E `rag-citation-resolver`
- **Environment**: local contract checks plus loopback-only disposable PostgreSQL/pgvector synthetic resolver fixtures
- **Version**: citation detail API 2.0.0; citation projection v1
- **Result**: PASS — contract suites 3/3 and resolver E2E 2/2; the v1 Coach controller exposes an authenticated opaque-ID route, service identity comes only from CoachExecutionContext, malformed IDs are rejected, valid unknown/unauthorized IDs receive the same safe projection, and Nest build passed
- **Approval**: disposable database covered by the user's explicit authorization

### T077

- **Command**: focused SSE/API contract tests, server build, then AI E2E `coach-stream-recovery rag-citation-history`
- **Environment**: local in-memory replay store plus loopback-only disposable PostgreSQL/pgvector history fixture
- **Version**: coach.sse.v1 envelope with v1/v2 result union; dynamic result projection v1
- **Result**: PASS — focused suites 8/8, E2E suites 13/13, and Nest build passed; v2 result events are reprojected for the authenticated reconnecting subject, durable request/history reads project stored IDs, stale stream excerpts are absent, and v1 replay/cancellation/reconciliation behavior remains green
- **Approval**: disposable database covered by the user's explicit authorization

### T078

- **Command**: focused Web `coach-api.spec.ts`
- **Environment**: local Axios adapter and strict common-package parser fixtures; no network
- **Version**: web Coach v1/v2 result and citation client contract
- **Result**: PASS — 1 suite/5 tests; v1/v2 parse, unknown-version fail-closed behavior, opaque citation ID validation, authenticated relative API path construction, and code-owned locator routing pass; no arbitrary URL is requested. Full Vue type-check correctly remains pending on T080's CoachMessage v2 prop implementation.
- **Approval**: not-required

### T079

- **Command**: focused Web `coach-stream.spec.ts`
- **Environment**: local Pinia reducer with synthetic v1/v2 events and a mocked same-origin citation resolver; no network
- **Version**: web citation state v1
- **Result**: PASS — 1 suite/8 tests; duplicate citation IDs collapse while two claims retain their links, genuinely distinct citation IDs/sources remain separate, lazy permission refresh replaces stale active evidence with a generic unavailable projection, and existing stream reducer behavior remains green
- **Approval**: not-required

### T080

- **Command**: focused T070 + Coach store/API Web tests, Vue type-check, and `pnpm exec playwright test coach-streaming`
- **Environment**: local Vitest/jsdom and Playwright Chromium with the existing mocked Coach API/SSE routes
- **Version**: Coach citation card UI v1
- **Result**: PASS — 3 suites/17 unit tests, Vue type-check, and 7 Playwright scenarios; cards display safe source/title/category/excerpt and claim links, private cards use a minimal learner-facing label, unavailable cards contain no stale evidence, duplicate cards collapse, and open actions use only code-owned relative route mappings. Expected tracker proxy refusals did not affect the mocked Coach scenarios.
- **Approval**: Playwright needed an out-of-sandbox loopback listener after the sandbox denied port 8080

## Phase 7 — US5 test-first evidence

### T081

- **Command**: AI E2E `knowledge-release`
- **Environment**: local deterministic release state fixtures; no network
- **Version**: release activation contract v1
- **Result**: RED AS EXPECTED — the test reaches the not-yet-implemented KnowledgeReleaseService/repository boundary
- **Approval**: not-required

### T082

- **Command**: AI E2E `knowledge-idempotency`
- **Environment**: local deterministic ingestion/outbox fixtures; no network
- **Version**: ingestion idempotency contract v1
- **Result**: RED AS EXPECTED — repeated outbox behavior already passes; ingestion persistence is not yet exported/implemented as the idempotent lifecycle boundary
- **Approval**: not-required

### T083

- **Command**: AI E2E `knowledge-reembedding`
- **Environment**: local deterministic version-switch fixtures; no network
- **Version**: re-embedding switch contract v1
- **Result**: RED AS EXPECTED — the release service/repository required for failure retention and atomic switch does not exist yet
- **Approval**: not-required

### T084

- **Command**: AI E2E `knowledge-retention`
- **Environment**: local synthetic source/release/document/chunk/citation/replay fixtures; no network
- **Version**: knowledge lifecycle invalidation contract v1
- **Result**: RED AS EXPECTED — source invalidation repository/coordinator and replay purge integration do not exist yet
- **Approval**: not-required

### T085

- **Command**: focused `rag-outbox.spec.ts` and server build
- **Environment**: local in-memory outbox plus mocked BullMQ queue; no Redis/network
- **Version**: knowledge outbox dispatcher v1
- **Result**: PASS — 1 suite/5 tests; bounded lease/batch claims, deterministic job IDs, ID/operation/version-only payloads, duplicate-safe delivery, exponential retry scheduling, and pre-due non-reclaim behavior pass; Nest build passed
- **Approval**: not-required

### T086

- **Command**: focused `rag-outbox`, existing `coach-queue`, `coach-module-wiring`, and server build
- **Environment**: local in-memory outbox/mocked BullMQ workers; no Redis/network
- **Version**: knowledge ingestion processor v1
- **Result**: PASS — 3 suites/11 tests; the existing BullMQ architecture is reused, payload parsing permits only job ID/operation/content version/pipeline version, durable metadata mismatches fail closed, completion is exactly-once, terminal/retryable outcomes are persisted, Coach queue behavior remains green, and Nest build passed
- **Approval**: not-required

### T087

- **Command**: AI E2E `knowledge-release knowledge-idempotency knowledge-reembedding` and server build
- **Environment**: local deterministic in-memory ingestion/release fixtures; no Provider/network
- **Version**: knowledge ingestion state machine v1
- **Result**: PASS — 3 suites/6 tests; duplicate stage/activate effects preserve one release/document/chunk/embedding, incomplete embedding sets never become active, failed candidate releases do not hide the old active set, and valid replacement activation supersedes old searchable documents/chunks; Nest build passed
- **Approval**: not-required

### T088

- **Command**: same focused release/re-embedding E2E suite plus server build
- **Environment**: local deterministic state tests; Prisma implementation compile-checked
- **Version**: atomic knowledge release service v1
- **Result**: PASS — READY requires exact nonzero completeness, activation is idempotent and one-per-scope, old active releases/documents/chunks are superseded in the same transaction, source rights are rechecked at activation, and invalid/revoked/deleted candidates cannot be reactivated; Nest build passed
- **Approval**: not-required

### T089

- **Command**: AI E2E `knowledge-retention` and server build
- **Environment**: local synthetic lifecycle/replay fixtures; Prisma coordinator compile-checked
- **Version**: synchronous knowledge invalidation v1
- **Result**: PASS — 1 suite/4 tests; revoke/expire/delete immediately invalidate releases/documents/chunks/embeddings, map citations to stable redacted states, clear affected request replay, and purge physical content only after the configured deadline; Nest build passed
- **Approval**: not-required

### T090

- **Command**: focused `source-change` + `rag-outbox` tests and server build
- **Environment**: local in-memory outbox with synthetic WordBook/Course/Attempt/Summary identifiers; no network
- **Version**: source change mapping v1
- **Result**: PASS — 2 suites/11 tests; UPSERT/REEMBED/DELETE map to idempotent outbox operations for all four record types, private ownership is mandatory and public owner injection is rejected, repeated events collapse, payloads contain no source body, and Nest build passed
- **Approval**: not-required

### T091

- **Command**: AI E2E `knowledge-backfill` against the disposable pgvector database
- **Environment**: loopback-only temporary PostgreSQL/pgvector with one synthetic approved source, allowlisted field policy, and synthetic WordBook row
- **Version**: rag-backfill.v1 / rag-backfill.e2e.v1
- **Result**: PASS — 1 suite/1 test; dry-run reports one change and writes zero jobs, first real run creates one ID/version-only outbox row, second real run reports zero changes, unauthorized count remains zero, and checkpoint returns the final processed record ID
- **Approval**: covered by the user's explicit disposable Docker/pgvector authorization

### T092

- **Command**: AI E2E `coach-retention knowledge-retention rag-private-deletion` against the disposable database and server build
- **Environment**: local mocked retention clocks plus loopback-only PostgreSQL/pgvector private deletion fixtures
- **Version**: COACH_RAG_RETENTION_POLICY v1
- **Result**: PASS — 3 suites/10 tests; replay 1h, reconciliation/private purge 24h, diagnostic content 7d, Trace/feedback 180d are centralized and asserted; private docs/chunks/embeddings/citations are immediately hidden then physically purged while unrelated owners remain intact; Nest build passed
- **Approval**: disposable database covered by the user's explicit authorization

### T093

- **Command**: AI E2E `coach-stream-recovery knowledge-retention` and server build
- **Environment**: local in-memory Redis-stream equivalent and citation→request lookup; no network
- **Version**: Coach replay invalidation v1
- **Result**: PASS — 2 suites/15 tests; affected replay can be removed directly by request ID or resolved from citation IDs, stream/sequence/last/sealed keys share the purge boundary, unrelated request replay remains available, stale excerpts stay absent, and Nest build passed
- **Approval**: not-required

### T094

- **Command**: `jq -s -e` fixture validation and focused `rag-lifecycle.eval.spec.ts`
- **Environment**: local synthetic JSONL lifecycle evaluator; no Provider/network/user data
- **Version**: rag-lifecycle-case.v1
- **Result**: PASS — JSONL structure check and 1 suite/7 tests; duplicate ingestion, content update, deletion, revocation, re-embedding, and partial failure reproduce deterministic release counts/active versions, forbidden stale chunk IDs never reappear, all retrieval versions are fixed, and Provider calls/cost are zero
- **Approval**: not-required

## Phase 8 — US6 test-first evidence

### T095

- **Command**: `pnpm --filter @en/server exec jest --config ./apps/ai/test/jest-e2e.json --runInBand rag-observability`
- **Environment**: local; in-memory Trace repository; synthetic identifiers only
- **Version**: planned `rag-trace.v1`
- **Result**: RED AS EXPECTED — 3 scenarios failed because `CoachTraceService.recordRetrieval` was not implemented
- **Approval**: not-required

### T096

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-redaction`
- **Environment**: local; offline sensitive-canary scan
- **Version**: planned RAG redaction policy v1
- **Result**: RED AS EXPECTED — RAG metadata sanitizer/diagnostic hash were missing and two new private-data canaries were not detected
- **Approval**: not-required

### T097

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-metrics`
- **Environment**: local; deterministic synthetic metric inputs
- **Version**: planned `rag-metrics.v1`
- **Result**: RED AS EXPECTED — `rag-metrics.ts` did not exist
- **Approval**: not-required

### T098

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-cost`
- **Environment**: local; offline versioned synthetic prices
- **Version**: planned `rag-price.v1`
- **Result**: RED AS EXPECTED — aggregate embedding/model meter and unapproved-price rejection were missing
- **Approval**: not-required

### T099

- **Command**: `pnpm --filter @en/server build` and static review of the exhaustive `RetrievalTraceMetadata` fields
- **Environment**: local TypeScript build; no network/database
- **Version**: `rag-trace.v1`
- **Result**: PASS — build succeeded; metadata defines stage counts, fixed versions, rankings, decisions, citation/claim links and safe failure codes without an index signature or raw identity/query/document/secret fields
- **Approval**: not-required

### T101

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-redaction coach-redaction`
- **Environment**: local; offline allowlist and synthetic sensitive-canary scans
- **Version**: RAG redaction policy v1 / `rag-trace.v1`
- **Result**: PASS — 2 suites/21 tests; unknown diagnostic body fields are dropped, approved diagnostics use stable HMAC aliases, and JWT/API key/database URL/system Prompt/reasoning/private content/raw identity/cross-user canary/answer key/stack do not survive
- **Approval**: not-required

### T100

- **Command**: `pnpm --filter @en/server exec jest --config ./apps/ai/test/jest-e2e.json --runInBand rag-observability coach-observability` and `pnpm --filter @en/server build`
- **Environment**: local in-memory Trace/feedback repository plus Prisma compile check; synthetic identifiers only
- **Version**: `rag-trace.v1` / Coach Trace persistence v1
- **Result**: PASS — 2 suites/10 tests and Nest build; success/insufficient/failed requests each retain one Coach traceId, stage counts/versions/rankings/timing/tokens/claims are queryable, used and unused citations remain distinct, and feedback is linked without exposing trace subject identity
- **Approval**: not-required

### T102

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-case.schema rag-personalization.eval rag-degradation.eval rag-lifecycle.eval`
- **Environment**: local deterministic JSONL/schema validation; synthetic data only
- **Version**: `rag-eval-case.v1` plus story fixture compatibility contracts
- **Result**: PASS — 4 suites/19 tests; all 22 US2/US3/US5 RAG fixtures validate, lifecycle cases now carry dataset/allowed/forbidden fields, and missing component versions, allowed sources, forbidden sources, or judgement method fail schema validation
- **Approval**: not-required

### T103

- **Command**: `jq -s -e 'length == 20' server/apps/ai/test/evals/fixtures/rag-cases.jsonl` and `pnpm --filter @en/server test -- --runInBand rag-cases rag-case.schema`
- **Environment**: local deterministic synthetic dataset; no learner/provider data
- **Version**: `rag-eval.synthetic.v1` / `rag-eval-case.v1`
- **Result**: PASS — JSONL contains 20 valid cases and 2 suites/8 tests prove complete unique coverage for word meaning, phonetics/forms, examples/collocations, grammar, course, CEFR, private errors/summaries, empty/low/wrong/conflict cases, injection/cross-user/fabrication, update/delete/re-embedding, latency, tokens and cost
- **Approval**: not-required

### T104

- **Command**: `jq -e . server/apps/ai/test/evals/rubrics/rag-quality.json` and `pnpm --filter @en/server test -- --runInBand rag-rubric`
- **Environment**: local immutable rubric loader; no reviewer identity/private content
- **Version**: `rag-quality.v1`
- **Result**: PASS — JSON valid and 1 test passed; relevance, citation support, faithfulness and conflict anchors define all 0–3 boundaries, reviewer identity/private content are prohibited, disputes preserve evidence and are excluded until review, and the loaded rubric is deeply frozen
- **Approval**: not-required

### T105

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-metrics`
- **Environment**: local deterministic synthetic measurements
- **Version**: `rag-metrics.v1`
- **Result**: PASS — 1 suite/2 tests; exact Recall@K, Precision@K, MRR, citation accuracy/coverage, faithfulness, unsourced rate, first/final schema rates, leakage/injection rates and nearest-rank P50/P95/max are reproducible; empty denominators are null, expected empty recall is separate, disputed claims are excluded and units/definitions are emitted
- **Approval**: not-required

### T106

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-report coach-eval-runner`
- **Environment**: local deterministic report generation; synthetic measurements
- **Version**: `coach-eval-report.v1` with `rag-metrics.v1`
- **Result**: PASS — 2 suites/17 tests; complete RAG reports bind source-rights, dataset, Prompt, model, Embedding, Chunk, index, retrieval, Schema, rubric and price versions and include quality/safety/latency/token/cost evidence; every missing version and absent RAG metrics produce `incomplete`
- **Approval**: not-required

### T107

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-release-gate coach-eval-runner`
- **Environment**: local deterministic gate injection tests
- **Version**: RAG zero-tolerance gate v1
- **Result**: PASS — 2 suites/15 tests; singleton auth, cross-user, injection, identity override, fabricated citation, unsourced citation, stale citation and Schema bypass failures each block release despite perfect aggregate quality; incomplete reports also block independently
- **Approval**: not-required

### T108

- **Command**: `pnpm --filter @en/server test -- --runInBand rag-cost coach-foundation coach-config` and `pnpm --filter @en/server build`
- **Environment**: local synthetic price catalog; no Provider/network
- **Version**: `rag-price.v1` aggregate cost meter
- **Result**: PASS — 3 suites/15 tests and Nest build; estimated/actual modes meter Embedding and model tokens separately, enforce one version and request budget, reject unknown or explicitly unapproved prices before returning cost, and preserve existing Coach governance behavior
- **Approval**: not-required; live Provider remains unapproved

### T109

- **Command**: focused `rag-run coach-eval-runner` tests, Nest build, then `pnpm --filter @en/server exec tsx apps/ai/test/evals/run.ts --mode deterministic --dataset rag-eval.synthetic.v1 --output /private/tmp/en-learning-plus-rag-eval-report.json` with a `jq` completeness/count assertion
- **Environment**: local deterministic mode; TSX required a sandbox-external local IPC pipe; report written only under `/private/tmp`; no Provider/network
- **Version**: `rag-eval.synthetic.v1` / deterministic runner v1
- **Result**: PASS — 2 suites/9 tests, build, and CLI report assertion; repeated deterministic runs are identical, output is atomically renamed, live mode rejects absent/incomplete approval and credentials before adapter invocation, and stops immediately on approved budget overflow
- **Approval**: local IPC escalation approved; live Provider remains unapproved and was not called

### T110

- **Command**: baseline `jq` assertion; focused `rag-trace-linker coach-eval-runner`; US6 aggregate 11 suites/63 unit-eval tests, RAG observability E2E 3/3, and Nest build
- **Environment**: local deterministic/in-memory execution; synthetic opaque links; no Provider/network
- **Version**: RAG eval trace linkage v1 / `rag-baseline.v1`
- **Result**: PASS — every link binds case→one Coach Trace/request→retrieval used/unused citations→claim citation paths→feedback; fabricated claim links fail; baseline is explicitly `pending_measurement` and unapproved, so release gate remains closed; runtime RAG tool output also records allowlisted metadata into the active Coach Trace step
- **Approval**: not-required; candidate baseline remains unapproved

## Phase 9 — Cross-cutting validation

### T111

- **Command**: SHA-256 all five shared/RAG artifacts before generation, run `generate-contracts.ts` twice, SHA-256 after each run, `jq empty` on both RAG JSON schemas and JSON-syntax OpenAPI, server build, Web type-check
- **Environment**: local generation/static checks; TSX used approved local IPC only
- **Version**: shared Coach v1 plus `coach.tool.v2` / `coach.result.v2` artifacts
- **Result**: PASS — all five hashes remained byte-identical across both generations (`025ef0…`, `ebdf14…`, `0185d9…`, `532084…`, `396f60…` respectively); all contracts parsed, Nest build succeeded, and Vue type-check succeeded
- **Approval**: local TSX IPC approved; no dependency/config/production action

### T112

- **Command**: `pnpm --filter @en/server exec jest --runInBand`; then full AI E2E with `NODE_OPTIONS='--experimental-vm-modules'`, the approved disposable `RAG_TEST_DATABASE_URL`, and `jest --config ./apps/ai/test/jest-e2e.json --runInBand`
- **Environment**: local full unit/contract/integration suite plus loopback-only disposable pgvector E2E; synthetic fixtures
- **Version**: complete server/AI/Learning test corpus at implementation checkpoint
- **Result**: PASS — final rerun passed 77 unit/contract suites, 353 tests and one snapshot; 24 AI E2E suites, 83 tests. The additional cases cover concrete Nest RAG wiring, live `coach.result.v2` generation, executor validation/persistence, non-knowledge branch v2 migration, actual used/unused claim Trace linkage and replay-safe Citation caching. Existing auth/session/cancellation/retry/exercise/grading/learning writes and all RAG paths are green
- **Approval**: disposable database covered by the user's explicit authorization

### T113

- **Command**: `pnpm --filter @en/web test:unit -- coach`; `pnpm exec playwright test coach-streaming`; `pnpm exec playwright test coach-environment`
- **Environment**: local Vitest/jsdom plus local Vite/Chromium synthetic E2E; no backend production services
- **Version**: current Web Coach v1/v2 dual-read UI
- **Result**: PASS — final rerun passed 9 Vue test files/38 tests, Vue type-check, 7 streaming browser tests, and 1 environment-isolation browser test. Active/unavailable citations, grouping/claim links, controlled open, replay, cancellation, retry, timeout/budget and saved learning state passed. Expected tracker proxy connection refusals were non-blocking because no analytics backend was started
- **Approval**: local Playwright server execution approved; no deploy

### T114

- **Command**: fresh disposable database creation; Prisma migration deploy twice; fresh-db `rag-schema`; `knowledge-backfill`; synthetic REVOKED/INVALID seed; container-local `pg_dump -Fc` and `pg_restore`; source/restored state comparison; flags-off server/Web focused regressions
- **Environment**: two isolated databases in the approved local tmpfs pgvector container; synthetic records only
- **Version**: all five migrations / `20260908000000_rag_knowledge` / rollback rehearsal v1
- **Result**: PASS — first deploy applied five migrations, second had none pending, fresh migration had zero ACTIVE releases, repeated backfill stayed idempotent, backup restored successfully, and source/restored counts matched `5|1|1|0|1|1` (migrations/jobs/releases/active/invalid/revoked). Default-off legacy Coach tests passed and revoked/invalid state was not reactivated. Full details are in `rollback-report.md`
- **Approval**: disposable Docker/database operations covered by explicit user authorization; no destructive production rollback

### T115

- **Command**: seed 5,000 synthetic public Chunk/READY 8d vectors; `ANALYZE`; exact permission-first `EXPLAIN (ANALYZE, BUFFERS)`; 30 repeated query timings; database/extension version query
- **Environment**: disposable loopback PostgreSQL 17.11 / pgvector 0.8.6 on aarch64 tmpfs; deterministic synthetic corpus
- **Version**: `exact-cosine.v1` / `embedding.fake.8d.v1` / `retrieval.exact.v1`
- **Result**: PASS — 5,000 total rows, 1,000 relational/relevance eligible, 20 returned, no unauthorized rows; plan execution 3.750 ms with 3,192 shared hits and indexed relation/embedding filters; 30 runs min/P50/P95/max = 2.898/2.983/9.877/19.915 ms. `exact-search-baseline.md` records that these are not production targets and the decision remains no HNSW without paired recall/latency evidence
- **Approval**: synthetic disposable performance test covered by explicit database authorization; no dependency/index/config change

### T116

- **Command**: count unique requirement table rows; inspect duplicate IDs; `rg` knowledge retrieval/AI knowledge trees for retrieval cache; inspect manifests/lockfile for independent vector DB, crawler and MCP-server dependencies
- **Environment**: local documentation/source/dependency audit
- **Version**: specification FR-001–FR-084 / SC-001–SC-018
- **Result**: PASS — traceability contains exactly 84 unique FR rows and 18 unique SC rows; every row names executable verification and implementation/evidence tasks. Scope guard found no retrieval cache, crawler, independent vector database or MCP-server addition. Playwright matches are the pre-existing browser test dependency, not an application crawler. Rights/access/non-goal evidence is explicitly summarized; orphan requirements and unexplained deviations are zero
- **Approval**: not-required

### T117

- **Command**: production/dependency path `git diff --exit-code`; SHA-256 package manifest/lock snapshot; `pnpm why` existing Prisma/BullMQ/LangChain dependencies; scan quickstart for stale Plan/future-implementation commands
- **Environment**: local source/dependency/documentation guard; no environment file contents read
- **Version**: final implementation quickstart and known-gates record
- **Result**: PASS — scoped git diff is empty; existing dependencies resolve to Prisma adapter 7.6.0, BullMQ 5.76.2 and LangChain core 1.1.39; no stale commands remain. Because the checkout began entirely untracked, quickstart explicitly records that limitation plus final manifest hashes, and states no manifest/lock/production config edit, no production flag change, no push and no deployment. Reproducible deterministic/live-fail-closed/full-regression commands and all pending approvals are documented
- **Approval**: not-required; production configuration/push/deploy remain unauthorized

## Post-completion runtime audit

- **Task links**: strengthens T038–T043, T077, T100, T112, T113 and T117; no new scope or task IDs were introduced
- **Command**: focused RAG Prompt/security/module/runtime/executor/replay tests; full server Jest; full disposable-pgvector AI E2E; deterministic RAG metric suite and CLI report; Web Coach unit/type checks; Playwright Coach regressions; Nest build; dependency/config hash and scoped-diff guard
- **Environment**: local Node v24.18.0/pnpm 10.32.1; synthetic data; approved disposable PostgreSQL 17.11 + pgvector 0.8.6; no live model/Embedding Provider
- **Version**: `coach.tool.v2`, `coach.result.v2`, `rag-trace.v1`, `rag-eval.synthetic.v1`
- **Result**: PASS — final audit closed two integration gaps: the concrete RAG search implementation is now injected through existing Nest modules, and enabled requests consistently write v2 while answer/correction requests keep Citation IDs through strict model output and final persistence/SSE projection. Redis replay stores no Citation source/title/excerpt/access details; authenticated reads re-resolve opaque IDs. The runtime context fallback uses a conservative UTF-8-byte upper bound and remains ineligible for production enablement without an approved model counter/baseline. Full results: server 77 suites/353 tests; AI E2E 24 suites/83 tests; RAG metrics 8 suites/40 tests plus 20-case deterministic CLI report with 0 deterministic/security failures; Web 9 files/38 tests plus type-check; Playwright 8/8; Nest build passed
- **Approval**: Docker/database and local browser/TSX IPC were within explicit or prompted local-test approval; no dependency, production configuration, live Provider, commit, push or deployment action occurred
- **Hooks**: `.specify/extensions.yml` is absent, so there were no extension hooks to run
