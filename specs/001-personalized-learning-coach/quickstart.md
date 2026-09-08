# Phase 1 Validation Quickstart: 个性化英语学习 Coach

**Feature**: `001-personalized-learning-coach`
**Purpose**: Runnable validation guide for the future Implement phase. These commands describe expected verification after implementation; Plan does not install dependencies, migrate data, or run the feature.

## Prerequisites

- Node.js version accepted by `apps/web/package.json`.
- pnpm workspace dependencies installed by an explicitly authorized Implement task.
- Test PostgreSQL databases for primary application data and AI checkpoints.
- Test Redis instance for BullMQ, rate limits, cancellation, and event replay.
- MinIO, payment, email, and production model credentials are not required for deterministic Coach tests.
- Separate synthetic users and purchased-course fixtures; never use production learner data.
- Live-model evaluation requires a dedicated test API key and an approved budget policy.

Required environment is isolated from production:

```text
DATABASE_URL=<test primary database>
AI_DATABASE_URL=<test checkpoint database>
REDIS_HOST=<test redis host>
REDIS_PORT=<test redis port>
SECRET_KEY=<test-only signing secret>
DEEPSEEK_API_KEY=<live-eval only>
DEEPSEEK_API_MODEL=<approved candidate model>
COACH_BUDGET_POLICY_VERSION=<approved test policy>
COACH_EVAL_DATASET_VERSION=<fixture version>
```

## Artifact Checks

From the repository root:

```bash
jq empty specs/001-personalized-learning-coach/contracts/coach-result.schema.json
jq empty specs/001-personalized-learning-coach/contracts/coach-tools.schema.json
rg -n 'userId' specs/001-personalized-learning-coach/contracts/coach-tools.schema.json
rg -n '\[NEEDS CLARIFICATION:' specs/001-personalized-learning-coach/spec.md
rg -n '\[FEATURE\]|\[DATE\]|\[###' \
  specs/001-personalized-learning-coach/spec.md \
  specs/001-personalized-learning-coach/plan.md
```

Expected:

- Both JSON schemas parse.
- The tool-schema `userId` scan returns no matches.
- No unresolved template/clarification markers remain.

## Build and Static Validation

```bash
pnpm --filter @en/server build
pnpm --filter @en/web type-check
pnpm --filter @en/web build-only
```

Expected:

- Both Nest applications compile from the monorepo.
- Shared Zod-derived Coach types compile in server and Vue.
- Existing non-Coach builds remain green.

## Database and Backfill Validation

Run only against disposable test databases:

```bash
pnpm --filter @en/server exec prisma migrate deploy
pnpm --filter @en/server exec prisma generate
pnpm --filter @en/server test -- --runInBand learning-backfill
```

Expected:

- New entities and constraints match `data-model.md`.
- Every legacy mastered word gets at most one `LearningItemState`.
- Legacy `WordBookRecord.isMaster` and `User.wordNumber` are unchanged.
- Running the backfill twice has the same result.
- A read-only due-word query never creates state.

## Server Unit and Contract Tests

```bash
pnpm --filter @en/server test -- --runInBand coach-unit
pnpm --filter @en/server test -- --runInBand coach-contract
```

Required unit evidence:

- CEFR profile validation and purchased-course ownership.
- SM-2 quality mapping, E-Factor floor, interval transitions, timezone handling, and `MASTERED` rule.
- Lowest-quality aggregation when one target appears in multiple items.
- Request/exercise/submission state transitions.
- Budget, timeout, cancellation, and retry classification.
- Redaction allowlist prevents Prompt, JWT, key, raw payload, or stack persistence.

Required contract evidence:

- Every public/tool/SSE example validates against its Zod/JSON Schema.
- Unknown properties and any injected `userId` are rejected.
- `score` is numeric only for grading.
- User exercise projections never contain answer keys or grading rubrics.
- Unknown schema versions fail safely in the Vue parser.

## Authentication and Cross-User Integration Tests

```bash
pnpm --filter @en/server test:e2e -- --runInBand coach-auth
```

Fixtures:

- User A and User B with distinct CEFR levels, courses, words, conversations, exercises, and attempts.
- Expired/invalid access tokens and a refresh token presented as access token.

Expected:

- Every Coach endpoint rejects unauthenticated or invalid access tokens before queue/model/data use.
- User A cannot read, stream, retry, cancel, grade, save, provide feedback to, or delete User B's resources.
- Injected identifiers in messages, JSON unknown fields, headers, or model tool calls cannot change the authenticated subject.
- Not-owned IDs return the same safe not-found behavior as nonexistent IDs.

## Controlled Workflow and Tool-Order Tests

```bash
pnpm --filter @en/server test -- --runInBand coach-workflow
```

Expected paths:

| Input | Expected path |
|-------|---------------|
| Learning-method question | validate → classify → profile → generate answer → recommend → validate result |
| Sentence correction | validate → classify → profile → materials when needed → correction → recommend → validate result |
| Exercise request | validate → classify → profile → due words when relevant → materials → create exercise → recommend → validate result |
| Exercise answer | validate → load owned exercise → grade → validate grading → save transaction → recommend → validate result |
| Invalid grading | validate → grade retry/repair → valid degraded result; no save |
| Prompt Injection requesting write | validate/classify → safety refusal or safe answer; no unauthorized tool |

