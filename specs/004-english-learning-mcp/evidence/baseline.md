# T001 pre-implementation baseline

**Captured**: 2026-09-11 (Asia/Shanghai)
**Repository**: `/Users/woofeel/Downloads/en-learning-plus`
**Remote**: `https://github.com/cjw32/en-learning-plus.git`
**Commit**: `3f3ad9f2004fec5a6b255efe70759b57489ab16a`
**Branch at capture**: `codex/pronunciation-assessment`
**Node.js**: `v24.18.0`
**pnpm**: `10.32.1`

## Protected pre-existing work

`git status --short` before implementation reported these untracked paths:

```text
?? .agents/
?? .specify/
?? apps/web/stats.html
?? specs/004-english-learning-mcp/
```

They are treated as existing user work. Implementation must not delete, reset, clean, overwrite wholesale, commit, push, or deploy them. Feature work may update the already approved files under `specs/004-english-learning-mcp/` and later add the exact source/test paths named by `tasks.md`.

## Baseline results

| Check | Result | Evidence |
|---|---|---|
| Server build | PASS | `pnpm --filter @en/server build`; exit 0; wall time 11.406 s |
| Representative AI/learning tests | PASS | 5 suites, 13 tests, 0 failures; Jest time 6.255 s; command wall time 7.375 s |
| Web type-check | PASS | `pnpm --filter @en/web type-check`; exit 0; wall time 10.847 s |
| Web unit tests | PASS | 21 files, 119 tests, 0 failures; Vitest duration 9.52 s; command wall time 10.527 s |

Representative server command:

```bash
pnpm --filter @en/server test -- --runInBand \
  apps/ai/test/security/coach-auth-context.spec.ts \
  apps/ai/test/integration/rag-learning-material-search.spec.ts \
  apps/ai/test/contract/coach-create-exercise.tool.spec.ts \
  libs/learning/src/review/review-schedule.service.spec.ts \
  libs/learning/src/privacy/learning-data-deletion.pronunciation.spec.ts
```

Selected coverage:

- immutable Coach authentication context;
- learning-material RAG integration;
- exercise-creation contract;
- review scheduling;
- learning-data deletion integration for pronunciation data.

## Baseline interpretation

No pre-existing failure was observed in the selected baseline. This is a targeted regression baseline, not a claim that every repository test or production workload has been executed. T150–T152 must run the broader regression and MCP-specific suites before readiness can be evaluated.

No dependency, lockfile, production configuration, deployment file, commit, push, or deployment was performed while capturing this baseline.
