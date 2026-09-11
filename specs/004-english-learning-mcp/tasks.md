# Tasks: English Learning MCP Integration

**Input**: Design documents in `/Users/woofeel/Downloads/en-learning-plus/specs/004-english-learning-mcp/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Scope rule**: This task list describes future implementation work only. Generating this file does not authorize dependency installation, production configuration changes, deployment, or pushing commits.

**Requirement notation**: `FR-*` and `SC-*` refer to `/Users/woofeel/Downloads/en-learning-plus/specs/004-english-learning-mcp/spec.md`; `PLAN-*` refers to the named design decision or section in `plan.md`, `research.md`, `data-model.md`, or `contracts/`.

**Task format**: Every checklist item includes an exact repository-relative path, requirement links, and a concrete verification method. `[P]` means the task can proceed in parallel after its phase prerequisites are met. User-story tasks carry `[USn]`.

## Authorization gates

- **GATE-A — New MCP packages**: Do not execute dependency task T004 until the user explicitly authorizes adding `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, and test-only `@modelcontextprotocol/client`.
- **GATE-B — External authorization server**: Production issuer, client registration, secrets, and network integration require separate explicit authorization; local work must use ports and fakes.
- **GATE-C — Production configuration**: No task in this plan authorizes editing production values, enabling production feature gates, or changing deployment infrastructure.
- **GATE-D — Source rights and retention**: Production ingestion/serving rights, diagnostic retention, and 180-day metadata retention require owner approval before the relevant release gate can pass.
- **GATE-E — Client baselines and release claims**: Quality, latency, token, cost, cancellation, and compatibility thresholds become release claims only after the user approves recorded baselines.

## Phase 1: Setup and evidence baseline

**Purpose**: Establish traceability, approval boundaries, contract generation, and a reproducible pre-change baseline without altering production behavior.

- [x] T001 Capture the untouched MCP and non-MCP baseline, including exact commands, commit SHA, environment, failures, and timing, in `specs/004-english-learning-mcp/evidence/baseline.md`; Requirements: SC-015, PLAN-Regression; Verify: run `pnpm --filter @en/server build`, representative existing AI/learning Jest suites, `pnpm --filter @en/web type-check`, and `pnpm --filter @en/web test:unit`, then confirm every result and pre-existing failure is recorded with exit status.
- [x] T002 [P] Create the requirement-to-task-and-test traceability table in `specs/004-english-learning-mcp/traceability.md`; Requirements: FR-001–FR-060, SC-001–SC-016; Verify: a script or manual audit confirms every FR and SC appears at least once and each row names an implementation path plus a verification artifact.
- [x] T003 [P] Record the official MCP SDK v2 compatibility decision, pinned versions, protocol dates, transport APIs, known client deviations, and security review in `specs/004-english-learning-mcp/evidence/sdk-compatibility.md`; Requirements: FR-001–FR-009, FR-052, PLAN-DualProtocol; Verify: the document maps every used SDK API to official release documentation and contains no implementation assumption without a cited source or test plan.
- [x] T004 Add the explicitly approved MCP runtime packages to `server/package.json`, the test-only client package to the appropriate development section, and the resolved versions to `pnpm-lock.yaml`; Requirements: FR-001–FR-009, PLAN-OfficialSDK; Verify: only after GATE-A approval, `pnpm install --lockfile-only` succeeds and `git diff -- server/package.json pnpm-lock.yaml` shows only the approved packages and transitive lock changes; otherwise leave this task pending.
- [x] T005 [P] Create the MCP public-contract package entry points and version constants in `packages/common/mcp/index.ts`, `packages/common/mcp/protocol-versions.ts`, and `packages/common/index.ts`; Requirements: FR-001, FR-039–FR-043; Verify: because the pre-existing `@en/common` package is source-only and has no build lifecycle, its exports were verified with a direct TypeScript no-emit compile, `pnpm --filter @en/server build`, and a temporary `@en/common/mcp` import without adding runtime behavior or dependencies.
- [x] T006 [P] Add a generated-schema drift test in `server/apps/ai/test/contract/mcp-schema-drift.contract.spec.ts` targeting `specs/004-english-learning-mcp/contracts/mcp-capabilities.schema.json`; Requirements: FR-008, FR-039–FR-043, SC-004; Verify: the test initially reports missing generators, and later passes only when checked-in schemas exactly match deterministic Zod output.
- [x] T007 [P] Create the disabled-by-default MCP module shell in `server/apps/ai/src/mcp/mcp.module.ts` and export surface in `server/apps/ai/src/mcp/index.ts`; Requirements: FR-001, FR-044, PLAN-DefaultOff; Verify: `pnpm --filter @en/server build` passes and starting the AI app with all MCP gates false exposes no MCP route.
- [x] T008 [P] Add reusable fake issuer, fake clock, fake MCP clients, seeded users, and fixture factories in `server/apps/ai/test/mcp/fixtures/mcp-test-environment.ts`; Requirements: FR-031–FR-038, FR-052–FR-060; Verify: a fixture smoke test creates two isolated users, distinct subjects/clients/scopes, deterministic time, and both protocol-era client stubs without external network access.

**Checkpoint**: Baseline and authorization gates are explicit; no production surface is enabled.

---

## Phase 2: Foundational MCP contracts, identity, persistence, and governance

**Purpose**: Build the prerequisites shared by all user stories. No story implementation starts until these tasks pass.

### Tests first

- [x] T009 [P] Add strict public schema tests for initialize, capabilities, resources, tools, prompts, errors, pagination, provenance, and confirmation payloads in `server/apps/ai/test/contract/mcp-common-schemas.contract.spec.ts`; Requirements: FR-006–FR-009, FR-039–FR-043, SC-004; Verify: unknown keys, oversized strings, excessive depth, invalid IDs, and invalid cursors are rejected before business services run.
- [x] T010 [P] Add default-off and configuration-boundary tests in `server/apps/ai/test/governance/mcp-config.spec.ts`; Requirements: FR-044–FR-047, PLAN-FeatureGates; Verify: global, read, RAG, quiz, confirmation, and submit gates default false and invalid limits/deadlines/retention values prevent application bootstrap.
- [x] T011 [P] Add Prisma model and invariant tests in `server/apps/ai/test/integration/mcp-persistence-schema.integration.spec.ts`; Requirements: FR-035–FR-038, FR-046–FR-051, data-model; Verify: unique keys, foreign keys, expiry fields, confirmation states, idempotency hashes, trace relationships, and `CoachConversation.origin` constraints are asserted against an isolated database.
- [x] T012 [P] Add immutable identity-context and token-verifier port tests in `server/apps/ai/test/security/mcp-auth-context.spec.ts`; Requirements: FR-031–FR-038, SC-002–SC-003; Verify: issuer/subject/user/client/scope cannot be mutated after construction and malformed, expired, not-yet-valid, wrong-audience, revoked, or ordinary web JWTs fail before repositories or model adapters are called.
- [x] T013 [P] Add admission, quota, lease, deadline, cancellation, recursion, size, and depth tests in `server/apps/ai/test/governance/mcp-admission.spec.ts`; Requirements: FR-044–FR-047, SC-012; Verify: each network/subject/client/subject-client/capability limit is isolated under the `mcp:*` namespace and cancellation causes zero new downstream steps after abort.
- [x] T014 [P] Add redaction, safe-error, correlation, and trace-minimization tests in `server/apps/ai/test/security/mcp-observability.spec.ts`; Requirements: FR-048–FR-051, SC-011; Verify: seeded access tokens, refresh tokens, secrets, private prompt text, model reasoning, and raw learner content never appear in logs, traces, errors, or serialized diagnostics.

### Shared implementation

