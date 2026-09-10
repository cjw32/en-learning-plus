# Requirements Traceability Audit

**Feature**: `002-rag-source-citations`  
**Audit date**: 2026-09-08  
**Scope**: FR-001–FR-084, SC-001–SC-018, data rights/access boundaries and explicit non-goals

Every row maps one requirement to executable verification and at least one implementation/evidence task. `implementation-evidence.md` contains the observed command/result for completed task IDs.

## Functional requirements

| Requirement | Primary verification | Implementation/evidence tasks | Status |
|---|---|---|---|
| FR-001 | `coach-runtime`, full server/AI regression | T023, T112 | Covered |
| FR-002 | `public-source-adapters`, `rag-cases` | T025, T032, T103 | Covered |
| FR-003 | `rag-source-rights`, knowledge schema | T008, T015 | Covered |
| FR-004 | `rag-source-rights` fail-closed cases | T008, T015 | Covered |
| FR-005 | source-rights and scope/diff audit | T015, T117 | Covered |
| FR-006 | public adapters and degradation eval | T025, T066 | Covered |
| FR-007 | private projection tests | T044, T050 | Covered |
| FR-008 | private summary/projection tests | T044, T050 | Covered |
| FR-009 | `rag-access` SQL isolation | T045, T052 | Covered |
| FR-010 | scope guard audit below | T116, T117 | Covered |
| FR-011 | `rag-schema` plus rollback rehearsal | T007, T013, T114 | Covered |
| FR-012 | knowledge domain and citation resolver | T014, T069 | Covered |
| FR-013 | migration/schema and domain invariants | T007, T014 | Covered |
| FR-014 | chunk/version and re-embedding tests | T025, T083, T088 | Covered |
| FR-015 | access and private ownership tests | T045, T052 | Covered |
| FR-016 | public word chunker tests | T025, T032 | Covered |
| FR-017 | course source/chunker tests | T026, T032 | Covered |
| FR-018 | grammar source/chunker tests | T025, T032 | Covered |
| FR-019 | wrong-answer/private projection tests | T044, T050 | Covered |
| FR-020 | summary boundary/projection tests | T050, T051 | Covered |
| FR-021 | `rag-content-validator` | T009, T016 | Covered |
| FR-022 | ingestion idempotency E2E | T081, T087 | Covered |
| FR-023 | release/update E2E | T082, T086, T088 | Covered |
| FR-024 | lifecycle/retention E2E | T084, T089, T092 | Covered |
| FR-025 | re-embedding E2E | T083, T088 | Covered |
| FR-026 | partial release failure E2E/eval | T082, T086, T094 | Covered |
| FR-027 | v2 tool contract and exact retrieval | T024, T035 | Covered |
| FR-028 | config and bounded contract tests | T006, T024 | Covered |
| FR-029 | authenticated access integration | T045, T052 | Covered |
| FR-030 | personalization/missing-signal eval | T046, T053 | Covered |
| FR-031 | deterministic ranking/dedup tests | T027, T036 | Covered |
| FR-032 | retrieval SQL status/version filters | T026, T035 | Covered |
| FR-033 | conflict detector/context tests | T027, T037 | Covered |
| FR-034 | degradation status tests/eval | T057, T062, T066 | Covered |
| FR-035 | context/citation boundary tests | T028, T038 | Covered |
| FR-036 | context Token budget tests | T028, T038 | Covered |
| FR-037 | prompt-injection/context delimiter tests | T059, T060 | Covered |
| FR-038 | ranking contract and Trace E2E | T024, T095, T100 | Covered |
| FR-039 | exact cosine measured baseline | T115 | Covered |
| FR-040 | no-cache scope audit and access tests | T045, T116, T117 | Covered |
| FR-041 | v2 search contract tests | T024, T029 | Covered |
| FR-042 | applied-filter contract tests | T024, T029 | Covered |
| FR-043 | retrieval-result contract tests | T024, T029 | Covered |
| FR-044 | rank/score tests | T024, T027, T036 | Covered |
| FR-045 | excerpt/context validation tests | T028, T038 | Covered |
| FR-046 | outcome/degradation tests | T057, T062 | Covered |
| FR-047 | context gate tests | T028, T038 | Covered |
| FR-048 | contract generation and module regression | T030, T043, T111 | Covered |
| FR-049 | `coach.result.v2` contract tests | T067, T071 | Covered |
| FR-050 | forged citation/injection tests | T059, T064 | Covered |
| FR-051 | grounded-claim contract tests | T067, T071 | Covered |
| FR-052 | claim support validation tests | T059, T060, T067 | Covered |
| FR-053 | citation dedup/claim-link tests | T067, T071, T079 | Covered |
| FR-054 | final citation validation/repair tests | T059, T064 | Covered |
| FR-055 | insufficient degradation tests/eval | T057, T062, T066 | Covered |
| FR-056 | failure/cancellation fallback E2E | T058, T065, T112 | Covered |
| FR-057 | personalization request/eval tests | T046, T053, T056 | Covered |
| FR-058 | Citation card/API/browser tests | T074, T078, T080 | Covered |
| FR-059 | citation history/invalidation tests | T068, T077, T093 | Covered |
| FR-060 | authenticated context/access tests | T045, T052 | Covered |
| FR-061 | public/private/course access E2E | T045, T052 | Covered |
| FR-062 | retrieval and citation reauthorization E2E | T045, T069 | Covered |
| FR-063 | cross-user filter/citation tests | T045, T052, T069 | Covered |
| FR-064 | content validator tests | T009, T016 | Covered |
| FR-065 | injection authority tests | T059, T060 | Covered |
| FR-066 | embedding gateway payload tests | T010, T018 | Covered |
| FR-067 | access/redaction scans | T045, T096, T101 | Covered |
| FR-068 | Coach/RAG redaction scans | T096, T101 | Covered |
| FR-069 | private deletion and retention E2E | T084, T092 | Covered |
| FR-070 | source invalidation/lifecycle E2E | T084, T089, T094 | Covered |
| FR-071 | retention and diagnostic redaction tests | T092, T101 | Covered |
| FR-072 | versioned synthetic eval schema/dataset | T102, T103 | Covered |
| FR-073 | centralized retention policy/audit | T092, T117 | Covered |
| FR-074 | RAG observability E2E | T095, T099, T100 | Covered |
| FR-075 | monotonic stage-count Trace assertions | T095, T099, T100 | Covered |
| FR-076 | Trace/citation/claim/feedback linker tests | T095, T100, T110 | Covered |
| FR-077 | 20-category RAG dataset coverage | T103 | Covered |
| FR-078 | RAG case/expected schema tests | T102, T103 | Covered |
| FR-079 | exact metric tests/report | T097, T105, T106 | Covered |
| FR-080 | fixed immutable rubric tests | T104 | Covered |
| FR-081 | singleton zero-tolerance gate tests | T107 | Covered |
| FR-082 | pending baseline/report/performance evidence | T106, T110, T115 | Covered |
| FR-083 | full unit/E2E/browser regression | T112, T113 | Covered |
| FR-084 | complete-version report and closed gate | T106, T107, T110 | Covered |

