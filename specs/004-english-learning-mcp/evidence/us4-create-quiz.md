# US4 create_quiz evidence

**Recorded**: 2026-09-11
**Scope**: T076–T089, deterministic local services and official MCP v2 clients
**Requirements**: FR-022–FR-024, FR-033–FR-049, FR-052–FR-060, SC-001, SC-003, SC-006–SC-009, SC-011–SC-015
**Release interpretation**: implementation and deterministic test evidence only; not a production model, quality, latency, price, SLO, or client-compatibility approval

## Outcome

`create_quiz` is discoverable and callable through the official client in both supported protocol eras. It runs the fixed current-user profile/review/targeting → RAG → exercise chain, persists only an `origin=MCP` internal envelope and owned ready Exercise, returns an answer-free citation-backed projection, and reserves idempotency before model work. The focused US4 run passed 9 suites / 80 tests, the official-client E2E passed 1 suite / 8 tests, and `pnpm --filter @en/server build` passed.

| Verified property                                               |    Deterministic result |
| --------------------------------------------------------------- | ----------------------: |
| Modern `2026-07-28` first generation                            |                     1/1 |
| Legacy `2025-11-25` first generation                            |                     1/1 |
| Both-era same-key replay without second RAG/model/exercise      |                     2/2 |
| Both-era stale-source rejection before envelope/model           |                     2/2 |
| Both-era pre-dispatch cancellation before any downstream stage  |                     2/2 |
| Personalized evaluation scenarios passing                       |                     6/6 |
| Answer/rubric/correctness/internal-prompt leak detections       |              0 accepted |
| Unauthorized, inactive, stale, or mismatched citations accepted |                       0 |
| Mastery/review/submission/attempt rows changed by creation      |                   **0** |
| Focused US4 suites/tests                                        | 9/9 suites, 80/80 tests |
| Official-client both-era E2E                                    |    1/1 suite, 8/8 tests |

## Fixed chain and ownership

- The Bridge calls `LearnerProfileService.getSnapshot`, `ReviewScheduleService.getDueWords`, `ExerciseTargetingService.select`, `LearningMaterialService.searchV2`, the MCP operation-envelope factory/persistence service, and the existing `CreateExerciseTool` in that fixed order. It exposes no arbitrary Coach workflow, grading, attempt, mastery, or review-write method.
- The authenticated user ID is injected into every user-scoped service call. Active-course, CEFR, selected-word, category, current embedding, relevance, access-scope, citation identity, source ID, and content-version constraints are rechecked before creating an envelope or starting the model.
- Caller-supplied word IDs must already occur in the current user's profile/review evidence. Unknown or cross-user IDs fail before RAG and model work.
- Internal relation rows use deterministic idempotency-domain IDs and `CoachConversation.origin=MCP`. Existing Coach history explicitly filters to `origin=COACH`, so internal operation envelopes are not user conversations.
- The existing Exercise service remains the ownership and persistence authority. MCP invokes it with the current user, internal conversation/request IDs, allowlisted targets and source IDs, and one permitted model attempt. The tool now verifies requested item count/type before creating a ready Exercise.

## Public projection and zero learning-state mutation

The outbound projector validates the strict public schema, trace ID, requested item count, contiguous positions, unique item IDs, requested types, unique active citations, and exact membership in the issued-citation set. Property tests reject root and nested answer keys, correct answers/choices, correctness flags, rationales, grading rubrics, model reasoning, system prompts, internal source IDs, unknown/stale/changed-version citations, missing issued sources, wrong trace/type/count/position, unknown fields, and oversize strings.

The both-era E2E records row count plus SHA-256 content hash for mastery, review schedules, submissions, and attempts before and after first generation, stale-source failure, and cancellation. Every comparison is identical. Only one current-user ready Exercise is created on first success; replay creates none.

## Idempotency, cancellation, token, cost, and latency

The durable idempotency service reserves and claims before the fixed chain. Same key/input returns the original safe projection with `replayed=true`; changed input conflicts; concurrent callers elect one executor; expired work is reconciled through a single lease. The concrete quiz execution orchestrator connects these decisions to Bridge telemetry and projection/completion.

| Measurement                                    |  Deterministic value | Interpretation                                                     |
| ---------------------------------------------- | -------------------: | ------------------------------------------------------------------ |
| Official-client E2E Jest time                  |  1.611 s for 8 tests | Local aggregate test time, not per-call latency                    |
| Focused US4 Jest time                          | 2.768 s for 80 tests | Local aggregate test time                                          |
| Meter fixture retrieval/model/projection/total |  12 / 20 / 5 / 37 ms | Injected-clock stage measurements                                  |
| E2E provider-reported input/output tokens      |             120 / 80 | Synthetic model telemetry                                          |
| E2E estimated first-generation cost            |          3 micro-USD | Arithmetic fixture at 10,000 / 20,000 micro-USD per million tokens |
| Same-key replay incremental tokens/cost        |  0 / 0 / 0 micro-USD | No Bridge or model call                                            |
| Concurrent-loser incremental tokens/cost       |  0 / 0 / 0 micro-USD | No Bridge or model call                                            |