- [x] T015 Implement strict Zod schemas and safe public error types in `packages/common/mcp/schemas.ts`, `packages/common/mcp/errors.ts`, and `packages/common/mcp/index.ts`; Requirements: FR-006–FR-009, FR-039–FR-043; Verify: T009 passes and TypeScript rejects handlers that omit required provenance, pagination, or structured-result fields.
- [x] T016 Implement deterministic JSON Schema generation in `packages/common/mcp/generate-json-schema.ts` and wire the checked-in output in `specs/004-english-learning-mcp/contracts/mcp-capabilities.schema.json`; Requirements: FR-008, FR-039–FR-043, SC-004; Verify: two consecutive generations are byte-identical and T006 passes with a clean git diff after the second run.
- [x] T017 Implement typed, disabled-by-default MCP configuration in `server/apps/ai/src/mcp/config/mcp.config.ts` and `server/apps/ai/src/mcp/config/mcp-config.schema.ts`; Requirements: FR-044–FR-047, PLAN-FeatureGates; Verify: T010 passes and no production configuration file is changed.
- [x] T018 Add `McpSubjectMapping`, `McpClientAuthorization`, `McpInvocation`, `McpIdempotencyIntent`, `McpWriteConfirmation`, `McpTrace`, `McpTraceStep`, and `CoachConversation.origin` to `server/prisma/schema.prisma`; Requirements: FR-035–FR-038, FR-046–FR-051, data-model; Verify: `pnpm --dir server exec prisma validate` passes and every ownership/idempotency/state-machine invariant from `data-model.md` has a database representation.
- [x] T019 Create the additive migration in `server/prisma/migrations/20260911000000_english_learning_mcp/migration.sql`; Requirements: FR-035–FR-038, FR-046–FR-051, SC-009, SC-011; Verify: migrate an empty database and a representative pre-feature database forward, inspect indexes/constraints, and confirm no existing row is deleted or reinterpreted.
- [x] T020 Regenerate the Prisma client in `server/libs/shared/src/generated/prisma/` from `server/prisma/schema.prisma`; Requirements: FR-035–FR-038, data-model; Verify: `pnpm --dir server exec prisma generate`, `pnpm --filter @en/server build`, and T011 pass without manually editing generated files.
- [x] T021 [P] Implement MCP persistence repositories in `server/apps/ai/src/mcp/persistence/mcp-subject.repository.ts`, `server/apps/ai/src/mcp/persistence/mcp-authorization.repository.ts`, `server/apps/ai/src/mcp/persistence/mcp-invocation.repository.ts`, and `server/apps/ai/src/mcp/persistence/mcp-trace.repository.ts`; Requirements: FR-035–FR-038, FR-048–FR-051; Verify: integration tests prove every query is anchored to immutable issuer/subject/user/client context and cannot read another fixture user's rows.
- [x] T022 [P] Implement the verifier port, immutable principal/request context, and local fake adapter in `server/apps/ai/src/mcp/auth/mcp-access-token-verifier.ts`, `server/apps/ai/src/mcp/auth/mcp-principal.ts`, and `server/apps/ai/src/mcp/auth/fake-mcp-access-token-verifier.ts`; Requirements: FR-031–FR-038, SC-002–SC-003; Verify: T012 passes using only the fake adapter and no external issuer, secret, or network call.
- [x] T023 [P] Implement shared admission, Redis namespacing, budgets, deadlines, cancellation propagation, and bounded input/result guards in `server/apps/ai/src/mcp/governance/mcp-admission.service.ts`, `server/apps/ai/src/mcp/governance/mcp-budget.ts`, and `server/apps/ai/src/mcp/governance/mcp-deadline.ts`; Requirements: FR-044–FR-047, SC-012, PLAN-Deadlines; Verify: T013 passes for 2s discovery, 3s reads, 5s RAG/report, 30s model/write, 256KiB structured results, 64KiB text resources, depth 6, and recursion 0.
- [x] T024 [P] Implement correlation-safe structured tracing, hashing/redaction, and public failure mapping in `server/apps/ai/src/mcp/observability/mcp-trace.service.ts`, `server/apps/ai/src/mcp/observability/mcp-redaction.ts`, and `server/apps/ai/src/mcp/errors/mcp-error-mapper.ts`; Requirements: FR-048–FR-051, SC-011; Verify: T014 passes and a trace can join protocol/auth/governance/business/model stages without persisting raw tokens, internal prompts, chain-of-thought, or unauthorized learner content.
- [x] T025 [P] Implement the generic intent-hash/idempotency state machine in `server/apps/ai/src/mcp/idempotency/mcp-idempotency.service.ts` and `server/apps/ai/src/mcp/persistence/mcp-idempotency.repository.ts`; Requirements: FR-023–FR-026, FR-046–FR-047, SC-009; Verify: isolated repository tests show same-key/same-input replay, same-key/different-input conflict, one active claimant, expiry handling, and recoverable incomplete state.
- [x] T026 [P] Refactor learning-account deletion to a collaborator registry in `server/libs/learning/src/privacy/learning-data-deletion.service.ts` and define the cleanup port in `server/libs/learning/src/privacy/learning-data-cleanup.port.ts`; Requirements: FR-038, FR-050–FR-051; Verify: existing deletion tests remain green and a fake cleanup collaborator is called exactly once inside the established account-deletion flow.
- [x] T027 Wire repositories, configuration, auth ports, governance, tracing, and cleanup ports into the inert module in `server/apps/ai/src/mcp/mcp.module.ts` and `server/apps/ai/src/ai.module.ts`; Requirements: FR-001, FR-031–FR-051; Verify: server build and foundational tests T009–T014 pass while `/ai/v1/mcp` remains absent when the global gate is false.

**Checkpoint**: Shared contracts, persistence, identity, governance, and observability are testable; no user story depends on ordinary web JWT identity.

---

## Phase 3: User Story 1 — Secure connection and capability discovery (Priority: P1) 🎯 Protocol MVP

**Goal**: An authorized client can connect at one URL, negotiate either supported protocol era, and discover only capabilities allowed by protocol, declared client features, scopes, and feature gates.

**Independent test**: With seeded fake-issuer tokens, exercise `2026-07-28` stateless POST and `2025-11-25` initialized session POST/GET/DELETE at `/ai/v1/mcp`; verify exact capability matrices, pre-initialize failures, revocation, challenge metadata, raw MCP envelopes, and zero business/model calls on denial.

### Tests first

- [x] T028 [P] [US1] Add the modern stateless protocol contract suite in `server/apps/ai/test/contract/mcp-modern-transport.contract.spec.ts`; Requirements: FR-001–FR-009, SC-001; Verify: POST initialize/discovery succeeds for `2026-07-28`, GET/DELETE are rejected as specified, unknown versions fail safely, and all response envelopes match official SDK v2 schemas.
- [x] T029 [P] [US1] Add the legacy initialized-session contract suite in `server/apps/ai/test/contract/mcp-legacy-transport.contract.spec.ts`; Requirements: FR-001–FR-009, SC-001; Verify: `2025-11-25` enforces pre-initialize gating, creates an opaque bound session, supports POST/GET/DELETE, and expires at idle 15 minutes or `min(token expiry, 1 hour)`.
- [x] T030 [P] [US1] Add OAuth/OIDC resource-server security tests in `server/apps/ai/test/security/mcp-oauth.security.spec.ts`; Requirements: FR-031–FR-038, SC-002–SC-003; Verify: issuer/audience/time/client/scope/revocation failures are denied before data/model calls, bearer challenges contain only safe metadata, and ordinary web JWTs cannot authenticate MCP.
- [x] T031 [P] [US1] Add scope, declared-capability, protocol-era, feature-gate, revocation, and direct-call matrix tests in `server/apps/ai/test/security/mcp-capability-matrix.security.spec.ts`; Requirements: FR-004–FR-009, FR-033–FR-038, SC-001; Verify: every matrix row asserts both discovery visibility and direct-call behavior, with unauthorized discovery count and unauthorized success count both zero.
- [x] T032 [P] [US1] Add raw-response, request-boundary, abort, and global-envelope bypass tests in `server/apps/ai/test/integration/mcp-http-boundary.integration.spec.ts`; Requirements: FR-001–FR-003, FR-043–FR-047, SC-012; Verify: MCP JSON/SSE/status/header semantics are not wrapped by the existing global response interceptor and client disconnect aborts all later stages.

### Implementation

- [x] T033 [P] [US1] Implement protected-resource metadata and safe bearer challenge responses in `server/apps/ai/src/mcp/auth/mcp-protected-resource.controller.ts`; Requirements: FR-031–FR-034; Verify: T030 validates metadata URLs/scopes without leaking issuer secrets, tokens, subjects, or internal configuration.
- [x] T034 [US1] Implement the external OAuth 2.1/OIDC verifier adapter in `server/apps/ai/src/mcp/auth/oidc-mcp-access-token-verifier.ts`; Requirements: FR-031–FR-034, SC-002; Verify: against a local fake issuer, signature/JWKS, issuer, audience, exp, nbf, authorized client, scope, and revocation checks pass; keep production adapter configuration blocked by GATE-B and GATE-C.
- [x] T035 [US1] Implement immutable `(issuer, subject)` mapping and client authorization revalidation in `server/apps/ai/src/mcp/auth/mcp-authorization.service.ts`; Requirements: FR-035–FR-038, SC-003; Verify: two-subject integration tests bind to separate existing users, identity changes are rejected, account deletion/revocation invalidates access, and every direct call revalidates authorization.
- [x] T036 [P] [US1] Implement protocol-date parsing and negotiation in `server/apps/ai/src/mcp/transport/mcp-protocol-negotiator.ts`; Requirements: FR-001–FR-004; Verify: table tests accept exactly `2026-07-28` and `2025-11-25`, reject missing/ambiguous/unsupported dates according to contract, and never silently downgrade.
- [x] T037 [P] [US1] Implement the modern stateless official-SDK transport factory in `server/apps/ai/src/mcp/transport/mcp-modern-transport.factory.ts`; Requirements: FR-001–FR-009; Verify: T028 passes with a fresh request-scoped server/transport, POST-only semantics, no cross-request server state, and AbortSignal propagation.
- [x] T038 [P] [US1] Implement the legacy session manager and Redis-backed session binding in `server/apps/ai/src/mcp/transport/mcp-legacy-session.manager.ts`; Requirements: FR-001–FR-009, FR-036–FR-038, FR-046–FR-047; Verify: T029 passes for initialization, opaque IDs, issuer/subject/client binding, revocation, GET/DELETE, idle/absolute expiry, and fail-closed Redis errors.
- [x] T039 [P] [US1] Implement the capability manifest intersection and registry in `server/apps/ai/src/mcp/capabilities/mcp-capability-registry.ts`; Requirements: FR-004–FR-009, SC-001; Verify: T031 passes and a snapshot records the exact visible resources/tools/prompts for every protocol × client-capability × scope × gate case.
- [x] T040 [US1] Implement bearer extraction, verification, immutable request context, admission, negotiation, and safe-error ordering in `server/apps/ai/src/mcp/transport/mcp-request-pipeline.ts`; Requirements: FR-031–FR-047, SC-002–SC-003, SC-012; Verify: spies prove the order is boundary → authentication → authorization → admission → dispatch and no later stage runs after any failure.
- [x] T041 [US1] Mount the raw `/ai/v1/mcp` handler before the global response envelope in `server/apps/ai/src/main.ts`; Requirements: FR-001–FR-003, FR-043; Verify: T032 passes and existing `/ai/v1/*` endpoints retain their prior wrapped response format.
- [x] T042 [US1] Wire the dual transport factories, capability registry, metadata endpoint, verifier port, and request pipeline in `server/apps/ai/src/mcp/mcp.module.ts`; Requirements: FR-001–FR-009, FR-031–FR-047; Verify: the module starts with a fake verifier in test, stays disabled by default, and exposes exactly one MCP URL when the global gate is enabled.
- [x] T043 [US1] Add an in-process official-client end-to-end suite in `server/apps/ai/test/e2e/mcp-connect-discovery.e2e-spec.ts`; Requirements: FR-001–FR-009, FR-031–FR-047, SC-001–SC-003; Verify: both protocol-era clients independently initialize/discover, revoked/wrong-scope clients fail, denied calls make zero data/model requests, and all assertions pass with no external network.
- [x] T044 [US1] Record the complete US1 capability matrix, security results, protocol transcripts, and remaining approval gates in `specs/004-english-learning-mcp/evidence/us1-connect-discovery.md`; Requirements: SC-001–SC-004, SC-012; Verify: every test row links to T028–T043 evidence, unauthorized discovery/call counts are zero, and no production compatibility claim is made under GATE-E.

