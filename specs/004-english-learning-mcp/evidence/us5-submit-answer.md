# US5 submit_answer evidence

**Recorded**: 2026-09-11
**Scope**: T090–T113, deterministic local services, both approved MCP protocol eras, project Web confirmation
**Requirements**: FR-023–FR-026, FR-031–FR-051, SC-001–SC-004, SC-008–SC-014, SC-016
**Release interpretation**: implementation and deterministic evidence only; no production OAuth, provider, pricing, SLO, deployment, or client certification is approved

## Outcome

`submit_answer` now has a server-verifiable two-step flow. The first call prepares a bounded, idempotently staged grade but performs no authoritative learning write. The project HTTPS page reauthenticates the same user and records a five-minute, single-use decision. An exact retry after confirmation atomically commits the Submission, LearningAttempt, SM2 item state, review event, confirmation consumption, and idempotency result. Both approved protocol-era projections use the same project URL and opaque selector.

| Verified property | Deterministic result |
| --- | ---: |
| Modern `2026-07-28` URL flow | 1/1 |
| Legacy `2025-11-25` URL flow and session binding | 1/1 |
| Authoritative writes before Web confirmation | **0** |
| Concurrent confirmed retries | 8 calls → 1 saved, 7 replayed |
| Submission/Attempt/review logical write sets | **1** |
| Model preparation charges | **1** |
| Poll/replay/reconciliation incremental model cost | **0** |
| Exact five-minute expiry writes | **0** |
| Focused US5 orchestration/atomicity/recovery/cost tests | 6/6 suites, 39/39 tests |
| Both-era E2E | 1/1 suite, 3/3 tests |
| Web regression and comprehension suite | 24/24 files, 135/135 tests |

## Confirmation and write boundary

- The URL contains only a random selector at `/mcp/confirmations/{selector}`. It contains no answer, subject, user ID, token, client credential, redirect target, or preauthorization capability.
- The confirmation record binds the immutable issuer/subject mapping, current user, authorization, client, `answer:submit` scope snapshot, exercise/version, normalized answer digest, operation-summary digest, tool version, and five-minute expiry.
- The Web endpoint requires the existing authenticated session, same-user proof, fresh reauthentication, a non-expired token, and a double-submit CSRF proof. Confirming in the browser performs no learning write; it only authorizes an exact MCP retry.
- The first MCP call uses `OwnedGradingService.prepareOwned`, which reuses the current pure grading logic and owned exercise loader. Only a strict `mcp.submit-preparation.v1` projection is stored on the MCP idempotency intent; it excludes answer keys, rubric internals, provider payloads, prompts, and model reasoning.
- Finalization uses one serializable Prisma transaction. The confirmation row and idempotency intent are locked and revalidated before any business row is created. Any failure before commit rolls back every authoritative change. A response-path failure after commit is recovered from the committed business keys and never repeats grading or learning writes.

## Idempotency, cancellation, recovery, and cost

The caller key is hashed for MCP idempotency. Canonical answer ordering produces the same fingerprint; changed answer content conflicts. A single PROCESSING claimant may prepare grading. Later callers see pending confirmation, finalize a confirmed record, replay a completed result, or enter bounded reconciliation after an expired lease.

The deterministic cost fixture reports 120 input and 80 output tokens at 10,000/20,000 micro-USD per million tokens, yielding 3 micro-USD for the first staged preparation. Every confirmation poll, concurrent loser, terminal replay, and reconciliation record is forced to zero model tokens and zero incremental model cost. Provider usage can be reported only once per cost session.

Cancellation is checked before identity/idempotency work and between subsequent stages, and the grading model receives an AbortSignal bounded by the 30-second write deadline. Once cancellation is observed, no staging or final transaction begins. If the database commit may already have crossed its commit point, the caller receives or reconciles the single committed result instead of a false rollback claim.

## Comprehension and revocation fixture

The component suite directly checks the visible consequences “grade and save the answer,” “update mastery,” and “update the review schedule,” together with expiry, confirm/reject controls, retry guidance, focus management, keyboard-native actions, offline recovery, and the existing client-access revocation route. The scripted fixture exposes every required consequence and revocation action (10/10 checks, 100%), exceeding the SC-016 threshold of 90%. This is a deterministic UI comprehension fixture, not a human-subject usability study.

## Reproducible commands

```sh
pnpm --filter @en/server test -- --runInBand \
  apps/ai/test/integration/mcp-submit-answer-tool.integration.spec.ts \
  apps/ai/test/contract/mcp-submit-elicitation.contract.spec.ts \
  apps/ai/test/integration/mcp-submit-idempotency.integration.spec.ts \
  apps/ai/test/integration/mcp-submit-atomicity.integration.spec.ts \
  apps/ai/test/integration/mcp-submit-reconciliation.integration.spec.ts \
  apps/ai/test/governance/mcp-submit-cost.spec.ts
```

Recorded result: **6 suites passed; 39 tests passed**; Jest-reported time **2.267 s**.

```sh
pnpm --dir server exec jest --config ./apps/ai/test/jest-e2e.json \
  --runInBand apps/ai/test/e2e/mcp-submit-answer.e2e-spec.ts
```

Recorded result: **1 suite passed; 3 tests passed**; Jest-reported time **1.383 s**.

```sh
pnpm --filter @en/web test:unit -- \
  src/views/McpConfirmation/__tests__/McpConfirmation.spec.ts
pnpm --filter @en/web type-check
pnpm --filter @en/server build
```

Recorded result: **24 Web test files passed; 135 tests passed**; Web type-check and server build passed.

## Evidence map

| Concern | Executable evidence | Result |
| --- | --- | --- |
| Confirmation contract/state/security | `mcp-write-confirmation-openapi.contract.spec.ts`, `mcp-write-confirmation.integration.spec.ts`, `mcp-confirmation-web.security.spec.ts` | Exact schema, five-minute CAS, same-user/CSRF/no-leak rules pass |
| Protocol parity/capability denial | `mcp-submit-elicitation.contract.spec.ts` | 8/8; exact modern/legacy projection and incapable-client hide/deny |
| Staged grading and cost | `mcp-submit-cost.spec.ts` | One model preparation; all non-executing outcomes zero cost |
| Atomicity and idempotency | `mcp-submit-idempotency.integration.spec.ts`, `mcp-submit-atomicity.integration.spec.ts` | Canonical replay/conflict/concurrency and every transaction fault boundary pass |
| Reconciliation | `mcp-submit-reconciliation.integration.spec.ts` | Live lease, post-commit recovery, retryable no-commit and cancellation pass |
| End-to-end flow | `mcp-submit-answer.e2e-spec.ts` | Both eras, Web decision, concurrency, duplicate-cost zero and expiry pass |
| Comprehension/accessibility | `McpConfirmation.spec.ts` | Consequences, expiry/recovery/focus and revocation are visible |

## Readiness boundary

US5 is independently demonstrable with deterministic local services. Production OAuth/client approval, production feature gates, real-provider quality/latency/token/cost/cancellation evidence, retention governance, and final release gates remain open. No production configuration was changed, no new unapproved dependency was added, and no commit, push, deployment, or external provider call was performed. Overall release status remains **NOT_READY**.
