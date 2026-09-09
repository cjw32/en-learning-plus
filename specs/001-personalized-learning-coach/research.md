# Phase 0 Research: 个性化英语学习 Coach

**Feature**: `001-personalized-learning-coach`  
**Date**: 2026-09-02  
**Purpose**: Resolve the specification's open product decisions and the technical unknowns that affect architecture, contracts, privacy, evaluation, and compatibility.

## R-001 — Use one controlled LangGraph workflow, not a free ReAct loop

**Decision**: Implement Coach as one `StateGraph` with explicit state, named nodes, conditional edges, terminal states, and step guards. The graph contains deterministic nodes for input validation, authorization context loading, intent routing, tool gating, write eligibility, budget checks, cancellation, final validation, and fallback. LLM nodes are limited to intent classification, explanation/exercise generation, grading, and recommendation. Business code—not the model—chooses which internal tool node may run and is the only authority that can enter `save_attempt`.

**Rationale**:

- The specification requires a controlled and traceable workflow and explicitly rejects arbitrary model action.
- LangGraph's official Graph API defines state, nodes, and edges as separate control primitives and allows nodes to be ordinary code or model calls. This supports deterministic authorization and write gates around probabilistic generation: [LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api).
- A single graph is not a multi-Agent system and remains inside the feature's stated scope.

**Alternatives considered**:

- Continue using `createAgent` as an unrestricted tool loop: rejected because the model could choose the wrong tool, repeat calls, or attempt a write out of order.
- Hand-build a workflow without LangGraph: workable, but it would duplicate checkpoint, state, and streaming concepts already present in the repository's LangChain stack.
- Multi-Agent orchestration: explicitly out of scope.

## R-002 — Authenticate every Coach surface and keep identity out of model schemas

**Decision**: Apply the existing server-side JWT verification semantics to request creation, event streaming, history, retry, cancellation, feedback, and deletion. Construct an immutable `CoachExecutionContext` from the verified access token. It contains the internal user ID, request ID, conversation ID, deadline, budget policy, and trace ID. Tool schemas never contain `userId`; tools receive the execution context out of band and every domain service query scopes by its authenticated user ID.

**Rationale**:

- The current generic AI endpoints trust a client `userId`; that is the exact cross-user risk the feature must remove.
- Keeping identity out of prompts and tool arguments makes injected or model-generated user identifiers non-authoritative by construction.
- The existing `AuthGuard` and shared JWT module are reusable starting points.

**Alternatives considered**:

- Accept `userId` and compare it with the JWT: rejected because it preserves an unnecessary attack surface.
- Let the main server mint a second internal identity token for AI: rejected for v1 because both Nest applications can share the same verified JWT semantics and domain library.

## R-003 — Extract a reusable learning-domain library behind existing services

**Decision**: Add a focused Nest library at `server/libs/learning/`. It owns learner profile, learning-material, exercise, grading persistence, mastery/review, and attempt transaction services. Existing `UserService`, `WordBookService`, `CourseService`, and `LearnService` keep their public behavior but delegate reusable learning queries/writes to this library where relevant. Coach tool adapters call the library services; tool implementations never use Prisma directly.

**Rationale**:

- `en-server` and `en-ai` are separate Nest applications in one monorepo. A shared domain library allows both to reuse the same business rules without internal HTTP calls or cross-app controller imports.
- Existing modules do not export their services and do not expose most required capabilities. A narrow library avoids making the AI app depend on another app's controllers.
- Prisma remains inside business services, satisfying the specification's “no direct unbounded database tool” rule.

**Alternatives considered**:

- Import `apps/server` modules into `apps/ai`: rejected because it couples one deployable application to another application's controllers and module graph.
- Create internal HTTP endpoints from AI to server: rejected because it adds service-to-service authentication, latency, and partial-failure paths without providing value in the current monorepo.
- Put all new logic in `libs/shared`: rejected because the existing shared library already contains infrastructure; a separate learning domain keeps business authority identifiable and testable.

## R-004 — Make Zod the runtime source of truth and export JSON Schema

**Decision**: Define versioned Coach request, SSE event, tool input/output, exercise, grading, citation, and final-result schemas in `packages/common/coach/` with Zod. Infer TypeScript types from those schemas for both server and Vue. Export JSON Schema from the same definitions for contract fixtures and offline validators. Add `zod` as an explicit workspace dependency rather than relying on the current transitive copy.