**Checkpoint**: Secure protocol connection and discovery are independently demonstrable with local fakes; no learning resource or tool is required.

---

## Phase 4: User Story 2 — Read authorized learning resources (Priority: P1)

**Goal**: An authorized learner can read the five defined resources with stable schemas, provenance, pagination, cache semantics, and strict per-user/source-rights isolation.

**Independent test**: Seed two learners plus authorized and unauthorized materials, then read every resource URI as each learner; verify exact results, empty states, opaque cursors, cache invalidation, revocation/deletion behavior, and no cross-user or disallowed-source data.

### Tests first

- [x] T045 [P] [US2] Add contract tests for all five resource URI templates and response schemas in `server/apps/ai/test/contract/mcp-resources.contract.spec.ts`; Requirements: FR-010–FR-016, FR-039–FR-043, SC-005; Verify: valid reads match checked-in schemas/provenance rules and malformed URI, cursor, limit, or unknown fields fail before repositories run.
- [x] T046 [P] [US2] Add two-user and source-rights isolation tests in `server/apps/ai/test/security/mcp-resource-isolation.security.spec.ts`; Requirements: FR-010–FR-016, FR-035–FR-038, SC-003, SC-006; Verify: cross-user, revoked, deleted, expired, and unapproved-source reads return no protected content and unauthorized success count is zero.
- [x] T047 [P] [US2] Add opaque pagination and cache-invalidation tests in `server/apps/ai/test/integration/mcp-resource-pagination.integration.spec.ts`; Requirements: FR-012–FR-016, FR-043, SC-005; Verify: cursors cannot be forged or reused across principal/resource/filter contexts, ordering is stable, and review/report changes invalidate stale private-resource results.
- [x] T048 [P] [US2] Add regression tests for the extracted word dictionary service in `server/apps/server/src/word-book/__tests__/word-book-shared-service.spec.ts`; Requirements: FR-010, SC-015, PLAN-ServiceReuse; Verify: existing web/API word lookup behavior and response shape are unchanged before and after delegation to the shared service.
- [x] T049 [P] [US2] Add empty-state, timezone-boundary, and learning-report aggregation tests in `server/libs/learning/src/reporting/__tests__/learning-report.service.spec.ts`; Requirements: FR-012, FR-014–FR-016, SC-005; Verify: no-data, midnight/timezone, due-review, weakness, and summary fixtures produce deterministic user-scoped results.

### Implementation

- [x] T050 [P] [US2] Extract database lookup primitives into `server/libs/learning/src/dictionary/word-dictionary.repository.ts`; Requirements: FR-010, FR-035–FR-038, PLAN-ServiceReuse; Verify: repository tests require a user/source-rights context where applicable, use deterministic ordering, and never import MCP transport types.
- [x] T051 [US2] Implement the reusable dictionary facade in `server/libs/learning/src/dictionary/word-dictionary.service.ts`; Requirements: FR-010, FR-039–FR-043; Verify: T045 word-resource cases and T048 regression fixtures return equivalent normalized word records with provenance.
- [x] T052 [US2] Delegate the existing application word-book flow to the shared service in `server/apps/server/src/word-book/word-book.service.ts`; Requirements: FR-010, SC-015; Verify: T048 and all pre-existing word-book tests pass with no route, response, authorization, or latency-contract change.
- [x] T053 [P] [US2] Implement course/material authorization and read projections in `server/libs/learning/src/resources/learning-resource-read.service.ts` and `server/libs/learning/src/resources/learning-resource.repository.ts`; Requirements: FR-011, FR-035–FR-043, SC-003, SC-006; Verify: T046 proves every query is constrained by learner access and approved source rights before content is returned.
- [x] T054 [P] [US2] Implement report queries for due reviews, summary, and weaknesses in `server/libs/learning/src/reporting/learning-report.repository.ts`; Requirements: FR-012, FR-014–FR-016, FR-035–FR-038; Verify: query tests use current-user keys, stable sort/tie-break rules, and no full-table or cross-user fallback path.
- [x] T055 [US2] Implement the shared report facade in `server/libs/learning/src/reporting/learning-report.service.ts`; Requirements: FR-012, FR-014–FR-016, SC-005; Verify: T049 passes for empty states, learner timezone, deterministic aggregates, and provenance timestamps.
- [x] T056 [P] [US2] Implement signed opaque cursor encoding and context binding in `server/apps/ai/src/mcp/pagination/mcp-cursor.service.ts`; Requirements: FR-012–FR-016, FR-043; Verify: T047 rejects mutation, expiry, wrong principal, wrong resource, and changed filter while accepting stable forward pagination.
- [x] T057 [P] [US2] Implement public word and course-material Resource handlers in `server/apps/ai/src/mcp/resources/word.resource.ts` and `server/apps/ai/src/mcp/resources/course-material.resource.ts`; Requirements: FR-010–FR-011, FR-039–FR-043, SC-005–SC-006; Verify: T045/T046 validate strict inputs, source authorization, provenance, output bounds, and safe not-found behavior.
- [x] T058 [P] [US2] Implement private due-review, report-summary, and weakness Resource handlers in `server/apps/ai/src/mcp/resources/reviews-today.resource.ts`, `server/apps/ai/src/mcp/resources/report-summary.resource.ts`, and `server/apps/ai/src/mcp/resources/weaknesses.resource.ts`; Requirements: FR-012, FR-014–FR-016, FR-039–FR-043, SC-005; Verify: T045/T047/T049 pass with current-user-only data, opaque cursors, empty states, and cache invalidation.
- [x] T059 [US2] Register the five Resource templates with scope/gate predicates in `server/apps/ai/src/mcp/resources/mcp-resource.registry.ts`; Requirements: FR-010–FR-016, FR-033–FR-038, SC-001; Verify: discovery lists exactly the authorized resource templates and direct reads after scope revocation fail despite earlier discovery.
- [x] T060 [US2] Export the dictionary, resource-read, and report facades from `server/libs/learning/src/learning.module.ts` and `server/libs/learning/src/index.ts`; Requirements: FR-010–FR-016, PLAN-ServiceReuse; Verify: both existing application modules and `mcp.module.ts` import only the public learning-lib surface without circular dependencies.
- [x] T061 [US2] Add full resource end-to-end coverage and record evidence in `server/apps/ai/test/e2e/mcp-resources.e2e-spec.ts` and `specs/004-english-learning-mcp/evidence/us2-resources.md`; Requirements: FR-010–FR-016, SC-003, SC-005–SC-006, SC-015; Verify: both protocol eras pass five-resource reads, two-user isolation, rights revocation, deletion, pagination, empty states, and existing non-MCP resource regressions.

**Checkpoint**: All five resources are independently readable and prove current-user/source-rights isolation without model calls or learning-state writes.

---

## Phase 5: User Story 3 — Use safe read-only learning tools (Priority: P1)

**Goal**: An authorized learner can search words/materials, fetch due words, and get a learning report through four read-only tools, with valid citations for RAG results and zero state mutation.

**Independent test**: Invoke the four tools for two users under both protocol eras, snapshot all learning-state tables before/after, and verify schemas, citations, ownership, cancellation, cost metadata, and denied-input behavior.

### Tests first

