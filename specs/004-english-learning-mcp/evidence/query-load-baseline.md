# MCP query/load baseline

Recorded: 2026-09-11
Status: **COMPLETE / experimental — not a GATE-E production baseline**

## Environment and limits

A disposable local PostgreSQL 17.11 (Homebrew) cluster was created on loopback only, used with synthetic data, stopped after the run, and never connected to production. Server settings were `max_connections=100`, `shared_buffers=128MB`, and default `statement_timeout=0`. No application or production configuration was changed.

`prisma migrate deploy` stopped at the pre-existing RAG migration because the disposable host did not have the `vector` extension. No dependency or extension was installed. To isolate the MCP tables and indexes, the English-learning MCP migration was applied directly after the existing base/Coach migrations. Consequently this is query-shape evidence for the MCP/resource/report tables, not a production-parity migration rehearsal and not an approval to deploy.

## Synthetic dataset

| Table | Rows |
|---|---:|
| `WordBook` | 20,000 |
| `WordBookRecord` | 20,000 |
| `LearningItemState` | 20,000 |
| `LearningAttempt` | 10,000 |
| `McpInvocation` | 50,000 |
| `McpIdempotencyIntent` | 50,000 |
| `McpTrace` | 50,000 |
| `McpTraceStep` | 200,000 |

The dataset contains one synthetic learner/profile and one synthetic MCP subject/authorization. Half of the word-book rows are mastered; due dates, saved-at dates, intent states, and leases are distributed so the bounded result and recovery paths are exercised. No real learner or provider data was used.

## Query plans

All measurements used `EXPLAIN (ANALYZE, BUFFERS)` after `ANALYZE`. Times are one warm-cache observation and must not be interpreted as an SLO.

| Query | Bound | Plan and observed result |
|---|---:|---|
| Due learning resource | 100 rows | `LearningItemState_userId_targetType_dueAt_idx` index scan plus incremental sort; 345 shared hits; 0.897 ms |
| Mastered-count report | one aggregate | sequential scan of 20,000 `WordBookRecord` rows; 217 shared hits; 0.914 ms |
| Attempt report | 90 days / 50 rows | `LearningAttempt_userId_savedAt_idx` index scan plus incremental sort; 7 shared hits; 0.031 ms |
| Trace and steps | one exact trace ID / 4 steps | `McpTrace_traceId_key` plus `McpTraceStep_traceId_sequence_key` bitmap lookup; 14 shared hits; 0.046 ms |
| Idempotency replay | one composite business key | `McpIdempotencyIntent_replay_key` unique lookup; 4 shared hits; 0.024 ms |
| Expired-lease reconciliation | 100 rows | authorization/status/lease bitmap index scan over 16,666 matching rows plus top-N sort; 1,801 shared hits; 8.558 ms |

Two observations are intentionally left as follow-up candidates rather than silently changing schema: mastered-count selectivity makes PostgreSQL prefer a sequential scan at this size, and a large expired-lease backlog makes reconciliation scan/sort substantially more rows than its limit. Neither result violates a user-approved threshold because no GATE-E threshold exists.

## Bounded load, timeout, and lease behavior

The versioned workload is [`query-load.sql`](query-load.sql), SHA-256 `b5648c3e9bc228e850628a33fac1eda91f8a16172082a43601444bbae554dfce`. It runs all six read paths in one transaction with randomized trace and idempotency keys.

```sh
pgbench -h 127.0.0.1 -p 55491 -U woofeel -d mcp_load -n \
  -c 8 -j 4 -T 10 -P 5 \
  -f specs/004-english-learning-mcp/evidence/query-load.sql -l
```

| Measure | Result |
|---|---:|
| Clients / worker threads / duration | 8 / 4 / 10 s |
| Transactions / failures | 6,937 / 0 (0.000%) |
| Throughput | 692.534 TPS |
| Average / standard deviation | 11.530 / 12.422 ms |
| P50 / P95 | 9.988 / 18.977 ms |
| Minimum / maximum | 4.110 / 405.789 ms |
| Initial connection time | 9.494 ms |

`pgbench` held eight direct client connections for the run; all eight connected and completed without connection failure against the server's 100-connection limit. This verifies bounded database concurrency only. It does **not** exercise or size the Nest/Prisma application pool, and no production pool recommendation is inferred.

With `statement_timeout='1ms'`, the actual expired-lease reconciliation query exited non-zero with `canceling statement due to statement timeout`, proving server-side cancellation of the bounded query. A rollback-only lease compare-and-set transaction produced `UPDATE 1`, `UPDATE 1`, then competing `UPDATE 0`; the retained live owner was `worker-a`. The transaction was rolled back, so the lease probe left no data change.

The disposable database also ran the MCP persistence schema suite with `MCP_TEST_DATABASE_URL`: 1 suite / 4 tests passed, including both live database invariant tests.

## Interpretation

T149 is complete because dataset shape, plans, bounds, concurrency, latency percentiles, timeout/cancellation, fixed-connection behavior, and lease contention are recorded. Results remain **experimental** until GATE-E supplies an approved environment, application-pool shape, workload duration/sample plan, thresholds, owners, and date. They do not make the overall release decision ready.
