# Coach release readiness

Current state: **implementation validation complete; not yet releasable for live/write traffic**.

## Required enablement order

1. Disposable old-data/empty-database migration and full deterministic validation are complete. Set `COACH_ENABLED=true` in a target environment only after that target receives the additive migration and passes its smoke checks.
2. `COACH_LIVE_MODEL_ENABLED=true` only after an approved candidate model, exact model/price/budget/dataset versions, all runtime limit values, a dedicated evaluation key and an approved baseline report.
3. `COACH_WRITE_ENABLED=true` only after live grading evaluation, cross-user security zero failures, save/idempotency/failure gates, deletion lifecycle verification and migration/backfill audit all pass.

The runtime rejects missing or placeholder versions, unapproved budget fields, unknown/expired prices and unmetered model responses. Current `coach-v1-approved.json` and `coach-budget-policy.approved.json` intentionally have `approved=false` and `status=pending_measurement`.

## Rollback

- Disable `COACH_WRITE_ENABLED` first to stop new learning mutations while preserving already committed attempts.
- Disable `COACH_LIVE_MODEL_ENABLED` to stop provider calls; structured durable results remain readable.
- Disable `COACH_ENABLED` to remove new entry traffic. Existing `/chat`, course, dictionary and legacy learning paths remain separate.
- Do not reverse or delete committed learning attempts during flag rollback. The migration is additive; user-requested deletion follows the tombstone flow instead.

## Completed release evidence

- T101: empty/legacy migration, repeat deploy, two backfill runs, audit, unique counts and unchanged legacy snapshots passed on temporary PostgreSQL.
- T104: login/refresh, dictionary, purchased course, ten-word/batch mastery, generic AI contract and non-AI browser regression passed with temporary PostgreSQL/Redis and deterministic provider fixtures.

## Outstanding live gates

- Live candidate run and human/model rubric review needed to replace the pending baseline and budget files with approved measured values.
- The deployment target still requires its normal additive migration and smoke-check procedure; this session did not deploy or mutate any target environment.
- The 2026-09-08 review did not rerun the disposable PostgreSQL scenario because
  no isolated database URL was configured; the 2026-09-03 evidence remains the
  current migration/database baseline.