- [x] T062 [P] [US3] Add strict contracts for `search_words`, `get_due_words`, `search_learning_materials`, and `get_learning_report` in `server/apps/ai/test/contract/mcp-read-tools.contract.spec.ts`; Requirements: FR-017–FR-021, FR-039–FR-043, SC-004–SC-005; Verify: all four discovery schemas are complete, valid runtime results match them, and invalid parameters trigger zero business calls.
- [x] T063 [P] [US3] Add read-only state-integrity and two-user tests in `server/apps/ai/test/integration/mcp-read-tools-state.integration.spec.ts`; Requirements: FR-017–FR-021, FR-035–FR-038, SC-003, SC-005; Verify: row counts/content hashes for submissions, attempts, review schedules, mastery, and idempotency writes are unchanged across successful and failed calls.
- [x] T064 [P] [US3] Add RAG provenance, source-rights, stale-index, and fabricated-citation tests in `server/apps/ai/test/security/mcp-material-search.security.spec.ts`; Requirements: FR-019, FR-042, SC-006; Verify: every returned passage cites an existing authorized material/chunk, stale or unauthorized hits are dropped, and zero fabricated citations reach the client.
- [x] T065 [P] [US3] Add boundary, injection, deadline, cancellation, and result-size tests in `server/apps/ai/test/security/mcp-read-tools-boundary.security.spec.ts`; Requirements: FR-039–FR-047, SC-002, SC-012; Verify: adversarial queries cannot override identity/scope/source filters or expose internal prompts, and abort stops retrieval/report work before any new downstream stage.

### Implementation

- [x] T066 [P] [US3] Implement `search_words` in `server/apps/ai/src/mcp/tools/search-words.tool.ts`; Requirements: FR-017, FR-039–FR-043; Verify: T062 returns deterministic bounded dictionary results with provenance, opaque pagination where needed, and no learning writes.
- [x] T067 [P] [US3] Implement `get_due_words` in `server/apps/ai/src/mcp/tools/get-due-words.tool.ts`; Requirements: FR-018, FR-035–FR-043; Verify: T062/T063 return only the current learner's due items in stable schedule order and state hashes remain unchanged.
- [x] T068 [P] [US3] Implement `get_learning_report` in `server/apps/ai/src/mcp/tools/get-learning-report.tool.ts`; Requirements: FR-020, FR-035–FR-043; Verify: report fixtures match the shared `LearningReportService`, empty states are explicit, and the 5-second deadline/result bounds are enforced.
- [x] T069 [US3] Add the constrained MCP learning bridge for authorized material search in `server/apps/ai/src/coach/mcp/mcp-learning.bridge.ts` and export it from `server/apps/ai/src/coach/coach.module.ts`; Requirements: FR-019, FR-035–FR-043, PLAN-McpLearningBridge; Verify: the bridge exposes only the approved method, reuses `LearningMaterialService.searchV2` plus existing RAG/citation checks, and cannot invoke write-oriented Coach operations.
- [x] T070 [US3] Implement `search_learning_materials` in `server/apps/ai/src/mcp/tools/search-learning-materials.tool.ts`; Requirements: FR-019, FR-039–FR-043, SC-006; Verify: T064 passes for authorized citations, source filters, stale-index rejection, bounded snippets, and explicit empty/error states.
- [x] T071 [P] [US3] Implement final structured-output validation and provenance normalization in `server/apps/ai/src/mcp/results/mcp-result-validator.ts`; Requirements: FR-039–FR-043, SC-004–SC-006; Verify: handlers cannot serialize an out-of-schema, over-depth, over-size, missing-source, or unsafe text result.
- [x] T072 [US3] Register the four read tools and their scope/gate predicates in `server/apps/ai/src/mcp/tools/mcp-tool.registry.ts`; Requirements: FR-017–FR-021, FR-033–FR-038, SC-001; Verify: `learning:read` plus the relevant gate is required for discovery and direct invocation, and revocation takes effect on the next call.
- [x] T073 [US3] Add retrieval token/cost accounting, stage timings, cache outcome, cancellation outcome, and safe correlation to `server/apps/ai/src/mcp/governance/mcp-cost-meter.ts` and `server/apps/ai/src/coach/mcp/mcp-learning.bridge.ts`; Requirements: FR-044–FR-049, SC-011–SC-014; Verify: tests emit one bounded metric record per RAG call with provider/model/cache/tokens/cost estimate but no prompt, token, learner text, or chain-of-thought.
- [x] T074 [US3] Add both-era end-to-end read-tool coverage in `server/apps/ai/test/e2e/mcp-read-tools.e2e-spec.ts`; Requirements: FR-017–FR-021, SC-003–SC-006, SC-012; Verify: all four tools pass correct/empty/denied/cancelled cases, citations resolve, two-user isolation holds, and before/after learning-state snapshots are identical.
- [x] T075 [US3] Record US3 correctness, isolation, citation, state-integrity, latency, token, and cost evidence in `specs/004-english-learning-mcp/evidence/us3-read-tools.md`; Requirements: SC-004–SC-006, SC-011–SC-014; Verify: every metric links to a reproducible fixture/run, distinguishes measured values from unapproved baselines, and makes no production SLO claim under GATE-E.

**Checkpoint**: Four read-only tools deliver learning value with provenance, isolation, and zero learning-state mutation.

---

## Phase 6: User Story 4 — Create a personalized quiz (Priority: P1)

**Goal**: An authorized learner can create a ready-to-answer personalized quiz using the existing profile, retrieval, targeting, and exercise pipeline, without answer leakage or learning-state changes.

**Independent test**: For representative learner profiles and content permissions, call `create_quiz` twice with the same idempotency key and under concurrency; verify one semantic/model execution, schema-valid personalized questions, no answers, no learning-state writes, valid provenance, bounded cost, and clean cancellation.

### Tests and evaluations first

- [x] T076 [P] [US4] Add the strict `create_quiz` discovery/input/output contract suite in `server/apps/ai/test/contract/mcp-create-quiz.contract.spec.ts`; Requirements: FR-022–FR-024, FR-039–FR-043, SC-004, SC-007; Verify: valid quizzes are ready to answer and invalid counts/levels/types/sources/unknown keys trigger zero model or business calls.
- [x] T077 [P] [US4] Add versioned personalization and answer-leak evaluation cases in `server/apps/ai/test/evals/mcp/create-quiz.eval.spec.ts` and `server/apps/ai/test/evals/mcp/fixtures/create-quiz.cases.json`; Requirements: FR-022, FR-052–FR-060, SC-007, SC-013–SC-014; Verify: the fixture covers weak areas, due vocabulary, level, permitted sources, empty profile, prompt injection, and explicit answer/rationale leakage checks with versioned rubric output.
- [x] T078 [P] [US4] Add access, source-rights, provenance, and zero-state-mutation tests in `server/apps/ai/test/security/mcp-create-quiz.security.spec.ts`; Requirements: FR-022–FR-024, FR-035–FR-043, SC-003, SC-006–SC-007; Verify: unauthorized sources/users yield no content/model call and successful generation changes no mastery, review, submission, or attempt row.
- [x] T079 [P] [US4] Add idempotency and concurrency tests in `server/apps/ai/test/integration/mcp-create-quiz-idempotency.integration.spec.ts`; Requirements: FR-023, FR-046–FR-047, SC-009; Verify: same key/input replays one result, different input conflicts, concurrent callers cause one model charge, and recoverable in-progress states reconcile safely.
- [x] T080 [P] [US4] Add model timeout, invalid-output, budget, retry, and cancellation tests in `server/apps/ai/test/governance/mcp-create-quiz-governance.spec.ts`; Requirements: FR-044–FR-049, SC-007, SC-011–SC-014; Verify: invalid model output is never exposed, retries stay within policy, one 30-second budget is enforced, cancellation starts no later stage, and measured tokens/cost are recorded once.

### Implementation

- [x] T081 [US4] Apply `CoachConversation.origin` to MCP-created internal envelopes and filter existing user Coach history to `COACH` in `server/apps/ai/src/coach/conversation/coach-conversation.service.ts`; Requirements: FR-022, FR-038, SC-015, PLAN-OriginIsolation; Verify: existing Coach history/regression tests show MCP envelopes never appear to users while ordinary Coach conversations remain unchanged.
- [x] T082 [P] [US4] Implement the minimal internal MCP operation-envelope factory in `server/apps/ai/src/coach/mcp/mcp-operation-envelope.factory.ts`; Requirements: FR-022–FR-023, PLAN-McpLearningBridge; Verify: generated envelopes carry current-user ownership, `origin=MCP`, correlation/idempotency metadata, no chat transcript, and only fields required by existing Exercise/Attempt/Citation relations.
- [x] T083 [US4] Extend the generic idempotency service with create-quiz reservation/replay projections in `server/apps/ai/src/mcp/idempotency/mcp-idempotency.service.ts`; Requirements: FR-023, FR-046–FR-047, SC-009; Verify: T079 passes and cached replay returns the original public result without a second retrieval/model/cost record.
- [x] T084 [US4] Implement the constrained `createQuiz` bridge path using existing learner profile, material search/RAG, exercise targeting, and exercise services in `server/apps/ai/src/coach/mcp/mcp-learning.bridge.ts`; Requirements: FR-022–FR-024, PLAN-ServiceReuse; Verify: service-spy tests confirm the approved fixed chain, current-user/source filters at each step, AbortSignal forwarding, and no general Coach orchestration or hidden write path.
- [x] T085 [US4] Implement `create_quiz` request orchestration in `server/apps/ai/src/mcp/tools/create-quiz.tool.ts`; Requirements: FR-022–FR-024, FR-039–FR-047; Verify: T076/T078/T080 pass for validation, authorization, budget, idempotency, model failures, and cancellation.
- [x] T086 [P] [US4] Implement answer-free quiz result projection and provenance validation in `server/apps/ai/src/mcp/results/mcp-quiz-result.projector.ts`; Requirements: FR-022, FR-039–FR-043, SC-006–SC-007; Verify: property tests reject answer keys, correctness flags, grading rubrics, internal prompts, unauthorized citations, missing sources, and schema/size violations.
- [x] T087 [US4] Connect one-shot token/cost/latency/cache metrics to idempotency and tracing in `server/apps/ai/src/mcp/governance/mcp-cost-meter.ts`; Requirements: FR-048–FR-049, SC-009, SC-011–SC-014; Verify: original generation records exactly one charge estimate and replays/concurrent losers record zero incremental model tokens or cost.
- [x] T088 [US4] Register `create_quiz` behind `quiz:create`, quiz gate, and protocol capability checks in `server/apps/ai/src/mcp/tools/mcp-tool.registry.ts`; Requirements: FR-022–FR-024, FR-033–FR-038, SC-001; Verify: discovery/direct-call matrix tests hide or deny the tool for missing scope/gate/capability and revalidate revocation on every call.
- [x] T089 [US4] Add both-era personalized-quiz end-to-end tests and evidence in `server/apps/ai/test/e2e/mcp-create-quiz.e2e-spec.ts` and `specs/004-english-learning-mcp/evidence/us4-create-quiz.md`; Requirements: SC-003, SC-006–SC-009, SC-011–SC-014; Verify: deterministic fake-model runs pass all zero-tolerance rules, evaluation metrics/cost/latency are reproducible, and any real-provider threshold remains explicitly unapproved under GATE-E.

