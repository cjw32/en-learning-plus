# MCP final scope audit

Recorded: 2026-09-11
Starting commit: `3f3ad9f2004fec5a6b255efe70759b57489ab16a`
Branch: `codex/pronunciation-assessment`

## Outcome

The final diff is scoped to the English-learning MCP contracts, schema/migration/client generation, AI/Coach/learning adapters, Web confirmation flow, tests, and feature evidence. Pre-existing untracked `.agents/`, `.specify/`, `apps/web/stats.html`, and the initially supplied feature-spec directory were preserved; the feature workflow intentionally updated files under `specs/004-english-learning-mcp/`.

`git diff --name-status`, `git status --short`, and targeted diffs were inspected. No commit, push, deployment, external client registration, paid model call, production issuer, environment file, Dockerfile, compose file, PM2 file, or production feature-gate change was made. `.specify/extensions.yml` remains absent after workflow hooks.

## Dependency authorization

The only direct dependency additions are exactly those authorized by the user in this task:

```json
{
  "dependencies": {
    "@modelcontextprotocol/node": "2.0.0",
    "@modelcontextprotocol/server": "2.0.0"
  },
  "devDependencies": {
    "@modelcontextprotocol/client": "2.0.0"
  }
}
```

The lockfile contains only their package-manager-resolved transitive graph. No other manifest changed.

## Generated and sensitive-data checks

Prisma output was regenerated from `server/prisma/schema.prisma`. Whitespace-only changes in unrelated generated model files were removed; remaining generated diffs are the client/enums/namespaces and relation-bearing models affected by the MCP schema. Prisma 7.6.0 itself emits trailing spaces in generated comments, so the authored-source check excludes `server/libs/shared/src/generated/prisma/**`; `git diff --check` over every authored file is clean.

The high-confidence secret scan found no match in new MCP source, tests, Web confirmation code, common contracts, or feature evidence. Its one repository-wide match, `server/apps/ai/test/security/coach-redaction.spec.ts`, is an unchanged pre-existing deliberate redaction canary, confirmed by an empty targeted `git status` result. Generated reports contain no canary values, tokens, learner answers, raw prompts, provider output, or chain-of-thought.

## Gate audit

| Gate | Evidence | State |
|---|---|---|
| SDK dependency | Explicit user authorization; exact versions above | approved for local implementation |
| GATE-B source rights | no dated approval | closed |
| GATE-D retention | policy implemented default-off; no production approval | closed |
| GATE-E provider/client budget and thresholds | no dated approval | closed |

The experimental T149 query/load run used only a disposable loopback PostgreSQL cluster and synthetic data; it changed no dependency, application configuration, or production system. Closed GATE-B/D/E approvals leave T146 pending and force the final release decision to `NOT_READY`.
