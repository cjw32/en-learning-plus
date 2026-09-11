# MCP migration validation

Date: 2026-09-11
Migration: `server/prisma/migrations/20260911000000_english_learning_mcp/migration.sql`
Database engine: local disposable PostgreSQL 17.11

## Isolation

The validation cluster lived under `/private/tmp` and listened only for this
test run. It did not use `DATABASE_URL`, project secrets, a production host, or
any configured application database.

Two databases began from the minimum pre-feature tables referenced by the new
foreign keys:

- an empty baseline with zero application rows;
- a representative baseline with one existing user, Coach conversation,
  Coach request/trace, Exercise, ExerciseSubmission, and LearningAttempt.

The migration applied to both databases with `ON_ERROR_STOP=1` and exit status
0.

## Results

- Both databases contained exactly seven new `Mcp*` tables.
- The empty baseline exposed 19 MCP CHECK constraints.
- The representative baseline preserved every seeded row.
- The existing Coach conversation was backfilled by the additive default to
  `origin=COACH`.
- The database-backed MCP schema suite passed 4/4 assertions, including table,
  foreign-key, CHECK-constraint, and unique-index inspection.
- Static inspection found no top-level `DROP`, `DELETE`, `TRUNCATE`, `UPDATE`,
  or `INSERT` data-mutation statement in the migration.

The local machine does not have the pre-existing pgvector extension installed,
so this isolated check validates the new migration against its required
pre-feature table shapes rather than replaying the repository's unrelated RAG
migration chain. Full-stack migration rehearsal remains part of the later
release validation tasks and does not authorize a production migration.