**Checkpoint**: Personalized quizzes can be safely generated, replayed, evaluated, and costed without revealing answers or changing learning state.

---

## Phase 7: User Story 5 — Confirm, submit, and save an answer (Priority: P1)

**Goal**: A learner explicitly confirms the only write-capable action in the project Web UI, then retries the original MCP call to atomically grade and save exactly one submission/attempt/review update.

**Independent test**: Create a quiz, call `submit_answer`, complete same-user Web confirmation, and retry under concurrency/fault injection; verify no pre-confirmation write, one atomic finalization, same-key replay, conflict rejection, no duplicate model cost, revocation/cancellation safety, and unavailable discovery for clients without URL elicitation.

### Tests and evaluations first

- [X] T090 [P] [US5] Add generated OpenAPI drift and endpoint-contract tests in `server/apps/ai/test/contract/mcp-write-confirmation-openapi.contract.spec.ts` against `specs/004-english-learning-mcp/contracts/write-confirmation.openapi.yaml`; Requirements: FR-025–FR-026, FR-039–FR-043; Verify: request/status/confirm/reject/expired/consumed schemas and safe errors remain byte-compatible with the checked-in contract.
- [X] T091 [P] [US5] Add fake-clock confirmation state-machine tests in `server/apps/ai/test/integration/mcp-write-confirmation.integration.spec.ts`; Requirements: FR-025–FR-026, FR-046–FR-047, SC-008; Verify: `PENDING → CONFIRMED|REJECTED|EXPIRED → CLAIMED → CONSUMED` transitions use compare-and-swap, TTL is exactly 5 minutes, and invalid transitions create zero learning writes.
- [X] T092 [P] [US5] Add Web reauthentication, CSRF, ownership, intent-binding, and leakage tests in `server/apps/ai/test/security/mcp-confirmation-web.security.spec.ts`; Requirements: FR-025–FR-026, FR-035–FR-043, SC-002–SC-003, SC-008; Verify: wrong user/session/client, stale auth, changed intent hash, replayed CSRF, expired token, and guessed URL cannot confirm or reveal answer/private intent details.
- [X] T093 [P] [US5] Add protocol-era elicitation and capability-discovery tests in `server/apps/ai/test/contract/mcp-submit-elicitation.contract.spec.ts`; Requirements: FR-004–FR-009, FR-025–FR-026, SC-001, SC-008; Verify: both approved URL-elicitation projections lead only to the project confirmation URL, and clients without URL elicitation neither discover nor successfully direct-call `submit_answer`.
- [X] T094 [P] [US5] Add submit idempotency, concurrent-retry, and input-conflict tests in `server/apps/ai/test/integration/mcp-submit-idempotency.integration.spec.ts`; Requirements: FR-023, FR-025–FR-026, SC-008–SC-009; Verify: same key/input yields one final result, different input conflicts, concurrent confirmed retries select one claimant, and retries never duplicate mastery/review/submission/attempt rows.
- [X] T095 [P] [US5] Add database fault-injection tests for atomic finalization in `server/apps/ai/test/integration/mcp-submit-atomicity.integration.spec.ts`; Requirements: FR-025–FR-026, FR-046–FR-047, SC-008–SC-009; Verify: failures at every transaction boundary leave either zero authoritative learning writes or one fully linked submission/attempt/review update with consumed confirmation.
- [X] T096 [P] [US5] Add cancellation, crash recovery, lease expiry, and reconciliation tests in `server/apps/ai/test/integration/mcp-submit-reconciliation.integration.spec.ts`; Requirements: FR-025–FR-026, FR-046–FR-051, SC-009, SC-012; Verify: pre-commit abort starts no new steps, commit-point outcomes reconcile from business unique keys within 24 hours, and completed writes are never repeated.
- [X] T097 [P] [US5] Add duplicate-grading/model-cost tests in `server/apps/ai/test/governance/mcp-submit-cost.spec.ts`; Requirements: FR-025–FR-026, FR-048–FR-049, SC-009, SC-013–SC-014; Verify: first preparation may record one bounded model cost, while confirmation polling, retries, concurrent losers, replay, and reconciliation add zero model tokens/cost.
- [X] T098 [P] [US5] Add component-level confirmation comprehension and accessibility tests in `apps/web/src/views/McpConfirmation/__tests__/McpConfirmation.spec.ts`; Requirements: FR-025–FR-026, SC-016; Verify: confirm/reject effects, data to be saved, expiry, recovery, keyboard/focus/error states, and revocation navigation are visible; the scripted usability fixture reaches at least 90% comprehension.

### Implementation

- [X] T099 [P] [US5] Add shared confirmation, intent-summary, status, and elicitation schemas in `packages/common/mcp/confirmation.ts` and export them from `packages/common/mcp/index.ts`; Requirements: FR-025–FR-026, FR-039–FR-043; Verify: T090 passes and server/web compile against the same types without accepting raw tokens, hidden answers, or arbitrary redirect URLs.
- [X] T100 [US5] Implement confirmation and idempotency compare-and-swap persistence in `server/apps/ai/src/mcp/confirmation/write-confirmation.repository.ts`; Requirements: FR-023, FR-025–FR-026, FR-046–FR-047, SC-008–SC-009; Verify: T091/T094 prove unique intent hashes, bound issuer/subject/user/client/key, one claimant, monotonic states, and 5-minute expiry at database boundaries.
- [X] T101 [US5] Implement confirmation creation/status/confirm/reject/claim/consume policy in `server/apps/ai/src/mcp/confirmation/write-confirmation.service.ts`; Requirements: FR-025–FR-026, FR-035–FR-047; Verify: T091/T092 pass, first `submit_answer` call performs no learning write, and all policy decisions use immutable current request plus reauthenticated Web identity.
- [X] T102 [US5] Implement authenticated project Web confirmation endpoints in `server/apps/ai/src/mcp/confirmation/write-confirmation.controller.ts`; Requirements: FR-025–FR-026, FR-031–FR-043; Verify: T090/T092 pass for same-site session authentication, CSRF, ownership, no open redirect, safe cache headers, and sanitized status/errors.
- [X] T103 [P] [US5] Implement Web confirmation contracts and API client in `apps/web/src/apis/mcp/contracts.ts`, `apps/web/src/apis/mcp/index.ts`, and `apps/web/src/apis/index.ts`; Requirements: FR-025–FR-026, FR-039–FR-043; Verify: web type-check passes, response parsing rejects unknown/unsafe shapes, and logs/interceptors never serialize confirmation secrets or learner answers.
- [X] T104 [P] [US5] Add the authenticated confirmation route in `apps/web/src/router/mcp/index.ts` and compose it into `apps/web/src/router/index.ts`; Requirements: FR-025–FR-026, SC-016; Verify: unauthenticated navigation uses the existing reauthentication flow, authenticated navigation preserves only the opaque confirmation reference, and no general external redirect is introduced.
- [X] T105 [US5] Implement the confirmation UI in `apps/web/src/views/McpConfirmation/index.vue`; Requirements: FR-025–FR-026, SC-008, SC-016; Verify: T098 and web accessibility checks pass for loading, pending, confirmed, rejected, expired, consumed, unauthorized, offline, and retry-safe states.
- [X] T106 [P] [US5] Implement modern-era URL elicitation projection in `server/apps/ai/src/mcp/elicitation/mcp-modern-confirmation.presenter.ts`; Requirements: FR-004–FR-009, FR-025–FR-026; Verify: T093 validates exact official-SDK schema, same-origin allowlist, opaque reference, expiration, and absence of private answer/internal prompt data.
- [X] T107 [P] [US5] Implement legacy initialized-session URL elicitation projection in `server/apps/ai/src/mcp/elicitation/mcp-legacy-confirmation.presenter.ts`; Requirements: FR-004–FR-009, FR-025–FR-026; Verify: T093 validates session binding, capability negotiation, safe URL/result shape, expiration, and no fallback hidden write for incapable clients.
- [X] T108 [P] [US5] Implement the shared learner-visible write-effect summary in `server/libs/learning/src/submission/learning-write-effect.service.ts`; Requirements: FR-025–FR-026, SC-008, SC-016; Verify: unit tests show deterministic summaries of grading/submission/attempt/review consequences without exposing hidden answer keys or internal rubric text.
- [X] T109 [US5] Implement idempotent pre-confirmation grading preparation through the constrained bridge in `server/apps/ai/src/coach/mcp/mcp-learning.bridge.ts`; Requirements: FR-025–FR-026, FR-044–FR-049, SC-008–SC-009; Verify: T097 proves one preparation/model charge per intent, no authoritative learning write, bounded/cancellable execution, and safe replay after confirmation.
- [X] T110 [US5] Implement the atomic authoritative submission transaction in `server/libs/learning/src/submission/mcp-submit-answer.service.ts`; Requirements: FR-025–FR-026, FR-035–FR-047, SC-008–SC-009; Verify: T094/T095 pass and one transaction creates/finalizes exactly one `ExerciseSubmission`, `LearningAttempt`, review event, item-state/mastery update, confirmation consumption, and idempotency completion.
- [X] T111 [US5] Implement post-crash reconciliation and expired/failed confirmation cleanup in `server/apps/ai/src/mcp/confirmation/mcp-submit-reconciliation.service.ts`; Requirements: FR-025–FR-026, FR-046–FR-051, SC-009, SC-012; Verify: T096 reconciles from business unique keys, clears recoverable state within 24 hours, never invents a write, and never repeats model or learning cost.
- [X] T112 [US5] Implement and register `submit_answer` orchestration in `server/apps/ai/src/mcp/tools/submit-answer.tool.ts` and `server/apps/ai/src/mcp/tools/mcp-tool.registry.ts`; Requirements: FR-023, FR-025–FR-026, FR-033–FR-047; Verify: first call returns confirmation with zero write, confirmed retry completes once, reject/expire/revoke/cancel fail safely, and discovery/direct-call predicates match T093.
- [X] T113 [US5] Add full both-era write-flow E2E and usability evidence in `server/apps/ai/test/e2e/mcp-submit-answer.e2e-spec.ts` and `specs/004-english-learning-mcp/evidence/us5-submit-answer.md`; Requirements: SC-001–SC-004, SC-008–SC-012, SC-016; Verify: tests cover no-elicitation clients, Web reauth, five-minute expiry, concurrent retries, injected failures, atomic state, duplicate-cost zero, and a reproducible comprehension/revocation script with ≥90% success.

