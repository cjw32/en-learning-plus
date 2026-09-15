---
description: "Dependency-ordered implementation tasks for AI pronunciation assessment"
---

# Tasks: AI 发音评测

**Input**: Design documents from `/specs/003-pronunciation-assessment/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `requirements-traceability.md`

**Tests**: Required. Test, security, AI-evaluation, cost and observability tasks are included because the confirmed specification defines measurable release gates.

**Authorization boundary**: These tasks do not authorize dependency installation, production configuration changes, live Provider calls, use of real learner audio, push or deployment. Tasks marked with an approval gate must remain fail closed until the named evidence is explicitly approved.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel after its phase prerequisites because it owns distinct files.
- **[USn]**: Maps to User Story n in `spec.md`.
- Every task includes requirement IDs and a concrete verification method.

## Phase 1: Setup (Shared contract and default-off boundary)

**Purpose**: Establish strict contracts, versions and feature gates without adding dependencies or changing runtime configuration.

- [x] T001 Create pronunciation API enums, target-input schemas and exported types in `packages/common/pronunciation/api.schemas.ts` and `packages/common/pronunciation/index.ts` — Requirements: FR-001–FR-007, FR-023, FR-025, FR-034, FR-059; Verify: `pnpm --filter @en/server build` resolves `@en/common/pronunciation` with no unknown-field acceptance.
- [x] T002 [P] Create strict public result/word/learning-update Zod schemas in `packages/common/pronunciation/result.schemas.ts` — Requirements: FR-026–FR-035, FR-040–FR-041, FR-048; Verify: `pnpm --filter @en/server test -- --runInBand apps/ai/test/contract/pronunciation-shared-contract.spec.ts` rejects missing, extra, out-of-range and contradictory fields.
- [x] T003 [P] Create strict internal Provider success/failure schemas and port data types in `packages/common/pronunciation/provider.schemas.ts` — Requirements: FR-023–FR-026, FR-032, FR-035, FR-076; Verify: the shared-contract test accepts every declared outcome and rejects raw/unknown Provider fields.
- [x] T004 [P] Define immutable schema, adapter, normalization, alignment, confidence, learning, scheduler, budget and price version constants in `packages/common/pronunciation/versions.ts` — Requirements: FR-053, FR-073–FR-075, FR-084; Verify: the shared-contract test proves every reliable result has the complete nonempty version set.
- [x] T005 Add deterministic JSON Schema generation and committed-artifact drift checks in `packages/common/pronunciation/generate-contracts.ts` and `server/apps/ai/test/contract/pronunciation-contract-generation.spec.ts` — Requirements: FR-026–FR-032, FR-075, FR-080; Verify: two generations are byte-identical and equal `specs/003-pronunciation-assessment/contracts/*.schema.json`.
- [x] T006 Create the default-off `PronunciationModule` shell and directory exports in `server/apps/ai/src/pronunciation/pronunciation.module.ts` — Requirements: FR-023, FR-076, FR-088; Verify: `pnpm --filter @en/server build` succeeds while the module performs zero network/storage calls.
- [x] T007 [P] Implement strict runtime gate parsing with every capture/upload/provider/result-display/learning-shadow/learning-write/Coach gate false by default in `server/apps/ai/src/pronunciation/governance/pronunciation-config.schema.ts` — Requirements: FR-064, FR-069, FR-075–FR-076, FR-084–FR-088; Verify: `pronunciation-config.schema.spec.ts` proves missing, malformed, unknown-price or unapproved values close the affected gate.
- [x] T008 Record the pre-implementation dependency/configuration baseline and authorization gates in `specs/003-pronunciation-assessment/implementation-evidence.md` — Requirements: FR-064, FR-066, FR-076–FR-078, FR-086, FR-088; Verify: `git diff -- package.json server/package.json apps/web/package.json pnpm-lock.yaml server/Dockerfile server/ecosystem.config.js` contains no task-stage change.

**Checkpoint**: Shared contracts compile, artifacts are deterministic, and the feature remains inert by default.

---

## Phase 2: Foundational (Blocking durable and least-privilege infrastructure)

**Purpose**: Add the durable domain model and reusable security/governance primitives required by all user stories.

**⚠️ CRITICAL**: No user-story implementation begins until this phase passes.

- [x] T009 Add pronunciation enums, assessments, immutable targets, audio assets, word results, Provider calls, traces, deletion tombstones and recalculation events to `server/prisma/schema.prisma` — Requirements: FR-003, FR-024, FR-027–FR-032, FR-050, FR-056–FR-057, FR-067–FR-068, FR-073–FR-075; Verify: `pnpm --dir server exec prisma validate` passes and schema review matches `data-model.md`.
- [x] T010 Extend `LearningAttempt`, `LearningTargetType` and `LearningReviewEvent` with the EXERCISE/PRONUNCIATION discriminator and versioned evidence in `server/prisma/schema.prisma` — Requirements: FR-049–FR-055, FR-067; Verify: schema contract tests prove no parallel attempt table and preserve every legacy exercise relation.
- [x] T011 Create the additive/backfill/XOR/range/partial-active-index migration in `server/prisma/migrations/20260910000000_add_pronunciation_assessment/migration.sql` — Requirements: FR-022, FR-049–FR-057, FR-069; Verify: `pronunciation-schema.integration.spec.ts` applies it to a disposable database, validates legacy rows and rejects both invalid discriminator shapes.
- [x] T012 Regenerate the existing Prisma client in `server/libs/shared/src/generated/prisma/` after the approved schema change — Requirements: FR-050, FR-073; Verify: `pnpm --dir server exec prisma generate` and `pnpm --filter @en/server build` succeed without dependency changes.
- [x] T013 Implement content hashing, user-scoped idempotency and compare-and-set state transitions in `server/apps/ai/src/pronunciation/application/pronunciation.repository.ts` — Requirements: FR-021, FR-056–FR-057, FR-070, FR-074; Verify: `pronunciation-repository.integration.spec.ts` covers same-key replay, different-hash conflict, duplicate workers and terminal-state immutability.
- [x] T014 [P] Implement the pronunciation public error taxonomy and HTTP-safe mapper in `server/apps/ai/src/pronunciation/observability/pronunciation-failure.mapper.ts` — Requirements: FR-014, FR-025, FR-035, FR-041, FR-071–FR-072; Verify: `pronunciation-failure.mapper.spec.ts` snapshots stable category/code/retryability messages without internal details.
- [x] T015 [P] Implement allowlist redaction and pseudonymous subject hashing by reusing Coach primitives in `server/apps/ai/src/pronunciation/observability/pronunciation-redaction.ts` — Requirements: FR-035, FR-063, FR-065–FR-066, FR-072–FR-074; Verify: `pronunciation-redaction.spec.ts` finds zero secrets, raw text, object addresses, real subject IDs or audio bytes.
- [x] T016 [P] Define private audio storage, audio inspection and Provider interfaces plus fake/unavailable adapters in `server/apps/ai/src/pronunciation/storage/pronunciation-audio.storage.ts`, `audio/pronunciation-audio-inspector.ts` and `provider/pronunciation-assessment.provider.ts` — Requirements: FR-017–FR-026, FR-062–FR-065, FR-076, FR-088; Verify: port contract tests demonstrate fake behavior and unavailable adapters fail before any external call.
- [x] T017 Implement a validated Redis connection factory for pronunciation queues/governance in `server/apps/ai/src/pronunciation/governance/pronunciation-redis.module.ts` — Requirements: FR-022, FR-069–FR-070, FR-088; Verify: `pronunciation-redis.module.spec.ts` covers password/database parity, unavailable Redis and no fallback to an unintended database.
- [x] T018 Implement atomic one-active, 6/minute and 120/day admission leases in `server/apps/ai/src/pronunciation/governance/pronunciation-admission.service.ts` — Requirements: FR-022, FR-069, FR-076; Verify: `pronunciation-admission.integration.spec.ts` checks exact boundaries, expiry, rollback and PostgreSQL fallback uniqueness.
- [x] T019 Implement versioned regional price lookup and four-level budget reservation/settlement in `server/apps/ai/src/pronunciation/governance/pronunciation-price.catalog.ts` and `pronunciation-budget.service.ts` — Requirements: FR-022, FR-057, FR-069, FR-073, FR-075–FR-076; Verify: `pronunciation-budget.service.spec.ts` rejects unknown price/currency/version or any absent/exceeded cap and never double-settles.
- [x] T020 Implement durable cancellation plus Redis signal/AbortSignal coordination in `server/apps/ai/src/pronunciation/governance/pronunciation-cancellation.service.ts` — Requirements: FR-021, FR-025, FR-057, FR-069–FR-070; Verify: `pronunciation-cancellation.integration.spec.ts` exercises cancellation before/after queue, Provider acceptance and final transaction.
- [x] T021 Implement assessment Trace, step spans and Provider-call ledger repositories in `server/apps/ai/src/pronunciation/observability/pronunciation-trace.service.ts` — Requirements: FR-035, FR-057, FR-070, FR-073–FR-075; Verify: `pronunciation-trace.integration.spec.ts` proves one logical trace links every call/step/version/cost without forbidden fields.
- [x] T022 Register only the default-off module, queue connection and existing shared/learning modules in `server/apps/ai/src/ai.module.ts` and `server/apps/ai/src/pronunciation/pronunciation.module.ts` — Requirements: FR-069, FR-076, FR-088, SC-016; Verify: server startup/build with no pronunciation settings performs zero bucket mutation and zero Provider call.

**Checkpoint**: Durable authority, identity isolation, state machine, budgets, cancellation and Trace exist behind closed gates.

---

## Phase 3: User Story 1 - 完成一次可解释的发音评测 (Priority: P1) 🎯 Backend MVP

**Goal**: Resolve an authoritative short target, submit a fake-capable assessment and display a strict, position-stable, provider-neutral result.

**Independent Test**: With one authenticated test subject, fixture audio and the fake Provider, word/phrase/sentence requests reach valid structured results; optional prosody is null when unavailable and malformed/unalignable data cannot become success.

### Tests for User Story 1

- [x] T023 [P] [US1] Write create/upload/submit/get/list OpenAPI contract tests in `server/apps/ai/test/contract/pronunciation-api.contract.spec.ts` — Requirements: FR-001–FR-007, FR-023–FR-035, FR-056, FR-059–FR-060; Verify: `pnpm --filter @en/server test -- --runInBand apps/ai/test/contract/pronunciation-api.contract.spec.ts` fails before implementation and later passes every declared response shape.
- [x] T024 [P] [US1] Write Provider port and raw-response validation tests in `server/apps/ai/test/contract/pronunciation-provider.contract.spec.ts` — Requirements: FR-023–FR-026, FR-030–FR-032, FR-035, FR-076; Verify: missing dimensions, unknown statuses, out-of-range scores and raw-field leakage are rejected.
- [x] T025 [P] [US1] Write deterministic normalization/alignment cases for Unicode, punctuation, contractions, numbers, hyphens, repeated, omitted, inserted and reordered words in `server/apps/ai/test/evals/pronunciation/alignment.eval.spec.ts` — Requirements: FR-036–FR-041, SC-006; Verify: target-position accuracy is 100% and illegal timestamps never enable seek.
- [x] T026 [P] [US1] Write Web store/result component tests in `apps/web/src/stores/__tests__/pronunciation.spec.ts` and `apps/web/src/components/Pronunciation/__tests__/PronunciationAssessmentResult.spec.ts` — Requirements: FR-027–FR-034, FR-042–FR-048, SC-002–SC-003, SC-015; Verify: `pnpm --filter @en/web test:unit -- pronunciation` covers all word states, null prosody, confidence labels and learning-write disclosure.

### Implementation for User Story 1

- [x] T027 [P] [US1] Implement versioned target text validation/tokenization and exercise-type derivation in `server/libs/learning/src/pronunciation/pronunciation-target-normalizer.ts` — Requirements: FR-002–FR-003, FR-006, FR-016, FR-036–FR-038; Verify: `pronunciation-target-normalizer.spec.ts` covers empty/punctuation-only/non-English/control/30-word/200-character boundaries.
- [x] T028 [US1] Implement server-authoritative MANUAL, WORD_BOOK and platform-owned COACH_EXERCISE resolution in `server/libs/learning/src/pronunciation/pronunciation-target.service.ts` — Requirements: FR-003–FR-007, FR-059–FR-061; Verify: `pronunciation-target.service.spec.ts` proves client text cannot override stored authority and manual targets cannot claim resource ownership.
- [x] T029 [US1] Implement disabled-by-default COURSE_WORD/RAG_CITATION resolution with explicit `pronunciationAssessment` content-right revalidation in `server/libs/learning/src/pronunciation/pronunciation-source-rights.service.ts` — Requirements: FR-004–FR-007, FR-061, FR-064, FR-088; Verify: `pronunciation-source-rights.service.spec.ts` rejects display-only, expired, revoked, wrong-version and cross-owner sources.
- [x] T030 [P] [US1] Implement deterministic sequence alignment and timestamp sanitation in `server/apps/ai/src/pronunciation/application/pronunciation-alignment.service.ts` — Requirements: FR-028–FR-029, FR-036–FR-041; Verify: T025 passes with stable target occurrences and explicit uncertain fallback.
- [x] T031 [P] [US1] Implement conservative confidence tiers and deterministic next-action policy in `server/apps/ai/src/pronunciation/application/pronunciation-confidence.policy.ts` — Requirements: FR-025, FR-031, FR-034, FR-041, FR-052–FR-054, FR-076; Verify: `pronunciation-confidence.policy.spec.ts` proves `.59`, `.60`, `.79`, `.80` boundaries and every no-write outcome.
- [x] T032 [US1] Implement strict Provider-result assembly, deterministic summaries and suggestions in `server/apps/ai/src/pronunciation/application/pronunciation-result.assembler.ts` — Requirements: FR-026–FR-035, FR-039–FR-041; Verify: T024 plus `pronunciation-result.assembler.spec.ts` prove no LLM can alter scores/status/confidence/write eligibility.
- [x] T033 [US1] Implement assessment create/upload-metadata/submit/get/list orchestration with source revalidation in `server/apps/ai/src/pronunciation/application/pronunciation-assessment.service.ts` — Requirements: FR-001–FR-007, FR-049, FR-056–FR-057, FR-069; Verify: `pronunciation-assessment.service.spec.ts` covers owned lifecycle, idempotent replay and source invalidation before submit.
- [x] T034 [US1] Implement an ID-only BullMQ queue, durable outbox dispatch and strict worker payload validation in `server/apps/ai/src/pronunciation/queue/pronunciation.queue.ts`, `pronunciation-outbox.dispatcher.ts` and `pronunciation.processor.ts` — Requirements: FR-021–FR-026, FR-057, FR-069–FR-074; Verify: `pronunciation-queue.integration.spec.ts` proves queue payload contains only `assessmentId` and crash replay cannot duplicate a call/result.
- [x] T035 [US1] Implement the Azure short-audio REST adapter with native `fetch` behind region/privacy/model/price/budget gates in `server/apps/ai/src/pronunciation/provider/azure-pronunciation.provider.ts` — Requirements: FR-023–FR-026, FR-032, FR-063–FR-064, FR-069–FR-076; Verify: `azure-pronunciation.provider.spec.ts` uses a mocked server to validate request minimization, 30-second abort, null prosody and fail-closed model identity without live Azure access.
- [x] T036 [US1] Implement the authenticated REST controller matching the OpenAPI lifecycle in `server/apps/ai/src/pronunciation/api/pronunciation.controller.ts` — Requirements: FR-001, FR-014, FR-021, FR-056, FR-059–FR-060, FR-071–FR-072; Verify: T023 passes and cross-owner/not-found responses are indistinguishable.
- [x] T037 [P] [US1] Implement typed Web API requests and bounded durable polling in `apps/web/src/apis/pronunciation/index.ts` and `apps/web/src/apis/pronunciation/contracts.ts` — Requirements: FR-009, FR-014–FR-015, FR-021, FR-047, FR-056–FR-057, FR-071; Verify: `apps/web/src/apis/pronunciation/__tests__/pronunciation-api.spec.ts` covers 202 polling, cancellation, timeout and replay.
- [x] T038 [P] [US1] Implement a non-persisted Pinia assessment store in `apps/web/src/stores/pronunciation.ts` — Requirements: FR-009, FR-014, FR-042–FR-048, FR-065; Verify: T026 proves no Blob/object URL appears in persisted state and every terminal/error state is distinct.
- [x] T039 [US1] Implement accessible score, recognized/reference text, word status, feedback and timestamp-seek UI in `apps/web/src/components/Pronunciation/PronunciationAssessmentResult.vue` and `PronunciationWordFeedback.vue` — Requirements: FR-027–FR-034, FR-040, FR-042–FR-048; Verify: T026 passes keyboard/screen-reader/non-color/null-timestamp cases.
- [x] T040 [US1] Add WordBook and platform-owned Coach pronunciation entry points in `apps/web/src/views/WordBook/index.vue` and `apps/web/src/views/Coach/components/ExerciseCard.vue` while leaving Course/RAG gated in `apps/web/src/components/Pronunciation/PronunciationEntry.vue` — Requirements: FR-004–FR-007, FR-047, FR-088; Verify: `pronunciation-entry.spec.ts` shows only currently authorized source types and makes zero request when gates are off.
- [x] T041 [US1] Add a fake-Provider end-to-end word/phrase/sentence journey in `tests/pronunciation-assessment.spec.ts` — Requirements: FR-001–FR-048, SC-002–SC-006, SC-014; Verify: `pnpm test:e2e -- pronunciation-assessment.spec.ts` completes all three targets and locates each required word state.

**Checkpoint**: US1 is independently demonstrable with fixtures/fake Provider; live Provider and learning mutation remain closed.

---

## Phase 4: User Story 2 - 安全控制浏览器录音 (Priority: P1)

**Goal**: Provide explicit, continuous, local-first recording with capability detection, preview/re-record and complete resource cleanup.

**Independent Test**: Supported, denied, no-device, interrupted, offline and unsupported environments each reach the correct recoverable state; no scored recording can pause and every track/context/timer/object URL is released.

### Tests for User Story 2

- [x] T042 [P] [US2] Write MediaRecorder capability/state/resource-cleanup unit tests in `apps/web/src/hooks/__tests__/usePronunciationRecorder.spec.ts` — Requirements: FR-008–FR-016, FR-021, SC-001, SC-004–SC-005; Verify: `pnpm --filter @en/web test:unit -- usePronunciationRecorder` covers user-gesture permission, codec fallback, interruption and cleanup.
- [x] T043 [P] [US2] Write recorder accessibility and local-preview component tests in `apps/web/src/components/Pronunciation/__tests__/PronunciationRecorder.spec.ts` — Requirements: FR-008–FR-014, FR-044, SC-001, SC-014; Verify: no state relies only on color, no pause control exists and destructive navigation asks for confirmation.
- [x] T044 [P] [US2] Write synthetic audio attack/limit tests in `server/apps/ai/test/security/pronunciation-audio.security.spec.ts` — Requirements: FR-016–FR-022, FR-065, FR-080, FR-085; Verify: malformed, polyglot, metadata mismatch, decode-exhaustion, silence and boundary files are rejected before fake Provider call count changes.
- [x] T045 [P] [US2] Write private storage policy/retention contract tests in `server/apps/ai/test/integration/pronunciation-audio-storage.integration.spec.ts` — Requirements: FR-021, FR-062, FR-065, FR-068, SC-011; Verify: a disposable MinIO bucket test rejects anonymous-read/missing-lifecycle setups and never mutates bucket policy.

### Implementation for User Story 2

- [x] T046 [P] [US2] Implement runtime secure-context/getUserMedia/MediaRecorder/codec capability detection in `apps/web/src/hooks/pronunciation-recorder-capabilities.ts` — Requirements: FR-008, FR-014, FR-016; Verify: T042 passes WebM/Opus preference, MP4/AAC fallback and unsupported results without User-Agent assumptions.
- [x] T047 [US2] Implement the continuous recording state machine, Web Audio level meter and total cleanup in `apps/web/src/hooks/usePronunciationRecorder.ts` — Requirements: FR-009–FR-013, FR-015–FR-016, FR-021; Verify: T042 proves start/stop/cancel/re-record and route disposal release every resource within the local 300 ms feedback target.
- [x] T048 [US2] Implement permission disclosure, timer/waveform, local playback, delete and re-record controls in `apps/web/src/components/Pronunciation/PronunciationRecorder.vue` — Requirements: FR-008–FR-014, FR-044, FR-046–FR-047; Verify: T043 and an axe-equivalent existing accessibility assertion pass without introducing a dependency.
- [x] T049 [US2] Enforce client 500 ms/30 s/8 MiB limits, 30-second cancellable upload and bounded polling in `apps/web/src/stores/pronunciation.ts` and `apps/web/src/apis/pronunciation/index.ts` — Requirements: FR-014, FR-016–FR-017, FR-021–FR-022, FR-071; Verify: `pronunciation-upload.spec.ts` covers exact boundaries, offline recovery and no quota consumption for locally rejected audio.
- [x] T050 [US2] Implement private MinIO quarantine/read/purge adapter with startup privacy/lifecycle validation in `server/apps/ai/src/pronunciation/storage/minio-pronunciation-audio.storage.ts` — Requirements: FR-021, FR-062, FR-065, FR-068; Verify: T045 proves random keys, authenticated read, no public policy mutation, immediate revoke and bounded expiry.
- [x] T051 [US2] Implement fixed-path, no-shell, resource-bounded ffprobe/ffmpeg capability and canonicalization adapter in `server/apps/ai/src/pronunciation/audio/ffmpeg-pronunciation-audio-inspector.ts` without installing binaries — Requirements: FR-017–FR-020, FR-022; Verify: T044 proves missing/unapproved binaries fail closed and mocked approved processes enforce time/CPU/memory/output/protocol limits.
- [x] T052 [US2] Implement decoded PCM silence/low-volume/clipping/speech-duration quality policy in `server/apps/ai/src/pronunciation/audio/pronunciation-audio-quality.policy.ts` — Requirements: FR-017, FR-020, FR-022, FR-071; Verify: `pronunciation-audio-quality.policy.spec.ts` classifies calibrated synthetic PCM boundaries deterministically.
- [x] T053 [US2] Enforce authentication/admission before multipart buffering and the 8 MiB server limit in `server/apps/ai/src/pronunciation/api/pronunciation-upload.guard.ts` and `pronunciation.controller.ts` — Requirements: FR-001, FR-017–FR-022, FR-059; Verify: T044 proves oversized/unauthorized requests allocate no object and invoke no Provider.
- [x] T054 [US2] Connect quarantine→probe→canonical WAV→raw purge transitions in `server/apps/ai/src/pronunciation/application/pronunciation-audio.service.ts` — Requirements: FR-017–FR-022, FR-063, FR-068–FR-070; Verify: `pronunciation-audio.service.integration.spec.ts` asserts durable transitions and cleanup on every injected exit.
- [ ] T055 [US2] Add automated Chromium/Firefox/WebKit plus documented real-device browser matrix in `tests/pronunciation-recorder.spec.ts` and `specs/003-pronunciation-assessment/browser-matrix.md` — Requirements: FR-008–FR-016, SC-001, SC-004–SC-005; Verify: `pnpm test:e2e -- pronunciation-recorder.spec.ts` passes automated paths and the document leaves real iOS/Android evidence explicitly pending until executed.

**Checkpoint**: US2 works locally without live AI; server upload/scoring remains closed when approved audio/storage capabilities are absent.

---

## Phase 5: User Story 3 - 将有效结果纳入学习闭环 (Priority: P1)

**Goal**: Compute shadow learning changes and, only behind the approved write gate, atomically reuse `LearningAttempt`, review events and SM-2 exactly once.

**Independent Test**: A reliable owned result produces one deterministic pronunciation update; replay, low confidence, invalid/cancelled/source-expired results and injected transaction failures produce no inconsistent learning state.

### Tests for User Story 3

- [x] T056 [P] [US3] Write pronunciation score-to-quality and duplicate-position tests in `server/libs/learning/src/pronunciation/pronunciation-quality.policy.spec.ts` — Requirements: FR-052–FR-054, SC-008; Verify: existing thresholds map 90/75/60/40/positive/zero correctly, omitted maps zero and inserted/uncertain/unmapped words emit no evidence.
- [x] T057 [P] [US3] Write learning eligibility and shadow-mode tests in `server/libs/learning/src/pronunciation/pronunciation-learning-eligibility.spec.ts` — Requirements: FR-049–FR-054, FR-061, FR-076, SC-008; Verify: confidence `.79/.80`, source rights, schema, audio, cancellation and version gates are independently asserted.
- [x] T058 [P] [US3] Write atomicity/idempotency/race integration tests in `server/apps/ai/test/integration/pronunciation-learning.integration.spec.ts` — Requirements: FR-049–FR-057, FR-069–FR-070, SC-007–SC-008, SC-015; Verify: failure injection at each write step yields all-or-nothing and concurrent replay yields one attempt/event/budget settlement.

### Implementation for User Story 3

- [x] T059 [P] [US3] Implement the pinned `pronunciation-quality.v1` policy by reusing existing score thresholds and `SM2_V1` in `server/libs/learning/src/pronunciation/pronunciation-quality.policy.ts` — Requirements: FR-052–FR-054, FR-075; Verify: T056 passes and no vocabulary `WORD` state is mutated by pronunciation evidence.
- [x] T060 [US3] Implement deterministic learning eligibility and source/owner/version revalidation in `server/libs/learning/src/pronunciation/pronunciation-learning-eligibility.ts` — Requirements: FR-049, FR-052–FR-054, FR-059–FR-061, FR-069; Verify: T057 passes every independent rejection reason with no database write.
- [x] T061 [US3] Implement learning-shadow projection and privacy-safe diff Trace in `server/libs/learning/src/pronunciation/pronunciation-learning-shadow.service.ts` — Requirements: FR-048–FR-054, FR-058, FR-073–FR-075; Verify: `pronunciation-learning-shadow.service.spec.ts` computes expected changes while database item states remain byte-identical.
- [x] T062 [US3] Implement locked, atomic pronunciation `LearningAttempt`/review-event/item-state persistence in `server/libs/learning/src/pronunciation/pronunciation-learning.service.ts` — Requirements: FR-049–FR-057, FR-069–FR-070; Verify: T058 passes using `PRONUNCIATION_WORD` and creates no fake Exercise, Submission or CoachRequest.
- [x] T063 [US3] Export/register pronunciation learning services in `server/libs/learning/src/index.ts` and `server/libs/learning/src/learning.module.ts` — Requirements: FR-050–FR-051, FR-058, FR-088; Verify: server build plus existing `AttemptService`/review tests pass unchanged.
- [x] T064 [US3] Connect reliable result persistence to shadow/write gates and independent `learningWriteStatus` in `server/apps/ai/src/pronunciation/application/pronunciation-assessment.service.ts` — Requirements: FR-048–FR-057, FR-069–FR-070; Verify: T058 distinguishes assessment success, shadow proposal, saved result and retryable write failure.
- [x] T065 [US3] Render proposed/saved/not-eligible/failed mastery changes and next review dates in `apps/web/src/components/Pronunciation/PronunciationLearningUpdate.vue` — Requirements: FR-047–FR-048, FR-054–FR-055, SC-015; Verify: `PronunciationLearningUpdate.spec.ts` presents each state accurately and never claims an uncommitted update.
- [x] T066 [US3] Add flags-off and shadow/write regression coverage for current Coach attempts and review scheduling in `server/apps/ai/test/integration/pronunciation-learning-regression.spec.ts` — Requirements: FR-051, FR-088, SC-016; Verify: legacy attempt rows/results remain identical and closed gates generate zero pronunciation writes.

**Checkpoint**: US3 preserves one learning fact source; shadow precedes write and unsafe evidence never changes mastery.

---

## Phase 6: User Story 4 - 从 Coach 获得后续口语练习 (Priority: P2)

**Goal**: Expose a minimal owned structured assessment summary to Coach for grounded follow-up without audio access or scoring authority.

**Independent Test**: Coach explains retry/review/continue using one owned structured result; low-confidence/source-invalid cases degrade safely and attempts to select another subject or audio are rejected.

### Tests for User Story 4

- [x] T067 [P] [US4] Write context-only ownership/no-audio Coach tool tests in `server/apps/ai/src/coach/tools/get-pronunciation-summary.tool.spec.ts` — Requirements: FR-058–FR-060, FR-063, FR-065, SC-009–SC-010; Verify: tool input has only `assessmentId`, cross-owner access is indistinguishable from missing and output has no storage/audio fields.
- [x] T068 [P] [US4] Write recommendation grounding/degradation evaluation cases in `server/apps/ai/test/evals/pronunciation/coach-recommendation.eval.spec.ts` — Requirements: FR-033–FR-034, FR-058, FR-081, FR-087; Verify: reliable facts support the recommendation while low confidence/source invalidity always recommends safe retry/unavailable handling.

### Implementation for User Story 4

- [x] T069 [US4] Implement minimal owned assessment-summary projection in `server/libs/learning/src/pronunciation/pronunciation-context.service.ts` — Requirements: FR-048, FR-058–FR-061, FR-065; Verify: `pronunciation-context.service.spec.ts` returns only scores/tier/weak words/review changes/versions for non-hidden owned rows.
- [x] T070 [US4] Implement the read-only context-bound Coach tool in `server/apps/ai/src/coach/tools/get-pronunciation-summary.tool.ts` — Requirements: FR-058–FR-060, FR-063, FR-065; Verify: T067 passes and Prompt/tool arguments cannot override the execution subject.
- [x] T071 [US4] Register the tool and restrict its model-facing schema in `server/apps/ai/src/coach/coach.module.ts` and `server/apps/ai/src/coach/workflow/coach-model.gateway.ts` — Requirements: FR-026, FR-033–FR-034, FR-058, FR-072; Verify: existing Coach tool tests plus T067 show no raw audio/Provider response enters a Prompt or checkpoint.
- [x] T072 [US4] Revalidate RAG citation lifecycle before Coach reuses an assessment target in `server/libs/learning/src/pronunciation/pronunciation-context.service.ts` — Requirements: FR-007, FR-061, FR-064, FR-088; Verify: `pronunciation-rag-context.spec.ts` invalidates recommendations after citation/source/version/access revocation.
- [x] T073 [US4] Add the owned assessment-to-Coach action and structured context handoff in `apps/web/src/components/Pronunciation/PronunciationCoachAction.vue` — Requirements: FR-047, FR-058; Verify: `PronunciationCoachAction.spec.ts` sends only `assessmentId`, labels new Coach activity and handles unavailable sources.

**Checkpoint**: US4 is independently safe and grounded; Coach never receives audio or authority over deterministic assessment facts.

---

## Phase 7: User Story 5 - 管理个人录音与评测数据 (Priority: P2)

**Goal**: Provide owned history/playback plus distinct audio/full deletion with immediate revoke, bounded purge and auditable learning compensation.

**Independent Test**: Two-subject tests prove isolation; audio-only deletion retains result/history, while full deletion hides immediately, removes audio and recomputes remaining pronunciation learning evidence idempotently.

### Tests for User Story 5

- [x] T074 [P] [US5] Write two-subject read/stream/retry/cancel/delete attack tests in `server/apps/ai/test/security/pronunciation-ownership.security.spec.ts` — Requirements: FR-001, FR-059–FR-063, SC-009; Verify: every cross-owner success count is zero and responses match random-ID not-found behavior.
- [x] T075 [P] [US5] Write fake-clock retention/revocation/purge tests in `server/apps/ai/test/integration/pronunciation-retention.integration.spec.ts` — Requirements: FR-062, FR-065, FR-067–FR-068, SC-011; Verify: access revokes immediately, active copies purge within one hour and normal audio expires within 24 hours.
- [x] T076 [P] [US5] Write earliest/middle/latest evidence deletion-replay tests in `server/libs/learning/src/pronunciation/pronunciation-deletion.service.spec.ts` — Requirements: FR-055, FR-067, FR-074–FR-075; Verify: remaining events reproduce exact item state and one recalculation audit is written per item/deletion.

### Implementation for User Story 5

- [x] T077 [US5] Implement freshly authorized `private, no-store` audio streaming and range handling in `server/apps/ai/src/pronunciation/api/pronunciation-audio.controller.ts` — Requirements: FR-046, FR-060, FR-062, FR-068; Verify: T074/T075 cover owner, expiry, revoke and no permanent URL/object-key exposure.
- [x] T078 [US5] Implement audio/full deletion tombstone creation and immediate UI hiding/access revocation in `server/apps/ai/src/pronunciation/privacy/pronunciation-deletion.service.ts` — Requirements: FR-060, FR-067–FR-068, FR-070; Verify: `pronunciation-deletion.service.spec.ts` is idempotent for same key and persists no sensitive tombstone fields.
- [x] T079 [US5] Implement durable clustered purge claims/retries in `server/apps/ai/src/pronunciation/queue/pronunciation-cleanup.processor.ts` — Requirements: FR-067–FR-068, FR-073–FR-074; Verify: `pronunciation-cleanup.integration.spec.ts` runs two processors without double purge and recovers transient object-store failure before deadline.
- [x] T080 [US5] Implement review-event replay and `LearningStateRecalculationEvent` compensation in `server/libs/learning/src/pronunciation/pronunciation-deletion.service.ts` — Requirements: FR-055, FR-067, FR-075; Verify: T076 proves deterministic scheduler-version replay and leaves `COMPENSATING` retryable on failure.
- [x] T081 [US5] Emit private learning/RAG summary invalidation after successful compensation in `server/libs/learning/src/pronunciation/pronunciation-deletion.service.ts` and `server/libs/learning/src/knowledge/summaries/private-learning-summary.service.ts` — Requirements: FR-058, FR-067, FR-088; Verify: `pronunciation-summary-invalidation.integration.spec.ts` removes stale derived summaries only after the recalculation transaction commits.
- [x] T082 [US5] Implement audio-delete/full-delete/deletion-status endpoints in `server/apps/ai/src/pronunciation/api/pronunciation.controller.ts` — Requirements: FR-056, FR-060, FR-067–FR-068, FR-071; Verify: OpenAPI contract tests plus T074 cover idempotency, status and nondisclosure.
- [x] T083 [US5] Integrate pronunciation assets/assessments/tombstones into account deletion in `server/libs/learning/src/privacy/learning-data-deletion.service.ts` — Requirements: FR-067–FR-068; Verify: `learning-data-deletion.pronunciation.spec.ts` enumerates database, MinIO, cache, link and trace-subject cleanup rather than relying on database cascade alone.
- [x] T084 [US5] Implement owned history, authenticated playback, audio-only delete and full-delete controls in `apps/web/src/components/Pronunciation/PronunciationHistory.vue` — Requirements: FR-046–FR-048, FR-060, FR-062, FR-067–FR-068; Verify: `PronunciationHistory.spec.ts` distinguishes scopes, confirms destructive actions and removes revoked media object URLs.

**Checkpoint**: US5 meets owner isolation, immediate revoke and durable deletion/compensation obligations.

---

## Phase 8: User Story 6 - 在异常与供应商故障下安全恢复 (Priority: P2)

**Goal**: Provide bounded retry/cancellation/cost behavior, stable safe errors and complete privacy-aware observability under faults.

**Independent Test**: Inject network, corrupt audio, low confidence, no-match, timeout, 429, 5xx, malformed response, crash and cancellation; each case has the right retry/cost/write behavior and one redacted trace.

### Tests for User Story 6

- [x] T085 [P] [US6] Write Provider timeout/429/5xx/no-match/malformed/unknown-acceptance tests in `server/apps/ai/test/integration/pronunciation-provider.integration.spec.ts` — Requirements: FR-025–FR-026, FR-032, FR-041, FR-057, FR-070–FR-076; Verify: `pnpm --filter @en/server test -- --runInBand apps/ai/test/integration/pronunciation-provider.integration.spec.ts` proves only safe non-acceptance/idempotent cases may attempt twice.
- [x] T086 [P] [US6] Write concurrency/rate/budget reservation and settlement race tests in `server/apps/ai/test/integration/pronunciation-governance.integration.spec.ts` — Requirements: FR-022, FR-057, FR-069, FR-073, FR-076; Verify: exact 1-active, 6/minute, 120/day and four-budget caps hold under parallel requests.
- [x] T087 [P] [US6] Write cancellation boundary/late-result tests in `server/apps/ai/test/integration/pronunciation-cancel-races.integration.spec.ts` — Requirements: FR-021, FR-054, FR-057, FR-069–FR-070, FR-085; Verify: cancellation at upload/queue/Provider/result/write yields zero late learning writes and audits unavoidable cost.
- [x] T088 [P] [US6] Write Trace/log/error leakage scans in `server/apps/ai/test/security/pronunciation-observability.security.spec.ts` — Requirements: FR-035, FR-063, FR-065–FR-066, FR-072–FR-074, SC-010; Verify: forbidden secret/identity/text/audio/storage/raw-response patterns occur zero times.

### Implementation for User Story 6

- [x] T089 [US6] Implement Provider-call attempt ledger, unknown-acceptance decision and bounded retry orchestration in `server/apps/ai/src/pronunciation/provider/pronunciation-provider.executor.ts` — Requirements: FR-025, FR-057, FR-069–FR-070, FR-073–FR-076; Verify: T085 proves normal calls=1, allowed automatic retries≤1 and every potentially billable attempt is unique/audited.
- [x] T090 [US6] Implement cost reservation→actual-duration settlement and replay-safe reconciliation in `server/apps/ai/src/pronunciation/governance/pronunciation-cost-meter.ts` — Requirements: FR-022, FR-057, FR-073, FR-075–FR-076; Verify: T086 proves no duplicate deduction, unknown price closes calls and potential cost remains visible after unknown acceptance.
- [x] T091 [US6] Enforce durable deadline/cancel/source/gate checks at upload, queue, pre-Provider, post-Provider and pre-learning boundaries in `server/apps/ai/src/pronunciation/application/pronunciation-assessment.service.ts` — Requirements: FR-007, FR-021–FR-022, FR-054, FR-069–FR-070, FR-076; Verify: T087 plus `pronunciation-deadline.spec.ts` force every >30-second call to timeout with no learning write.
- [x] T092 [US6] Implement safe retry endpoint lineage and retry-after projection in `server/apps/ai/src/pronunciation/application/pronunciation-retry.service.ts` — Requirements: FR-025, FR-047, FR-056–FR-057, FR-071; Verify: `pronunciation-retry.service.spec.ts` creates a new linked assessment for user retry and never overwrites prior history.
- [x] T093 [US6] Implement privacy-safe Trace step completion, latency/cost/version aggregation and owned operational query in `server/apps/ai/src/pronunciation/observability/pronunciation-trace-query.service.ts` — Requirements: FR-073–FR-075, SC-005, SC-010; Verify: `pronunciation-trace-query.service.spec.ts` returns 100% required dimensions with no sensitive fields or cross-owner access.
- [x] T094 [US6] Implement category-specific, actionable Web failure/retry messages in `apps/web/src/stores/pronunciation.ts` and `apps/web/src/components/Pronunciation/PronunciationFailure.vue` — Requirements: FR-014, FR-025, FR-041, FR-047, FR-071–FR-072, SC-004; Verify: `PronunciationFailure.spec.ts` covers browser/device/upload/audio/queue/governance/Provider/learning categories and hides internal details.
- [x] T095 [US6] Add queue crash/replay/dead-letter recovery tests in `server/apps/ai/test/integration/pronunciation-recovery.integration.spec.ts` — Requirements: FR-057, FR-069–FR-074, SC-007, SC-017; Verify: repeated worker execution cannot duplicate Provider calls, result writes, learning events, costs or Trace terminalization.

**Checkpoint**: US6 remains predictable under every specified fault and produces useful but non-sensitive operational evidence.

---

## Phase 9: AI Evaluation, release gates and cross-cutting validation

**Purpose**: Build the required evaluation/cost/observability evidence and verify progressive rollout without authorizing production enablement.

- [x] T096 [P] Create the strict authorization-aware evaluation-case schema and fixture loader in `server/apps/ai/test/evals/pronunciation/pronunciation-eval-case.schema.ts` — Requirements: FR-066, FR-077–FR-081; Verify: `pronunciation-eval-case.schema.spec.ts` rejects missing provenance/use/deletion/annotation/version data and any inferred sensitive trait.
- [x] T097 [P] Create versioned synthetic fixtures plus an empty authorized-human manifest in `server/apps/ai/test/evals/pronunciation/fixtures/manifest.jsonl` and `README.md` without adding real learner audio — Requirements: FR-066, FR-077–FR-079; Verify: loader validates 100% of fixtures and documents human/live cases as pending approval rather than fabricated.
- [x] T098 Implement deterministic WER, per-error precision/recall/F1, timestamp MAE/P95, score agreement, repeat drift, reject TPR/FPR and accent residual metrics in `server/apps/ai/test/evals/pronunciation/pronunciation-metrics.ts` — Requirements: FR-080–FR-084, SC-012–SC-013, SC-017–SC-018; Verify: `pronunciation-metrics.spec.ts` checks hand-calculated fixtures including WER greater than 1.
- [x] T099 Implement an evaluation runner that records dataset/provider/model/rule/schema/normalization/budget/price versions in `server/apps/ai/test/evals/pronunciation/pronunciation-evaluation.runner.ts` — Requirements: FR-073–FR-075, FR-077–FR-084; Verify: `pronunciation-evaluation.runner.spec.ts` produces deterministic JSON from fake Provider data and refuses live mode without every approval and a positive test budget.
- [x] T100 Add independent release-gate evaluation for success≥99%, repeat max delta≤5, accent residual gap≤5, P95≤15s and zero-tolerance failures in `server/apps/ai/test/evals/pronunciation/pronunciation-release-gates.spec.ts` — Requirements: FR-082–FR-087, SC-005, SC-009–SC-013, SC-017–SC-018; Verify: each gate fails independently on a violating fixture and no composite score can hide a blocker.
- [x] T101 [P] Add cost report generation by Provider/region/capability/version and per-call/subject-day/system-day/system-month budget evidence in `server/apps/ai/test/evals/pronunciation/pronunciation-cost-report.spec.ts` — Requirements: FR-022, FR-073, FR-075–FR-076, FR-082–FR-086; Verify: report marks unknown/unapproved prices as blocked, separates optional prosody and reconciles every Provider-call ledger row.
- [x] T102 [P] Add observability completeness/redaction report generation in `server/apps/ai/test/evals/pronunciation/pronunciation-observability-report.spec.ts` — Requirements: FR-035, FR-065, FR-072–FR-075, SC-010; Verify: 100% trace linkage is required and any forbidden field makes the report fail.
- [x] T103 Add flags-off and progressive-gate regression suites in `server/apps/ai/test/integration/pronunciation-rollout.integration.spec.ts` and `apps/web/src/stores/__tests__/pronunciation-rollout.spec.ts` — Requirements: FR-076, FR-084–FR-088, SC-013, SC-016; Verify: each stage enables only its documented behavior and rollback prevents new calls/writes while cleanup continues.
- [x] T104 Run existing server/Coach/RAG/learning and Web regression commands and record actual outputs in `specs/003-pronunciation-assessment/implementation-evidence.md` — Requirements: FR-088, SC-016; Verify: `pnpm --filter @en/server test`, `pnpm --filter @en/web test:unit`, both builds and `pnpm test:e2e` results are copied as factual pass/fail evidence, never inferred.
- [x] T105 Run the synthetic/fake quickstart matrix and record exact environment, commands, versions, latency and cost results in `specs/003-pronunciation-assessment/implementation-evidence.md` — Requirements: FR-073–FR-086, SC-002–SC-013, SC-017–SC-018; Verify: every reported metric links to an executed test/result and unexecuted live/browser/human checks remain explicitly pending.
- [x] T106 Update `specs/003-pronunciation-assessment/requirements-traceability.md` with task IDs, final code paths, test/evaluation evidence and deviations — Requirements: FR-001–FR-088, SC-001–SC-018; Verify: an automated ID scan proves every FR and SC maps to at least one task and one planned/executed verification artifact.
- [x] T107 Review `package.json`, `server/package.json`, `apps/web/package.json`, `pnpm-lock.yaml`, `server/Dockerfile`, `server/ecosystem.config.js` and environment diffs for unauthorized changes — Requirements: FR-064, FR-066, FR-076–FR-078, FR-088; Verify: implementation evidence records zero unauthorized dependency/configuration/live-data/push/deploy action.
- [x] T108 Re-run all commands in `specs/003-pronunciation-assessment/quickstart.md` and publish a final gated status in `specs/003-pronunciation-assessment/implementation-evidence.md` — Requirements: FR-077–FR-088, SC-001–SC-018; Verify: the final status distinguishes implemented, tested, evaluated, externally blocked and not-run work without claiming production readiness.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 Setup** has no dependency and changes only shared contracts/default-off scaffolding and evidence.
- **Phase 2 Foundational** depends on Phase 1 and blocks all user stories.
- **US1** and **US2** depend on Phase 2. US1 is independently testable with fixture audio/fake Provider; US2 is independently testable as local recording.
- **US3** depends on US1 durable validated results; shadow projection precedes persistent write.
- **US4** depends on US1 structured results and may use US3 learning facts when available, but low-confidence retry guidance remains independently testable.
- **US5** depends on Phase 2 durable audio/deletion records and US3 only for learning compensation.
- **US6** depends on US1 external-call orchestration and Phase 2 governance; its test files can proceed alongside US3–US5.
- **Phase 9** depends on all desired story slices and must pass before advancing any corresponding rollout gate.

### User-story dependency graph

```text
Setup → Foundational ┬→ US1 Structured Assessment ─┬→ US3 Learning Loop ─┬→ US4 Coach Follow-up
                     │                             │                     └→ US5 Full Compensation
                     ├→ US2 Safe Recorder ─────────┘
                     └→ US6 Fault/Governance (after US1 call boundary)

US1 + US2 + US3 + US4 + US5 + US6 → AI Evaluation / Cost / Observability / Release Gates
```

### Within each user story

- Write and run the listed tests first; confirm they fail for the missing behavior.
- Implement deterministic domain/schema logic before orchestration, endpoints and UI.
- Re-run the story's focused tests at its checkpoint.
- Do not open a runtime rollout gate merely because code/tests exist; require its separate approval evidence.

## Parallel Opportunities

### US1

```text
T023 API contracts | T024 Provider contract | T025 alignment evaluation | T026 Web result tests
After target foundations: T030 alignment policy | T031 confidence policy | T037 Web API | T038 Web store
```

### US2

```text
T042 recorder hook tests | T043 recorder UI tests | T044 audio security tests | T045 storage tests
After tests: T046 browser capability detector | T050 private storage adapter | T052 audio quality policy
```

### US3

```text
T056 quality mapping tests | T057 eligibility/shadow tests | T058 transaction/race tests
After test contracts: T059 quality policy can proceed separately from T061 shadow projection
```

### US4

```text
T067 Coach tool isolation tests | T068 recommendation evaluation
After context service: T071 Coach registration and T073 Web action touch separate applications
```

### US5

```text
T074 ownership attacks | T075 retention clock tests | T076 compensation replay tests
After deletion domain: T077 streaming, T079 cleanup processor and T084 Web history are separate files
```

### US6 and evaluation

```text
T085 Provider faults | T086 governance races | T087 cancellation races | T088 leakage scans
T096 evaluation schema | T097 fixture manifest | T101 cost report | T102 observability report
```

## Implementation Strategy

### Suggested MVP

1. Complete Setup and Foundational with every gate closed.
2. Complete US1 using fixture audio and the fake Provider: this is the independently testable backend/result MVP.
3. Complete US2 for the first user-facing MVP: local browser recording plus private fake-capable pipeline.
4. Stop and validate before adding shadow learning, write, Coach or live Provider behavior.

### Incremental rollout alignment

1. Stage 0: default-off regression.
2. Stage 1: local-only recording (US2 client slice).
3. Stage 2: private pipeline with fake Provider (US1 + US2).
4. Stage 3: approved Provider shadow (US6 cost/observability gates required).
5. Stage 4: result display after quality/usability/fairness approval.
6. Stage 5: US3 learning shadow.
7. Stage 6: US3 persistent learning write after atomicity/compensation approval.
8. Stage 7: US4 Coach follow-up; US5/US6 remain mandatory lifecycle/operations coverage.

## Notes

- `[P]` marks file-level parallelism only; shared-schema and shared-service dependencies still apply.
- Every live Provider/audio-runtime/private-storage/human-dataset task is conditional on explicit approval and must have a fake/unavailable path.
- Test commands use the repository's existing Jest, Vitest and Playwright dependencies.
- This Tasks artifact does not modify implementation code, dependencies, production configuration or external systems.

## 2026-09-14 实现收敛任务

- [x] T110 运行配置与条件适配器工厂；认证能力接口和缺配置测试（FR-089–091）。
- [x] T111 生产 Redis 预算/提交治理和 Provider 调用台账连接，验证并发及重复结算（FR-057、069、073–076）。
- [x] T112 队列评测执行器、deadline/取消/来源检查、结果与学习保存；完整成功/失败/重投测试（FR-024–041、049–057、070、089）。
- [x] T113 注册队列、outbox 调度、超时与学习保存恢复、过期音频/删除补偿调度（FR-067–070、089、091）。
- [x] T114 独立发音页、导航、手动目标与服务状态，连接词库/Coach 入口；历史分页、结果、回放和删除（FR-008–016、042–048、060–068、090）。
- [x] T115 修复真实转码/存储接线暴露的媒体边界；配置模板与本地检查/运行指南（FR-017–022、064、068、091）。
- [x] T116 运行发音专项、模块集成、浏览器、质量评测和全量回归，记录真实环境限制与剩余依赖（FR-077–080）。

本轮本地验收记录：`docs/reviews/2026-09-14-pronunciation-completion.md`。T110–T116 完成指代码接通和本地验证；真实 Azure / MinIO / ffmpeg 环境验收尚缺配置，未将此前 live 发布条件标记通过。

- [x] T117 支持 Azure 门户区域基础终结点、保留资源名兼容，更新配置检查与指南，验证区域一致性和请求地址（FR-092）。专项 3 套测试共 37 项通过，AI TypeScript 检查通过；未调用真实 Azure。

- [x] T118 完成本机 MinIO/Redis 与实体 ffmpeg 依赖验证，修复 MinIO 单条 lifecycle Rule 对象兼容（FR-018、064、068、091）。私有读写/删除、匿名拒绝、过期规则、WebM/MP4 转码、静音/损坏文件检查、Redis 持久化配置通过；相关 18 项测试及类型检查通过。Azure 仅认证成功，未执行真实评分或开启功能。

- [x] T119 实现 Azure managed 模型身份与 F0 配置解析，移除不可实现的身份要求并保留真实可追溯语义（FR-093）。
- [x] T120 接通时长配额和资源并发锁，验证原子预留、重复调用、取消退款、未知受理和 F0 零价格边界（FR-094）。
- [x] T121 装配独立本地业务数据库、认证与队列，完成真实 Azure/存储/转码/历史回放删除的 HTTP 验证（FR-095）。
- [x] T122 回归相关服务端、浏览器与质量测试，更新运行配置、检查工具和实际验收记录（FR-093–095）。

T119–T122 实测记录：`docs/reviews/2026-09-15-pronunciation-live.md`。新增条款已统一编号为 FR-089–095，避免与原有质量、安全要求 FR-081–088 重号；原有要求不删除。
