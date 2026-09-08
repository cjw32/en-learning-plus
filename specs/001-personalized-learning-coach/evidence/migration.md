# Migration and backfill evidence

Date: 2026-09-03

All database commands targeted temporary PostgreSQL 18.3 databases on
`127.0.0.1:55432`. No production or persistent development database was used.

## Empty database migration

| Command | Exit | Result |
|---|---:|---|
| `DATABASE_URL=<localhost-test-url> pnpm --filter @en/server exec prisma migrate deploy` | 0 | Applied all four migrations, including `202609020001_personalized_learning_coach` |
| Same `prisma migrate deploy` command repeated | 0 | `No pending migrations to apply` |
| `pnpm --filter @en/server exec prisma format` | 0 | Schema formatted |
| `pnpm --filter @en/server exec prisma validate` | 0 | Schema valid |
| `pnpm --filter @en/server exec prisma generate` | 0 | Prisma Client 7.6.0 generated |

## Legacy-data migration snapshot

A second disposable database received only the three pre-Coach migrations,
followed by two synthetic users, three dictionary words and three legacy word
records. The Coach SQL migration was then applied directly with `psql -v
ON_ERROR_STOP=1` (exit 0).

Legacy values before and after the Coach migration were identical:

| User | `wordNumber` | `dayNumber` |
|---|---:|---:|
| `legacy-user-a` | 2 | 5 |
| `legacy-user-b` | 0 | 2 |

| Record | User | Word | `isMaster` | `updatedAt` |
|---|---|---|---|---|
| `legacy-record-1` | `legacy-user-a` | `legacy-word-1` | true | `2026-08-20T00:00:00` |
| `legacy-record-2` | `legacy-user-a` | `legacy-word-2` | true | `2026-08-21T00:00:00` |
| `legacy-record-3` | `legacy-user-b` | `legacy-word-3` | false | `2026-08-22T00:00:00` |

`LearningItemState` contained zero rows immediately after the additive
migration, proving that the schema migration did not silently perform a data
backfill.

## Backfill and repeatability

The executable backfill was run with the repository's installed `tsx`, the
required confirmation value, and the fixed rollout timestamp
`2026-09-02T00:00:00.000Z`.

| Run | Exit | `expectedStateCount` | `stateCount` | Missing | Duplicate keys | Count mismatch | `writeSafe` |
|---|---:|---:|---:|---:|---:|---:|---|
| First write run | 0 | 2 | 2 | 0 | 0 | 0 | true |
| Second write run | 0 | 2 | 2 | 0 | 0 | 0 | true |
| Final `--audit-only` | 0 | 2 | 2 | 0 | 0 | 0 | true |

The final database query returned `2` states and `2` distinct
`(userId,targetType,targetKey)` tuples. Both states were `REVIEW`, with
`repetitionCount=1`, `intervalDays=1`, and preserved the legacy record time in
`lastReviewedAt`. The user and word-record snapshot above remained unchanged.

A separate deliberately inconsistent fixture (`wordNumber=1` with no mastered
record) produced `legacyCountMismatchUserCount=1`, `writeSafe=false`, and exit
1. This confirms that the script blocks write enablement instead of accepting a
bad legacy audit.

T101 is complete for disposable-environment validation. Applying the migration
to any deployment target remains an explicit operational rollout step and was
not performed here.