**Checkpoint**: The only MCP write is explicit, user-confirmed, same-user bound, atomic, recoverable, idempotent, and independently auditable.

---

## Phase 8: User Story 6 — Receive guided learning prompts (Priority: P2)

**Goal**: An authorized client can discover and render three safe learner-specific prompts that reference only visible resources/tools and never perform hidden actions.

**Independent test**: Fetch each prompt for complete, partial, and empty learner profiles under both protocol eras; verify strict schemas, current-user scope, prompt-injection resistance, no internal prompt leakage, no hidden calls/writes, and only currently visible tool/resource references.

### Tests and evaluations first

- [X] T114 [P] [US6] Add discovery/argument/result contracts for `english_interview`, `business_english`, and `vocabulary_review` in `server/apps/ai/test/contract/mcp-prompts.contract.spec.ts`; Requirements: FR-027–FR-030, FR-039–FR-043, SC-010; Verify: all three schemas are stable, unknown/oversized arguments fail before services run, and results contain valid MCP prompt messages only.
- [X] T115 [P] [US6] Add identity-spoofing, injection, internal-prompt, and hidden-action security tests in `server/apps/ai/test/security/mcp-prompts.security.spec.ts`; Requirements: FR-027–FR-030, FR-035–FR-047, SC-002–SC-003, SC-010; Verify: adversarial profile/material text cannot change identity/scope/instructions or trigger model/tool/write work, and zero internal template fragments leak.
- [X] T116 [P] [US6] Add missing-profile, missing-capability, revoked-scope, and visible-reference tests in `server/apps/ai/test/integration/mcp-prompts.integration.spec.ts`; Requirements: FR-027–FR-030, FR-033–FR-043, SC-010; Verify: prompts degrade explicitly for missing data, disappear/fail after revocation, and never name a resource/tool hidden from that client manifest.
- [X] T117 [P] [US6] Add versioned prompt usefulness/tool-selection evaluation fixtures in `server/apps/ai/test/evals/mcp/prompts.eval.spec.ts` and `server/apps/ai/test/evals/mcp/fixtures/prompts.cases.json`; Requirements: FR-052–FR-060, SC-010, SC-013–SC-014; Verify: rubrics score instruction clarity, level fit, safe tool suggestions, no hidden writes, and injection resistance across positive and failure cases.

### Implementation

- [X] T118 [P] [US6] Implement the interview prompt builder in `server/apps/ai/src/mcp/prompts/english-interview.prompt.ts`; Requirements: FR-027, FR-030, FR-039–FR-043; Verify: T114–T116 pass for learner level/context, optional data, visible-capability references, bounded content, and no service side effects.
- [X] T119 [P] [US6] Implement the business-English prompt builder in `server/apps/ai/src/mcp/prompts/business-english.prompt.ts`; Requirements: FR-028, FR-030, FR-039–FR-043; Verify: T114–T116 pass for scenario parameters, learner level, permitted material references, missing data, and no hidden calls/writes.
- [X] T120 [P] [US6] Implement the vocabulary-review prompt builder in `server/apps/ai/src/mcp/prompts/vocabulary-review.prompt.ts`; Requirements: FR-029–FR-030, FR-039–FR-043; Verify: T114–T116 pass for current-user due/weak vocabulary, empty state, bounded examples, and no answer/private-content leakage.
- [X] T121 [US6] Implement prompt sanitization and safe composition in `server/apps/ai/src/mcp/prompts/mcp-prompt-composer.ts`; Requirements: FR-027–FR-030, FR-039–FR-047, SC-010; Verify: T115 blocks delimiter/control/instruction injection and confirms templates are composed as data without internal system-prompt disclosure.
- [X] T122 [US6] Register prompts with manifest-aware scope/gate predicates in `server/apps/ai/src/mcp/prompts/mcp-prompt.registry.ts`; Requirements: FR-027–FR-030, FR-033–FR-038, SC-001, SC-010; Verify: discovery/direct fetch requires `learning:read`, references are intersected with the request manifest, and revocation takes effect immediately.
- [X] T123 [US6] Add prompt-fetch trace metadata and zero-side-effect assertions in `server/apps/ai/src/mcp/observability/mcp-trace.service.ts`; Requirements: FR-048–FR-051, SC-010–SC-011; Verify: traces contain prompt name/version/outcome/timing only, redact rendered private text, and show zero model/tool/write/cost stages for prompt retrieval.
- [X] T124 [US6] Add both-era prompt E2E and evaluation evidence in `server/apps/ai/test/e2e/mcp-prompts.e2e-spec.ts` and `specs/004-english-learning-mcp/evidence/us6-prompts.md`; Requirements: SC-001–SC-003, SC-010–SC-014; Verify: three prompts pass complete/partial/empty/revoked/injection cases and the recorded evaluation distinguishes fixture results from unapproved production baselines.

**Checkpoint**: Three prompts are safely discoverable/renderable, learner-aware, manifest-consistent, and side-effect free.

---

## Phase 9: User Story 7 — Audit quality, cost, and operational safety (Priority: P2)

**Goal**: Maintainers can reproduce protocol/security checks and AI evaluations, inspect redacted traces, quantify latency/tokens/cost/cancellation, validate retention/deletion, and block release on any zero-tolerance or unapproved-baseline failure.

**Independent test**: Run the versioned evaluation suite plus deterministic security/protocol suites against synthetic fixtures and each approved client; verify metric completeness, redaction, retention, deletion, compatibility evidence, regression evidence, and a fail-closed release decision.

### Tests first