## Success criteria

| Criterion | Primary verification | Implementation/evidence tasks | Status |
|---|---|---|---|
| SC-001 | rights policy and zero-auto-active migration | T015, T114 | Covered |
| SC-002 | ingestion/backfill idempotency | T081, T087, T091, T114 | Covered |
| SC-003 | update/delete/revoke/re-embedding lifecycle | T082–T084, T088–T094 | Covered |
| SC-004 | source adapters plus explicit insufficiency | T025, T032, T066, T103 | Covered |
| SC-005 | contract/filter/access integration | T024, T045, T052 | Covered |
| SC-006 | context eligibility/budget/conflict tests | T028, T037, T038 | Covered |
| SC-007 | citation issue/validation/resolution tests | T059, T064, T067–T077 | Covered |
| SC-008 | degradation E2E/eval | T057, T062, T066 | Covered |
| SC-009 | cross-user access/redaction tests | T045, T052, T096 | Covered |
| SC-010 | injection/context/redaction tests | T059, T060, T096 | Covered |
| SC-011 | generated contract/schema regression | T030, T067, T072, T111 | Covered |
| SC-012 | RAG Trace/redaction/linkage tests | T095, T096, T100, T101, T110 | Covered |
| SC-013 | deterministic context budget tests | T028, T038 | Covered |
| SC-014 | Vue Citation/API/Playwright regression | T074–T080, T113 | Covered |
| SC-015 | main eval set, metrics and report | T097, T103–T106, T115 | Covered |
| SC-016 | pending baseline and zero-tolerance gate | T107, T110, T115 | Covered |
| SC-017 | failure/cancel/default-off/rollback tests | T058, T065, T112, T114 | Covered |
| SC-018 | full server/Web/browser regression | T112, T113 | Covered |

## Rights, access and scope guards

| Guard | Evidence | Result |
|---|---|---|
| Every active source requires explicit verified rights/use flags | `rag-source-rights`, migration checks, release service | PASS |
| Private ownership derives from authenticated server records | `rag-access`, private projection, citation resolver | PASS |
| Course access is reauthorized at retrieval and citation open | access and resolver E2E | PASS |
| No retrieval cache was introduced | knowledge retrieval tree and dependency/diff audit | PASS |
| No internet crawler or unapproved corpus was introduced | source adapters are project records; fixtures are synthetic | PASS |
| No knowledge-management admin UI was introduced | changed Web scope is Coach Citation display/API only | PASS |
| No multi-Agent workflow was introduced | existing controlled Coach workflow retained | PASS |
| No MCP server was introduced | repository scope/dependency audit | PASS |
| No independent vector database was introduced | PostgreSQL/pgvector migration and Prisma repository only | PASS |

## Audit conclusion

- Functional requirements present: 84/84.
- Success criteria present: 18/18.
- Requirements without a test mapping: 0.
- Requirements without an implementation/evidence task: 0.
- Unexplained deviations: 0.
- Production enablement remains outside this implementation. The RAG baseline is `pending_measurement`, production flags were not changed, and no push/deploy occurred.