**Rationale**:

- The server and Vue already share `@en/common`, so a single runtime/type contract avoids backend/frontend drift.
- LangChain v1 accepts Zod or JSON Schema for structured output and validates the returned object: [LangChain structured output](https://docs.langchain.com/oss/javascript/langchain/structured-output).
- The currently installed LangChain dependency brings Zod transitively, but direct application use must declare it explicitly.

**Alternatives considered**:

- Hand-maintained TypeScript interfaces plus separate JSON Schema: rejected because two sources of truth will drift.
- Trust provider-native JSON mode: rejected because provider support and strictness can vary; local validation remains mandatory.
- Parse free text heuristically: rejected by the specification.

## R-005 — First-version level authority is user-declared CEFR

**Decision**: Add an optional user-editable CEFR level (`A1`–`C2`) and learning goal to the learner profile. `levelSource` is `USER_DECLARED` in v1. An optional active course must be one of the user's purchased courses. Recent performance may adapt the current response or exercise difficulty by one bounded step, but it never silently rewrites the declared CEFR level. If the level is absent, Coach reports limited personalization and uses the active course/known vocabulary only; it does not invent a level.

**Rationale**:

- The repository has no placement test or trustworthy historic attempt data.
- A self-declared level is the smallest capability that unlocks transparent personalization and lets the user correct a wrong profile.
- Automatic level inference would require its own validity study, UX, confidence model, and appeal/correction rules, broadening v1.

**Alternatives considered**:

- Placement test: deferred; no current test content or scoring capability exists.
- Fully inferred level: rejected for v1 because current data is insufficient and silent changes would be hard to explain.
- Default every learner to A2/B1: rejected because it fabricates a fact.

## R-006 — Use an auditable SM-2-based review schedule separate from legacy `isMaster`

**Decision**:

1. Create a new per-user `LearningItemState` for `WORD` and controlled `ERROR_TYPE` targets.
2. Store `reviewState`, `repetitionCount`, `easeFactor`, `intervalDays`, `dueAt`, `lastReviewedAt`, and the last quality grade.
3. Convert each graded target result to quality `q`:
   - `5`: 100%, correct without hint or correction.
   - `4`: 80–99%, or correct after self-correction.
   - `3`: 60–79%, demonstrating recall with material difficulty.
   - `2`: 40–59%.
   - `1`: 1–39%.
   - `0`: 0%, blank, or ungradable.
4. Use the published SM-2 rules: initial E-Factor 2.5, minimum 1.3; successful intervals 1 day, 6 days, then `ceil(previousInterval × E-Factor)`; `q < 3` resets the repetition sequence and schedules the first interval. The formula and reset behavior come from SuperMemo's published algorithm: [Algorithm SM-2](https://www-beta.supermemo.com/en/articles/history).
5. Derive display state as:
   - `NEW`: no saved Coach/legacy review state.
   - `LEARNING`: no successful repetition or latest `q < 3`.
   - `REVIEW`: at least one successful repetition.
   - `MASTERED`: at least three successful repetitions, latest `q >= 4`, and current interval at least 30 days.
6. `q < 4` also recommends immediate practice, but it does not create a second write until the learner actually submits another answer.

**Compatibility decision**:

- `WordBookRecord.isMaster` remains the legacy “completed in the existing word-learning flow” flag and is never silently cleared by Coach.
- `User.wordNumber` remains the legacy completed-word counter and is not incremented by Coach attempts.
- The legacy `saveWordMaster` transaction will also initialize/update `LearningItemState`, so future legacy learning participates in review.
- A one-time backfill creates an initial review state for existing mastered word records; it does not alter the original records.

**Rationale**:

- A separate state prevents Coach from changing established legacy behavior and makes review history auditable.
- SM-2 is deterministic, transparent, implementable without a proprietary service, and suitable as a v1 baseline. Newer algorithms may be evaluated later using accumulated history.

**Alternatives considered**:

- Reinterpret or toggle `isMaster`: rejected because it would change current word-list exclusion and counters.
- Fixed handcrafted intervals: rejected because they are less adaptive and harder to justify.
- FSRS or a learned scheduler: deferred until enough clean repetition history exists and can be evaluated.

## R-007 — Adopt privacy-minimizing retention defaults

**Decision**:

| Data class | Default lifecycle | User deletion behavior |
|------------|-------------------|------------------------|
| Learner profile, attempts, review events, current item states | Retain while the account exists because they are core learning data. | Remove from active use immediately; physical primary-store purge within 24 hours. |
| Coach conversations and messages | 90 days from last activity unless the user deletes earlier. | Delete domain messages and invoke `PostgresSaver.deleteThread()` within 24 hours. |
| Redis event replay buffer and cancellation keys | 1 hour after request completion; cancellation/idempotency status without content may remain 24 hours for reconciliation. | Delete immediately when the owning conversation/request is deleted. |
| Trace metadata without raw prompt/response | 180 days. | Delete the subject mapping immediately, making remaining aggregate metadata unlinkable; expire metadata at 180 days. |
| Diagnostic content sample | Disabled by default. If explicitly enabled for an incident, it must be redacted and expires after 7 days. | Purge immediately. |
| User feedback text | 180 days or until user deletion. | Purge text and user link; anonymous aggregate counts may remain. |
| Offline evaluation samples | V1 contains synthetic or hand-authored cases only and is versioned with the repository. Direct production conversations are prohibited. | Not user-linked; no user deletion action required. |

Backups must follow the infrastructure backup expiry policy and must not be restored into active Coach use after a deletion tombstone. A deletion tombstone is retained without content until all relevant backup windows have elapsed.

**Rationale**:

- This supports multi-turn use and operational regression analysis while minimizing raw content.
- The local Postgres checkpointer exposes `deleteThread(threadId)`, so conversation deletion can remove durable graph state.
- Prohibiting direct production conversations in v1 evaluation avoids ambiguous consent and cross-environment leakage.

**Alternatives considered**:

- Indefinite conversation/trace retention: rejected by least-data requirements.
- Store raw prompts and responses in every Trace: rejected; hashes, versions, counters, result types, and error categories are sufficient by default.
- Immediately discard all conversation state: rejected because multi-turn interaction is required.

## R-008 — Keep domain history authoritative; use checkpointer only for workflow state

**Decision**: Store user-visible conversation messages, final results, exercises, attempts, and request states in the primary application database. Use `PostgresSaver` in the AI database for resumable graph checkpoints under a server-generated opaque thread ID. Maintain the thread ID mapping in `CoachConversation`; never derive it from a client user ID. Domain history drives the UI and authorization. Checkpoint state is internal, deletable, and never returned directly.

**Rationale**:

- The existing checkpointer supports durable workflows and `deleteThread`, but its generic state is not a suitable authorized public history API.
- A domain history record provides ownership, retention, redaction, and versioned final-result guarantees.

**Alternatives considered**:

- Continue reading messages directly from checkpointer channel values: rejected because it lacks domain ownership and output-version guarantees.
- Remove checkpoints: rejected because recovery and multi-step workflow state are required.

## R-009 — Execute Coach requests through BullMQ and stream Redis events

**Decision**:

1. The authenticated API creates an idempotent `CoachRequest` and enqueues a BullMQ job using `requestId` as the job ID.
2. A Coach processor runs the graph and publishes versioned events to a Redis Stream keyed by request ID.
3. Authenticated SSE consumers can connect to any PM2 instance and resume after the last event sequence.
4. Final validated results are persisted in the primary database before `completed`.
5. Cancellation updates durable request state, publishes a Redis cancellation signal, and aborts model/runnable calls with `AbortSignal`.

Add `ioredis` as an explicit server dependency for streams, distributed counters, cancellation signals, and rate limits. Existing BullMQ/Redis infrastructure is reused.

**Rationale**:

- Both server applications run in PM2 cluster mode. In-memory cancellation, rate limits, and event replay would break when requests hit different instances.
- The current `fetch-event-source` client accepts `AbortSignal`, and LangChain runnable configuration also exposes `signal`.
- A queue makes HTTP request creation fast, gives deterministic job deduplication, and supports recovery without keeping the initiating connection tied to one worker.

**Alternatives considered**:

- Stream directly from the POST handler: rejected because reconnection and cross-instance cancellation become fragile.
- Persist every token event in PostgreSQL: rejected due write amplification; only final results and trace summaries belong in durable storage.
- Add a new message broker: rejected because Redis/BullMQ already exists.

## R-010 — Use database uniqueness as the write idempotency authority

**Decision**: Require client idempotency keys for logical request creation and answer submission, but bind and validate them server-side. Enforce unique database constraints for `(userId, clientRequestKey)` and `(userId, exerciseId, answerVersion)`. `save_attempt` runs one primary-database transaction that:

1. Verifies user ownership and exercise state.
2. Verifies the grading hash matches the submitted answer version.
3. Inserts the attempt or returns the existing attempt.
4. Appends per-target review events.
5. Updates current item states.
6. Marks the exercise/request saved.

Redis may cache completion, but the database result is authoritative.

**Rationale**:

- Queue job IDs and Redis keys help operational deduplication but cannot guarantee learning-record correctness after eviction or restart.
- A single transaction and unique constraints satisfy all-or-nothing and retry requirements.

**Alternatives considered**:

- Redis-only idempotency: rejected because cache loss could duplicate learning records.
- Trust a client “already saved” flag: rejected because it is not authoritative.

## R-011 — Keep material retrieval provider-neutral and non-vector in v1

**Decision**: Implement `LearningMaterialProvider` with a stable `search()` result contract. V1 providers are:

- Existing `WordBook` dictionary and exam-tag search.
- Existing `Course` metadata plus purchased-course filtering.
- A grammar provider only when an approved structured grammar source exists; until then it returns `DATA_NOT_AVAILABLE`.

Every result has a stable source ID, type, title, safe locator, support summary, access scope, and freshness. No web-search result is labeled RAG. A future pgvector provider must implement the same interface and citation contract.

**Rationale**:

- The repository has rich word data but no grammar corpus or course lessons.
- A provider boundary preserves future RAG replacement without pretending that a vector corpus exists now.

**Alternatives considered**:

- Use the existing public web search as learning RAG: rejected because it has no ingestion, embeddings, access filtering, or stable material identity.
- Add pgvector now: explicitly out of scope.

## R-012 — Use small, versioned prompts per model node

**Decision**: Keep prompt templates in a Coach prompt registry with semantic versions and content hashes. Each LLM node receives only its task-specific prompt, validated input, minimum learner snapshot, and authorized citations. Use the existing DeepSeek chat integration by default. The reasoner model is not automatically selected for Coach v1; it may be enabled only by an explicit budgeted policy after evaluation. Raw reasoning content is never streamed or stored as user-visible output.

**Rationale**:

- Small prompts reduce token cost and prompt-injection surface.
- Node-specific structured calls are easier to evaluate than one general persona prompt.
- The current app exposes reasoning text; the Coach must not repeat that behavior.

**Alternatives considered**:

- One large system prompt controlling every step: rejected because it obscures authority and increases output/tool errors.
- Automatically use the reasoner for grading: rejected until latency, cost, and quality evidence justifies it.

## R-013 — Persist first-party trace metadata; do not require an external observability product

**Decision**: Add `CoachTrace`, `CoachStepTrace`, and `CoachFeedback` domain records for the required queryable metadata. Capture model and tool metrics through LangChain callbacks and explicit step instrumentation. Store a random trace subject identifier mapped to the user separately; deleting the mapping makes retained metadata unlinkable. Structured logs mirror IDs and result categories but exclude content and secrets.

**Rationale**:

- The project has no current AI observability platform.
- First-party metadata satisfies traceability without sending learner data to another vendor or expanding scope to an operations dashboard.

**Alternatives considered**:

- Require LangSmith or another hosted tracer: rejected for v1 due privacy, cost, and new operational dependency.
- Log only to console: rejected because traces must be queryable and correlated with feedback.

## R-014 — Baseline first, then make budgets mandatory configuration

**Decision**: Define a versioned `CoachBudgetPolicy` with required limits for input/output tokens, estimated cost, model calls, tool calls, per-tool time, total wall time, retries, and concurrent requests. Implement the policy and measurements with conservative test values, then run the approved 50–100-case baseline against the existing generic AI and the candidate Coach in the same environment. Production Coach startup/write enablement fails closed until owners approve explicit policy values and relative regression tolerance from that baseline.

**Rationale**:

- The specification forbids invented performance/cost claims and the repository has no baseline.
- Making configuration mandatory prevents “measure later” from becoming an unbounded production default.

**Alternatives considered**:

- Hard-code guessed production budgets in the Plan: rejected because no evidence supports them.
- Leave budgets optional: rejected because the specification requires safe termination.

## R-015 — Split deterministic gates from scored AI quality evaluation

**Decision**:

- Store 50–100 versioned cases under `server/apps/ai/test/evals/fixtures/`.
- Run schema, auth, ownership, tool order, parameter, citation existence, write gate, idempotency, redaction, timeout, and fallback checks deterministically with Jest.
- Run language correctness, CEFR fit, exercise targeting, grading reasonableness, error classification, and recommendation quality with reference rubrics. Human review is authoritative for release disputes; an independent judge model may accelerate scoring but its version and rubric are recorded.
- Run deterministic gates in CI with mocked model/tool fixtures. Run live-model quality, latency, tokens, and cost for release candidates and prompt/model changes.
- Save evaluation summaries without learner identifiers and link online failures through trace/result version, not copied production conversation text.

**Rationale**:

- Probabilistic quality cannot be reduced to schema checks, while security and write safety must not depend on a model judge.
- This matches the specification's zero-failure safety gate and baseline-relative quality rule.

**Alternatives considered**:

- Judge everything with another model: rejected for security gates and reproducibility.
- Manual-only evaluation: rejected because it is too slow for every contract regression.

## R-016 — Add only dependencies required by the design

**Decision**: Plan the following explicit dependency changes for the later Implement phase; do not install them during Plan:

- Server/runtime: `@langchain/langgraph` (currently transitive but not directly importable), `ioredis`.
- Shared contract package: `zod`.
- Web testing: `vitest`, `@vue/test-utils`.
- Browser end-to-end testing: `@playwright/test`.

Reuse existing NestJS, Prisma, LangChain, DeepSeek, BullMQ, Redis, PostgreSQL, Jest, Supertest, Vue, Pinia, and `@microsoft/fetch-event-source`.

**Rationale**:

- Each proposed dependency closes an explicit requirement gap.
- Direct declarations avoid relying on transitive dependencies.

**Alternatives considered**:

- Add an agent/observability/vector framework bundle: rejected as unnecessary and outside scope.
- Skip frontend/browser automation: rejected because cancel, reconnect, retry, and event-state behavior require executable evidence.

## R-017 — Backfill legacy word state before enabling Coach writes

**Decision**: Add one migration/backfill that creates `LearningItemState` for every existing `WordBookRecord.isMaster=true`:

- `targetType=WORD`, `targetKey=wordId`
- `reviewState=REVIEW`
- `repetitionCount=1`
- `easeFactor=2.5`
- `intervalDays=1`
- `lastReviewedAt=WordBookRecord.updatedAt`
- `dueAt=max(updatedAt + 1 day, rollout timestamp)`

The rollout timestamp is fixed in the migration so reruns are deterministic. `get_due_words` applies a configured daily result cap and stable priority ordering, preventing an unbounded first-day response. The backfill never modifies `WordBookRecord` or `User.wordNumber`.

**Rationale**:

- A read-only tool must not create state lazily.
- Backfill makes existing learned words eligible for the new review loop without changing legacy semantics.

**Alternatives considered**:

- Lazy state creation inside `get_due_words`: rejected because a read tool would have a hidden write.
- Treat all legacy words as permanently mastered: rejected because it would not create a review loop.

## Resolved Clarifications

| Specification marker | Resolution |
|----------------------|------------|
| FR-015 learner level authority | User-declared CEFR and goal are authoritative in v1; adaptive difficulty does not silently change the level. |
| FR-060 retention/deletion | Use the lifecycle table in R-007, with no raw production conversations in v1 evaluation. |
| FR-065 mastery/review semantics | New SM-2-based `LearningItemState`; legacy `isMaster`/`wordNumber` remain compatible and are not overwritten by Coach. |

No `NEEDS CLARIFICATION` items remain for design. Production budget numbers remain intentionally baseline-derived, with a fail-closed configuration gate rather than an unknown requirement.