- [X] T125 [P] [US7] Add redacted trace-query and correlation tests in `server/apps/ai/test/integration/mcp-trace-query.integration.spec.ts`; Requirements: FR-048–FR-049, SC-011; Verify: one invocation reconstructs authorized stage timing/outcomes/cost through IDs while raw tokens, prompts, answers, learner text, secrets, and chain-of-thought remain unqueryable.
- [X] T126 [P] [US7] Add seeded-secret redaction scanning tests in `server/apps/ai/test/security/mcp-sensitive-data-scan.security.spec.ts`; Requirements: FR-048–FR-051, SC-002, SC-011, SC-013; Verify: scan logs, errors, database traces, eval artifacts, snapshots, and reports for unique canaries and require exactly zero hits.
- [X] T127 [P] [US7] Add retention, session expiry, confirmation cleanup, revocation, and account-deletion tests in `server/apps/ai/test/integration/mcp-retention-deletion.integration.spec.ts`; Requirements: FR-038, FR-046–FR-051; Verify: legacy sessions expire at stated bounds, diagnostics default off/max 7 days if approved, trace/auth metadata honors approved retention, pending cleanup completes within 24 hours, and deletion immediately revokes access.
- [X] T128 [P] [US7] Add evaluation case/rubric/version validation tests in `server/apps/ai/test/evals/mcp/eval-case-schema.spec.ts`; Requirements: FR-052–FR-056, SC-013; Verify: every capability category has at least one positive and one failure case, immutable fixture/rubric versions, expected sources/tool/action, and zero-tolerance annotations.
- [X] T129 [P] [US7] Add metric aggregation and percentile tests in `server/apps/ai/test/evals/mcp/mcp-metrics.spec.ts`; Requirements: FR-055–FR-058, SC-013–SC-014; Verify: quality, tool/schema accuracy, citation validity, success, P50/P95 latency, tokens, cost, cancellation, and per-client compatibility are computed deterministically with sample counts and confidence/context.
- [X] T130 [P] [US7] Add fail-closed release-gate tests in `server/apps/ai/test/evals/mcp/mcp-release-gate.spec.ts`; Requirements: FR-057–FR-060, SC-013–SC-015; Verify: any cross-user, spoof, unconfirmed/duplicate write, token leak, unauthorized capability, fabricated source/result/save, prompt leak, regression, missing client, or unapproved baseline yields release pass = false.
- [X] T131 [P] [US7] Add four-client compatibility harness contract tests in `server/apps/ai/test/contract/mcp-client-compatibility-harness.contract.spec.ts`; Requirements: FR-052, FR-057–FR-060, SC-014; Verify: Codex, Claude Desktop, one named mainstream IDE, and MCP Inspector each have isolated versioned config, transcript, expected capabilities, test status, and no inferred pass from another client.

### Implementation and evaluation

- [X] T132 [US7] Implement authorized trace lookup and stage reconstruction in `server/apps/ai/src/mcp/observability/mcp-trace-query.service.ts`; Requirements: FR-048–FR-049, SC-011; Verify: T125 passes, access is restricted to approved operational roles, and query responses expose minimal metadata only.
- [X] T133 [US7] Implement MCP retention and cleanup scheduling in `server/apps/ai/src/mcp/retention/mcp-retention.service.ts` and `server/apps/ai/src/mcp/retention/mcp-retention.processor.ts`; Requirements: FR-046–FR-051; Verify: T127 passes using fake time, PostgreSQL remains authoritative, Redis stores only coordination/session state, and retention durations remain configurable/approval-gated rather than production-enabled.
- [X] T134 [US7] Implement the MCP account-deletion collaborator in `server/apps/ai/src/mcp/retention/mcp-learning-data-cleanup.service.ts` and register it in `server/apps/ai/src/mcp/mcp.module.ts`; Requirements: FR-038, FR-050–FR-051; Verify: T127 and existing account-deletion tests prove immediate auth/session revocation and physical cleanup of mappings, authorizations, pending intents/confirmations, and permitted trace links within 24 hours.
- [X] T135 [P] [US7] Implement versioned MCP eval case/rubric loading in `server/apps/ai/test/evals/mcp/mcp-eval.types.ts` and `server/apps/ai/test/evals/mcp/mcp-fixture-loader.ts`; Requirements: FR-052–FR-056, SC-013; Verify: T128 rejects schema drift, missing failure cases, mutable versions, ambiguous expectations, and fixtures containing real learner data.
- [X] T136 [P] [US7] Complete synthetic and hand-authored fixtures for protocol, resources, tools, prompts, confirmation, duplicate writes, cancellation, injection, and isolation in `server/apps/ai/test/evals/mcp/fixtures/mcp-eval-cases.v1.json`; Requirements: FR-052–FR-056, SC-001–SC-013; Verify: coverage audit reports at least one positive and one failure case per required category and no production/user-derived personal data.
- [X] T137 [P] [US7] Implement explicit evaluation rubrics in `server/apps/ai/test/evals/mcp/rubrics/mcp-rubrics.v1.ts`; Requirements: FR-053–FR-058, SC-004–SC-014; Verify: rubric unit tests cover tool selection, parameter/schema validity, source grounding, personalization, safety, write semantics, and deterministic zero-tolerance rules without asking an LLM to judge security facts.
- [X] T138 [US7] Implement the deterministic protocol/security evaluator in `server/apps/ai/test/evals/mcp/mcp-deterministic-evaluator.ts`; Requirements: FR-052–FR-057, FR-059–FR-060, SC-001–SC-013; Verify: known-good fixtures pass, each seeded zero-tolerance defect fails the exact rule, and results are independent of stochastic model grading.
- [X] T139 [US7] Implement the bounded AI-quality evaluator using the existing eval provider adapter in `server/apps/ai/test/evals/mcp/mcp-ai-evaluator.ts`; Requirements: FR-053–FR-058, SC-007, SC-010, SC-013–SC-014; Verify: fake-judge fixtures are deterministic, real-provider runs require explicit credentials/budget, judge prompts/results are versioned, and security/release decisions never depend solely on model judgment.
- [X] T140 [US7] Implement metric aggregation and machine-readable report generation in `server/apps/ai/test/evals/mcp/mcp-eval-report.ts`; Requirements: FR-055–FR-058, SC-013–SC-014; Verify: T129 passes and output contains denominators, pass/fail counts, P50/P95, token/cost totals, cancellation outcome, fixture/rubric/version/commit/environment identifiers, and missing-data markers.
- [X] T141 [P] [US7] Implement the cost budget report and replay-deduplication audit in `server/apps/ai/test/evals/mcp/mcp-cost-report.ts`; Requirements: FR-048–FR-049, FR-055–FR-058, SC-009, SC-013–SC-014; Verify: report reconciles invocation/model-usage/idempotency records, flags unknown prices separately, proves duplicate incremental cost zero, and never treats estimates as billed amounts.
- [X] T142 [P] [US7] Implement the observability completeness and redaction report in `server/apps/ai/test/evals/mcp/mcp-observability-report.ts`; Requirements: FR-048–FR-051, SC-011–SC-012; Verify: every evaluated invocation has correlation, auth/admission/business/model/write stage outcomes as applicable, cancellation terminal state, and zero seeded-sensitive-data hits.
- [X] T143 [US7] Implement the fail-closed release decision in `server/apps/ai/test/evals/mcp/mcp-release-gate.ts`; Requirements: FR-057–FR-060, SC-013–SC-015; Verify: T130 passes, missing evidence or unapproved thresholds are `NOT_READY` rather than pass, and all zero-tolerance and regression gates are conjunctive.
- [X] T144 [P] [US7] Implement versioned client-matrix configuration and transcript capture in `server/apps/ai/test/compatibility/mcp-client-matrix.ts` and `specs/004-english-learning-mcp/evidence/client-matrix-template.md`; Requirements: FR-052, FR-057–FR-060, SC-001, SC-014; Verify: T131 passes and each of current stable Codex, Claude Desktop, one explicitly named mainstream IDE, and MCP Inspector produces an independent row/artifact.
- [X] T145 [US7] Run the complete synthetic/fake-provider evaluation and write reproducible artifacts to `specs/004-english-learning-mcp/evidence/evals/synthetic-summary.md`; Requirements: FR-052–FR-060, SC-001–SC-015; Verify: report contains commands, commit, versions, fixture/rubric IDs, complete metrics, cost, redaction scan, regressions, release-gate output, and links to raw machine-readable artifacts without sensitive data.
- [ ] T146 [US7] Execute and document approved real-provider/four-client baseline runs in `specs/004-english-learning-mcp/evidence/evals/approved-baselines.md`; Requirements: FR-052–FR-060, SC-014; Verify: only after GATE-B/D/E approval, every named client independently passes and the user-approved thresholds/owners/dates are recorded; otherwise the release status remains `NOT_READY` and this task stays pending.
- [X] T147 [US7] Complete the requirement/evidence matrix in `specs/004-english-learning-mcp/traceability.md`; Requirements: FR-001–FR-060, SC-001–SC-016; Verify: every requirement links to at least one implementation task, one positive test, one failure test where applicable, and one final evidence artifact with no orphan task or unverified claim.

**Checkpoint**: Quality, cost, privacy, cancellation, compatibility, and regressions are reproducible and release is blocked unless every mandatory gate passes.

---

## Phase 10: Final hardening and cross-cutting validation

**Purpose**: Re-run repository-wide safety checks, validate documented contracts, and prepare an evidence-backed handoff without deployment or production changes.