Each invocation emits at most one bounded quiz cost record. A duplicate session completion returns the original record rather than recording twice, and a second provider usage report is rejected. Non-executing idempotency outcomes are forced to zero tokens/cost even if a caller supplies nonzero values. Trace records contain only allowlisted capability, terminal, token, cost, duration, cancellation, and version facts; raw learner input, retrieved text, answers, token, and prompt are not recorded.

AbortSignal is checked before dispatch and between every Bridge stage, and is forwarded to RAG and the model. Once cancellation is observed, no later stage begins. Retryable failures leave no ready exercise projection; model Schema failures use one model attempt and fail closed.

## AI evaluation

The versioned synthetic dataset `mcp-create-quiz.synthetic.v1` and rubric `mcp-create-quiz-rubric.v1` cover weak areas, due vocabulary, CEFR level, permitted sources, empty profile, and prompt injection. All six candidates pass the deterministic personalization/citation/leak rubric. Explicit answer, correctness, rationale, rubric, reasoning, and system-prompt probes are all detected. These fixtures validate the evaluator and deterministic projection rules; they do not constitute real-provider quality approval.

## Reproducible commands

Focused US4 contracts, security, idempotency, governance, evaluation, registry, projection, and official-client E2E:

```sh
pnpm --dir server exec jest --runInBand --testRegex '.*\.(spec|e2e-spec)\.ts$' --testPathPatterns 'mcp-(create-quiz|quiz-result)'
```

Recorded result: **9 suites passed; 80 tests passed**; Jest-reported time **2.768 s**.

Official-client both-era E2E only:

```sh
pnpm --dir server exec jest --runInBand --testRegex '.*\.e2e-spec\.ts$' --testPathPatterns 'mcp-create-quiz\.e2e-spec\.ts$'
```

Recorded result: **1 suite passed; 8 tests passed**; Jest-reported time **1.611 s**.

Build:

```sh
pnpm --filter @en/server build
```

Recorded result: passed.

## Evidence map

| Task / concern             | Executable or implementation evidence                                                                                                             | Result                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| T076 strict contract       | `server/apps/ai/test/contract/mcp-create-quiz.contract.spec.ts`                                                                                   | Strict input/output/metadata and zero pre-validation calls                      |
| T077 AI evaluation         | `server/apps/ai/test/evals/mcp/create-quiz.eval.spec.ts`                                                                                          | Six required scenarios and explicit leak probes pass                            |
| T078 source/state security | `server/apps/ai/test/security/mcp-create-quiz.security.spec.ts`                                                                                   | Current-user/source boundaries and no learning-state mutation                   |
| T079 durable idempotency   | `server/apps/ai/test/integration/mcp-create-quiz-idempotency.integration.spec.ts`                                                                 | Replay/conflict/concurrency/reconciliation invariants pass                      |
| T080 runtime governance    | `server/apps/ai/test/governance/mcp-create-quiz-governance.spec.ts`                                                                               | Deadline, stable failure, no retry, cancellation, and bounded metric rules pass |
| T081–T084 reuse/isolation  | `server/apps/ai/test/security/coach-conversation-origin.security.spec.ts`, `server/apps/ai/test/security/mcp-create-quiz-bridge.security.spec.ts` | Hidden MCP envelopes and exact fixed service chain pass                         |
| T085 public handler        | `server/apps/ai/src/mcp/tools/create-quiz.tool.ts`                                                                                                | Strict validation, bounded deadline, cancellation, stable errors                |
| T086 safe projection       | `server/apps/ai/test/security/mcp-quiz-result.projector.property.spec.ts`                                                                         | 20 property/mutation cases pass                                                 |
| T087 one-shot cost/trace   | `server/apps/ai/test/governance/mcp-create-quiz-cost-meter.spec.ts`                                                                               | Winner charged once; replay/concurrent loser zero                               |
| T088 discovery/direct call | `server/apps/ai/test/contract/mcp-create-quiz-registry.contract.spec.ts`                                                                          | Scope, gate, client capability, both eras, next-call revocation pass            |
| T089 official clients      | `server/apps/ai/test/e2e/mcp-create-quiz.e2e-spec.ts`                                                                                             | 8/8 both-era success/replay/source/cancellation cases pass                      |

## Readiness boundary

US4 is independently demonstrable with local deterministic services and official SDK/client transports. GATE-B production OAuth, GATE-C production configuration, GATE-D source-rights/retention approval, and GATE-E real-provider/client quality, latency, token, cost, cancellation, and personalization thresholds remain open. No production gate was enabled, no external model/provider was contacted, and no deployment, commit, or push was performed. Overall release status remains **NOT_READY**.