Assertions:

- Tool sequence is visible in `CoachStepTrace`.
- `save_attempt` never runs without a valid same-version grade.
- Tool call count and total wall-time budgets halt loops.
- Model output cannot choose a new graph edge or tool outside the current node's allowlist.

## Atomic Save and Idempotency Tests

```bash
pnpm --filter @en/server test:e2e -- --runInBand coach-attempt
```

Test the same valid answer through:

1. Single submission.
2. Double click with the same key.
3. Same key with a different body.
4. Network retry after server commit but before client acknowledgement.
5. SSE reconnect after commit.
6. Queue job delivery retry.
7. Cancel during grading.
8. Cancel at the save transaction boundary.
9. Forced failure during review-event creation.

Expected:

- Cases 1, 2, 4, 5, and 6 yield one `LearningAttempt` and one review event per target.
- Case 3 is an idempotency conflict with no second write.
- Case 7 writes no attempt.
- Case 8 reports either not saved or saved once, never unknown/partial.
- Case 9 rolls back attempt and all item-state changes.

## SSE, Cancel, and Reconnect Browser Tests

```bash
pnpm --filter @en/web test:unit -- coach
pnpm exec playwright test coach-streaming
```

Expected:

- Vue displays connecting, queued, generating, tool, grading, saving, completed, cancelled, timed-out, budget, and failed states.
- `AbortController` stops the local stream and the cancel API stops server work.
- Replayed event IDs are deduplicated.
- A 410 replay expiry falls back to durable request status.
- Provisional deltas are not persisted/rendered as final after invalid output.
- Final result renders by schema version with correction, explanation, examples, error types, score, next action, citations, exercise, and learning changes.
- No raw reasoning/tool arguments/internal Prompt appear in the DOM or network event payload.

## Failure and Governance Tests

```bash
pnpm --filter @en/server test -- --runInBand coach-failures
```

Inject:

- Model unavailable/timeout.
- Material provider missing/timeout.
- Grammar provider unavailable.
- Invalid model JSON/schema.
- Tool output schema failure.
- Redis cancellation/event interruption.
- PostgreSQL write conflict.
- User/token expiry before deadline.
- Input/output token, cost, model-call, tool-call, per-tool, total-time, and concurrency limit exhaustion.

Expected:

- Every failure returns a declared safe code and retryability.
- No partial learning write occurs.
- Grammar/material absence produces a valid degraded result without fabricated citation.
- Exceeded budgets stop new nodes and writes.
- Trace terminal status and step evidence match the injected failure.

## Offline Evaluation

Deterministic suite:

```bash
pnpm --filter @en/server test -- --runInBand coach-eval-deterministic
```

Release/live suite:

```bash
pnpm --filter @en/server exec tsx apps/ai/test/evals/run.ts \
  --dataset "$COACH_EVAL_DATASET_VERSION" \
  --mode live \
  --output /tmp/en-learning-coach-eval.json
```

Expected:

- Dataset contains 50–100 versioned synthetic/hand-authored cases and covers every evaluation class in `spec.md`.
- Authentication, isolation, injection, tool-parameter, write-gate, idempotency, schema, and sensitive-leak checks have zero failures.
- Model/human-scored categories do not regress from the approved baseline pass state.
- Output records exact Prompt/model/schema/dataset versions, TTFT, total time, token usage, estimated cost, retries, and tool path.
- No production conversation or direct learner identifier appears in fixtures or results.

## Trace and Retention Validation

```bash
pnpm --filter @en/server test:e2e -- --runInBand coach-observability
pnpm --filter @en/server test:e2e -- --runInBand coach-retention
```

Expected:

- Completed, degraded, cancelled, timeout, budget, schema failure, and save replay requests are queryable by Trace.
- Sensitive-data scan returns zero prohibited values.
- Conversation expiry/deletion removes domain messages, Redis keys, and checkpoint thread.
- Account/Coach-data deletion hides data immediately and purges owned primary rows and Trace subject mapping within the tested job deadline.
- Remaining Trace metadata cannot be linked back through application data.
- Synthetic offline evaluation cases are unaffected by user deletion because they were never linked.

## Existing-Flow Regression

```bash
pnpm --filter @en/server test:e2e -- --runInBand auth learn course word-book chat
pnpm --filter @en/web type-check
pnpm --filter @en/web build-only
```

Expected:

- Login/refresh, word search, purchased courses, ten-word learning, legacy mastered-word count, generic AI modes, and non-AI pages keep their prior public behavior.
- The Coach uses new `/coach` routes and does not silently change the existing generic `/chat` contract.

## Release Evidence Checklist

Before claiming Implement complete, retain:

- Exact commands and exit codes.
- Schema and OpenAPI validation results.
- Migration/backfill counts from a disposable copy.
- Deterministic and live evaluation dataset/version/result.
- Approved budget policy and baseline comparison.
- Security/fault-injection results.
- Browser screenshots or test traces for stream/cancel/retry states.
- Sensitive-log scan result.
- Known gaps or deviations linked back to FR/SC identifiers.
