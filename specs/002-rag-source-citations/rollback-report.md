# RAG Additive Migration and Rollback Rehearsal

**Feature**: `002-rag-source-citations`  
**Date**: 2026-09-08  
**Scope**: disposable local PostgreSQL/pgvector and local application tests only  
**Production action**: none

## Environment

- Container: `en-learning-plus-rag-test-20260909-codex1`
- Image: `pgvector/pgvector:pg17`
- Image digest: `sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f`
- Storage/network: disposable tmpfs, loopback-published PostgreSQL port
- Migration database: `en_learning_plus_rag_rehearsal_a`
- Restore database: `en_learning_plus_rag_rehearsal_restored`
- Credentials: test-only and intentionally omitted from this report

## Rehearsal results

| Check | Observed result | Status |
|---|---|---|
| Additive migration on empty database | All five project migrations applied; pgvector and RAG migration completed | PASS |
| Repeated migration deploy | Prisma reported no pending migrations | PASS |
| Fresh database guard | pgvector present, schema objects present, migration created zero ACTIVE knowledge releases | PASS |
| Repeated backfill | Dry run wrote zero jobs; first run wrote one identifier/version-only job; replay wrote no duplicate | PASS |
| Backup | Custom-format logical dump completed inside container tmpfs | PASS |
| Restore | Dump restored into a separate empty database without owner/privilege replay | PASS |
| Row/state comparison | Source and restored tuples both reported `5 migrations / 1 job / 1 release / 0 ACTIVE / 1 INVALID / 1 REVOKED` | PASS |
| Revocation preservation | Synthetic revoked source remained `REVOKED`; synthetic invalid release remained `INVALID` after restore | PASS |
| Flags-off application path | Default RAG flags remained false; v1 schemas/runtime/history rendering remained valid | PASS |
| Destructive rollback | Not performed; additive tables were retained as designed | NOT REQUIRED |

The first synthetic revocation insert attempt referenced a nonexistent `failureCode` release column. PostgreSQL rolled that multi-statement command back. The corrected rehearsal used `invalidatedAt`; both inserts then succeeded. No partial state from the failed command remained.

## Application rollback behavior

With no RAG enablement variables supplied, configuration resolves to:

```text
enabled=false
shadowEnabled=false
ingestionEnabled=false
privateContentEnabled=false
embeddingProviderApproved=false
```

Focused server contract/runtime tests passed for the legacy `coach.result.v1` path and v1/v2 safe parsing. Vue Coach tests continued to render v1 history. The restored database contained no ACTIVE knowledge release, and the revoked/invalid fixtures were not promoted or reactivated.

## Commands and evidence

- `prisma migrate deploy` against the migration database, twice
- fresh-db `rag-schema` E2E with `RAG_TEST_DATABASE_FRESH=true`
- `knowledge-backfill` E2E against the migration database
- `pg_dump -Fc` and `pg_restore --no-owner --no-privileges` inside the disposable container
- exact source/restored state query shown in the table above
- focused `rag-config`, v1/v2 contract, Coach runtime/request-state, and Vue Coach tests

## Conclusion

The safe rollback is application-level flags-off behavior while retaining additive tables. Logical backup/restore preserves invalidation and revocation state and does not activate knowledge. Removing database objects was intentionally not attempted and remains outside authorization.
