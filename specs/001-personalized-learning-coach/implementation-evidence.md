# Personalized Learning Coach implementation evidence

## Implemented and verified

| Requirement | Evidence |
|---|---|
| FR-001–FR-010 | Strict access-token context, owner-scoped APIs/tools, durable request state, BullMQ opaque jobs, controlled LangGraph routes, executor integration tests |
| FR-011–FR-015 | CEFR/goal/course/timezone profile, learned/weak/error/performance snapshots, paired personalization fixtures |
| FR-016–FR-024 | No public/tool `userId`, Learning Service boundary, cross-user and auth tests |
| FR-025–FR-032 | Six Zod tools, supported citations, structured result schema, one repair retry and safe degraded results |
| FR-033–FR-040 | One-hour Redis event stream, authenticated SSE replay, 410 reconciliation, AbortSignal, cancel/retry and eight browser scenarios |
| FR-041–FR-048 | Approved-value fail-closed policy, user/IP rate limits, distributed concurrency lease, model/tool/time/cost budgets, idempotent persistence and save reconciliation |
| FR-049–FR-054 | Versioned Prompt content hash, model/schema/budget versions, TTFT, actual provider token/cost callbacks, ordered steps, recommendation evidence and feedback linkage |
| FR-055–FR-061 | Context projection, HMAC Trace subject, allowlist redaction, TTLs, immediate hide, periodic physical purge, checkpoint deletion and in-flight completion guard |
| FR-062–FR-066 | SM-2 state, atomic attempt save, legacy initializer/backfill and regression/property tests |
| FR-067–FR-074 | 60 synthetic cases, deterministic paths/security gates, six rubrics, mock runner/report, baseline/release gate and Trace linker |
| SC-001–SC-005 | Auth/ownership, Schema, path, personalization and learning-change tests passed |
| SC-006 | Empty and legacy-data migration, repeated backfill, legacy snapshots and uniqueness audit passed on disposable PostgreSQL |
| SC-007–SC-011 | Failure, Trace, evaluation, UI and budget gates passed in deterministic/mocked runs |
| SC-012 | Both Nest applications and Vue build; real AppModule and browser legacy-flow regression tests passed in an isolated environment |

Detailed command results are in [build evidence](./evidence/build.md), [server tests](./evidence/server-tests.md), [web tests](./evidence/web-tests.md), [migration evidence](./evidence/migration.md), and [regression evidence](./evidence/regression.md).

## Remaining live-release gates

T001–T106 now have implementation or validation evidence. T101 used only
temporary PostgreSQL databases, and T104 used temporary PostgreSQL/Redis plus
deterministic external-model fixtures; nothing was deployed.

FR-071–FR-073 live evidence remains intentionally pending: the approved
baseline and budget files still have `pending_measurement`, and no existing-AI
or candidate live-model run was authorized. No numeric threshold was invented.
Consequently `COACH_LIVE_MODEL_ENABLED` and `COACH_WRITE_ENABLED` must remain
false until measured values are reviewed and approved. This is a rollout gate,
not an unimplemented task.