- [X] T148 [P] Add property/fuzz coverage for all public MCP schema and URI boundaries in `server/apps/ai/test/security/mcp-public-boundary-fuzz.security.spec.ts`; Requirements: FR-039–FR-047, SC-002, SC-004, SC-012; Verify: bounded seeded runs cover malformed JSON-RPC, Unicode, depth, size, cursor, identifier, URL, and cancellation cases with no crash, leak, business call on invalid input, or nondeterministic failure.
- [X] T149 [P] Add database query-plan and bounded-load evidence for resource, report, trace, idempotency, and reconciliation queries in `specs/004-english-learning-mcp/evidence/query-load-baseline.md`; Requirements: FR-044–FR-051, SC-012–SC-014; Verify: record dataset shape, query plans, concurrency, P50/P95, timeouts, pool/lease behavior, and cancellation; label results experimental until GATE-E approval.
- [X] T150 [P] Run all existing server AI, Coach, learning, word-book, auth, deletion, and migration regressions and record deltas in `specs/004-english-learning-mcp/evidence/server-regression.md`; Requirements: FR-059–FR-060, SC-015; Verify: compare with T001 baseline, explain every delta, require 100% previously passing regression coverage, and show no non-MCP behavior change.
- [X] T151 [P] Run Web type-check, unit, build, routing/auth, and confirmation accessibility regressions and record deltas in `specs/004-english-learning-mcp/evidence/web-regression.md`; Requirements: FR-025–FR-026, FR-059–FR-060, SC-015–SC-016; Verify: compare with T001, require no unrelated route/API/UI behavior change, and retain the confirmation comprehension result.
- [X] T152 Run the complete MCP contract, security, integration, E2E, compatibility-harness, evaluation, sensitive-data-scan, and release-gate suites and record the exact command manifest in `specs/004-english-learning-mcp/evidence/final-verification.md`; Requirements: FR-001–FR-060, SC-001–SC-016; Verify: every required suite is listed with exit status and artifact hash, and any failure or missing approval yields `NOT_READY`.
- [X] T153 Validate every local quickstart scenario and update only verified commands/statuses in `specs/004-english-learning-mcp/quickstart.md`; Requirements: FR-001–FR-060, SC-001–SC-016; Verify: a clean local setup with fake issuer/provider can reproduce connect, resources, read tools, quiz, confirmation/write, prompts, deletion, cancellation, and evaluation without production secrets.
- [X] T154 [P] Synchronize public contract documentation and generated artifacts in `specs/004-english-learning-mcp/contracts/README.md`, `specs/004-english-learning-mcp/contracts/mcp-streamable-http.md`, `specs/004-english-learning-mcp/contracts/mcp-authorization.md`, `specs/004-english-learning-mcp/contracts/mcp-capabilities.schema.json`, and `specs/004-english-learning-mcp/contracts/write-confirmation.openapi.yaml`; Requirements: FR-001–FR-043; Verify: drift tests pass and every documented URI/tool/prompt/scope/error/version/confirmation state matches runtime discovery and behavior.
- [X] T155 Audit the final diff for unauthorized dependencies, production config, deployment files, secrets, generated noise, and unrelated edits, recording the result in `specs/004-english-learning-mcp/evidence/scope-audit.md`; Requirements: SC-002, SC-011, SC-015, GATE-A–GATE-E; Verify: `git diff --name-status` and secret/config/dependency checks prove all changes are in scope and any gated action has a dated explicit approval reference.
- [X] T156 Produce the final readiness decision in `specs/004-english-learning-mcp/evidence/readiness.md`; Requirements: FR-057–FR-060, SC-013–SC-016; Verify: it links traceability, synthetic and approved baselines, client matrix, regressions, retention/source-rights approvals, open risks, rollback/disable gates, and explicitly states that push/deploy/production enablement are not performed by this plan.

---

## Dependencies and execution order

### Phase dependencies

- **Phase 1 → Phase 2**: baseline, traceability, contract drift target, and approval gates must exist before shared implementation.
- **Phase 2 → US1**: all stories depend on strict contracts, identity, persistence, governance, tracing, and disabled-by-default wiring.
- **US1 → US2/US6**: resources and prompts require secure negotiation, request identity, and manifest-aware discovery.
- **US2 → US3**: read tools reuse the shared dictionary/resource/report services proven by US2.
- **US3 → US4**: quiz creation reuses authorized retrieval/provenance plus the constrained bridge and cost instrumentation.
- **US4 → US5**: answer submission requires an existing generated exercise and its idempotent operation envelope.
- **US1 + US3 → US6 integration**: prompt builders can be developed after US1, but full visible-tool/reference tests require the read-tool registry.
- **US1–US6 → US7**: complete evaluation, compatibility, cost, observability, retention, and release evidence requires every capability.
- **US7 → Phase 10**: final hardening consumes the complete release-gate and evidence pipeline.

### User-story dependency graph

```text
Setup → Foundation → US1
                       ├─→ US2 → US3 → US4 → US5
                       └─→ US6 ───────────────┐
US1 + US2 + US3 + US4 + US5 + US6 ──────────→ US7 → Final hardening
```

### Parallel opportunities by story

- **US1**: T028–T032 can run in parallel; after T035/T036, T037–T039 can run in parallel; T043 waits for T040–T042.
- **US2**: T045–T049 can run in parallel; T050, T053, T054, and T056 can run in parallel; T057/T058 follow their services and then converge at T059–T061.
- **US3**: T062–T065 can run in parallel; T066–T068 and T071 can run in parallel; T069 precedes T070; all converge at T072–T075.
- **US4**: T076–T080 can run in parallel; T082 and T086 can run in parallel; T083–T085 form the idempotency/bridge/handler chain; T087–T089 close the story.
- **US5**: T090–T098 can run in parallel; T103/T104, T106/T107, and T108 can run in parallel; T100→T101→T102 and T109→T110→T112 are critical chains; T113 waits for all.
- **US6**: T114–T117 can run in parallel; T118–T120 can run in parallel; T121–T123 integrate them before T124.
- **US7**: T125–T131 can run in parallel; T135–T137 and T141/T142/T144 can run in parallel; T138–T143 feed T145; T146 remains approval-gated; T147 closes traceability.

## Implementation strategy

### Suggested MVP

1. Complete Phase 1 and Phase 2.
2. Complete US1 for the smallest protocol/security MVP with local fakes.
3. For the smallest learner-value MVP, add US2 and US3 to expose authorized resources and read-only tools.
4. Keep all production gates off; do not execute T004, production issuer integration, approved baseline runs, push, or deploy without explicit authorization.

### Incremental delivery

1. Establish contracts/security/governance and prove discovery first.
2. Add read-only resources and tools before any generative or write capability.
3. Add personalized quiz generation with deterministic evaluation, idempotency, and cost accounting.
4. Add explicit Web confirmation and atomic submission only after all zero-write and fault-injection tests exist.
5. Add prompts, then close with cross-capability evaluation, client compatibility, regression, retention, and approval gates.

### Test discipline

- Execute each story's test/evaluation tasks first and confirm they fail for the missing behavior before implementation.
- Use local fake issuer, fake model/provider, fake clock, and isolated databases for deterministic protocol/security/idempotency verification.
- Keep deterministic security and protocol gates separate from AI-quality judging.
- Treat zero-tolerance violations and missing evidence as hard failures; never average them into a quality score.
- Record latency, tokens, cost estimates, cancellation, cache, and compatibility with fixture/rubric/code/environment versions; do not label them production targets before GATE-E approval.

## Task completion definition

A task is complete only when its named paths exist or are updated as described, its linked requirements are covered, its exact verification method passes, sensitive-data scans are clean, and all applicable authorization gates are satisfied. Checking a task does not itself authorize production configuration, push, deployment, external client registration, paid model use, or dependency installation.

---

## Phase 11: Convergence

- [ ] T157 CRITICAL: Wire `OidcMcpAccessTokenVerifier` into the enabled non-production MCP runtime in `server/apps/ai/src/mcp/mcp.module.ts` behind explicit GATE-B configuration, while retaining `DisabledMcpAccessTokenVerifier` whenever required issuer/audience/JWKS/client settings are absent, per FR-031–FR-034 and US1/AC1 (partial); Verify: a Nest module integration test uses a local fake issuer to prove an enabled request reaches discovery with a valid audience-bound token, all invalid-token cases stop before business/model calls, and missing configuration remains fail-closed.
- [ ] T158 CRITICAL: Implement and inject a Redis-backed `McpAdmissionStore` under the independent `mcp:*` namespace in `server/apps/ai/src/mcp/governance/redis-mcp-admission.store.ts` and `server/apps/ai/src/mcp/mcp.module.ts`, reusing existing `CoachRedisModule` primitives and retaining `FailClosedMcpAdmissionStore` when Redis admission cannot be proven, per FR-044 and plan: Redis admission (partial); Verify: module-level integration tests prove network/subject/client/subject-client/capability rate and lease limits, atomic release, cancellation cleanup, namespace isolation, and fail-closed Redis faults.
- [ ] T159 Connect `McpInvocationRepository`, `McpTraceRepository`, and `McpTraceService` to the actual request lifecycle in `server/apps/ai/src/mcp/transport/mcp-request-pipeline.ts` and `server/apps/ai/src/mcp/mcp.module.ts`, recording one bounded invocation/trace and ordered protocol/auth/admission/business/model/write/terminal stages without raw sensitive content, per FR-048–FR-049 and SC-011 (partial); Verify: an enabled-boundary integration test reconstructs every applicable stage for success, rejection, cancellation, timeout, and confirmed write, while the seeded-secret scan reports zero hits.
- [ ] T160 Add a directly executable, non-production-only real-provider baseline adapter and runner in `server/apps/ai/test/evals/mcp/mcp-live-provider.adapter.ts` and `server/apps/ai/test/evals/mcp/run-live-baseline.ts`, reusing the existing provider gateway and enforcing explicit credential, model/version, sample, call-count, total-cost, token, latency, and quality gates before any call, per FR-052–FR-059 and T146 (partial); Verify: fake-provider tests cover budget exhaustion, missing approval values, unknown pricing, cancellation, redaction, and artifact versioning, then an approved invocation can generate the inputs required by `specs/004-english-learning-mcp/evidence/evals/approved-baselines.md` without production configuration or deployment.
