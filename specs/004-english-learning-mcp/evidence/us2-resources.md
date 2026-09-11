# US2 authorized learning Resource evidence

**Recorded**: 2026-09-11
**Scope**: T045–T061, deterministic local data/authorization/source-rights ports
**Requirements**: FR-010–FR-016, FR-035–FR-043, SC-003, SC-005–SC-006, SC-015

## Outcome

The official MCP v2 client read all five Resource forms through both supported protocol eras. The implementation reused the existing Learning library, Prisma models, source-rights policy, course purchase relationship, and Node crypto; it added no dependency and performed no production configuration, push, or deployment.

| Verified property | Result |
|---|---:|
| Modern `2026-07-28` five-Resource read | 5/5 |
| Legacy `2025-11-25` five-Resource read | 5/5 |
| Unauthorized/cross-user Resource successes | **0** |
| Content returned after source-rights revocation | **0** |
| Content returned after account deletion | **0** |
| Model calls during Resource tests | **0** |
| Learning-state writes during Resource tests | **0** |
| Focused US2 test suites/assertions | 11/11 suites, 70/70 tests |
| Official-client Resource E2E | 1/1 suite, 6/6 tests |
| Existing non-MCP learning regressions | 4/4 suites, 12/12 tests |

All counts above come from synthetic fixtures. Source-rights approval for production content remains blocked by GATE-D, and no production latency, compatibility, cache, or SLO claim is made under GATE-E.

## Resource matrix

| URI/template | Access boundary | Projection and provenance | Pagination/cache behavior |
|---|---|---|---|
| `en-learning://words/{wordId}` | Approved public source fields only | Normalized word fields, availability, bounded forms/examples, deterministic citation/content version | Public result version changes with record or rights version; no private identity in output |
| `en-learning://courses/{courseId}/materials/{materialId}` | Current user must own the course; active private document/release/source and display rights are checked in one query and rechecked in service | Bounded summary, safe locator, active `OWNED_COURSE` citation; answer-key/rubric content is rejected | Private/no-store design; new reads re-query entitlement and source status |
| `en-learning://me/reviews/today` | URI cannot select a user; server injects current `userId` | Learner-timezone date, due items, reason/state/time, content version | Limit 1–50; HMAC cursor binds authorization, Resource, limit and content version |
| `en-learning://me/reports/summary` | Current user only | Seven-day deterministic counts/rounded average/completeness/policy version | Private/no-store; recomputed from authoritative facts |
| `en-learning://me/weaknesses` | Current user only | Stable error-type/word evidence with count, last-seen time and current/stale/insufficient status | Limit 1–50; same signed context/content-version cursor policy |

Discovery registers exactly two controlled templates and three fixed private Resources. The same Resource registry revalidates active authorization and `learning:read` on every direct read; disabling a Resource removes it from registration and denies direct invocation.

## Isolation and invalidation results

- `me` handlers never accept a subject or user selector. Identity-bearing URIs and unknown `userId` fields fail validation before a domain call.
- Learner A and learner B receive disjoint review/report fixtures; learner B cannot infer whether learner A's course material exists because unentitled and missing material share `RESOURCE_NOT_FOUND` and the same safe message.
- Course repository queries include `userId + courseId + isPurchased`, private `OWNED_COURSE` scope, active/non-invalidated release, active/verified/non-revoked/non-deleted source, effective rights dates, and an approved `Course.content` display policy.
- Dictionary queries select only rights-approved fields. The facade repeats the projection allowlist so an over-broad repository row cannot reintroduce denied fields.
- Signed cursors reject tampering, expiry, another principal, another Resource, changed filters, and changed review/report content versions. Keyset order uses the documented stable sort plus ID/key tie-breaker.
- Account deletion and authorization revocation are checked before handlers. Source-rights and entitlement changes are read live rather than served from private Redis content caches.

## Reproducible commands

Focused contracts, isolation, pagination, domain repositories/services, application delegation, and public-module surface:

```sh
pnpm --dir server exec jest --runInBand apps/ai/test/contract/mcp-resources.contract.spec.ts apps/ai/test/contract/mcp-resource-registry.contract.spec.ts apps/ai/test/security/mcp-resource-isolation.security.spec.ts apps/ai/test/integration/mcp-resource-pagination.integration.spec.ts apps/server/src/word-book/__tests__/word-book-shared-service.spec.ts libs/learning/src/dictionary/word-dictionary.repository.spec.ts libs/learning/src/dictionary/word-dictionary.service.spec.ts libs/learning/src/resources/learning-resource-read.service.spec.ts libs/learning/src/reporting/learning-report.repository.spec.ts libs/learning/src/reporting/__tests__/learning-report.service.spec.ts libs/learning/src/learning-public-surface.spec.ts
```

Result: **11 suites passed; 70 tests passed**.

Official-client, both-era in-process E2E:

```sh
pnpm --dir server exec jest --runInBand --testRegex '.*\.e2e-spec\.ts$' --testPathPatterns 'mcp-resources\.e2e-spec\.ts$'
```

Result: **1 suite passed; 6 tests passed**.

Existing non-MCP resource/learning regressions:

```sh
pnpm --dir server exec jest --runInBand apps/server/src/word-book/__tests__/word-book-shared-service.spec.ts libs/learning/src/materials/learning-material.service.spec.ts libs/learning/src/review/review-schedule.service.spec.ts libs/learning/src/learner-profile/learner-profile.service.spec.ts
```

Result: **4 suites passed; 12 tests passed**. `pnpm --filter @en/server build` also passed after the shared-service/module changes.

## Evidence map

| Concern | Evidence |
|---|---|
| Five URI and outbound schemas | [`mcp-resources.contract.spec.ts`](../../../server/apps/ai/test/contract/mcp-resources.contract.spec.ts) |
| Two-user, revocation, deletion, scope and source isolation | [`mcp-resource-isolation.security.spec.ts`](../../../server/apps/ai/test/security/mcp-resource-isolation.security.spec.ts) |
| Signed cursor and content-version invalidation | [`mcp-resource-pagination.integration.spec.ts`](../../../server/apps/ai/test/integration/mcp-resource-pagination.integration.spec.ts) |
| Existing `/word-book` behavior | [`word-book-shared-service.spec.ts`](../../../server/apps/server/src/word-book/__tests__/word-book-shared-service.spec.ts) |
| Report empty/timezone/aggregation behavior | [`learning-report.service.spec.ts`](../../../server/libs/learning/src/reporting/__tests__/learning-report.service.spec.ts) |
| Authorized course query/projection | [`learning-resource-read.service.spec.ts`](../../../server/libs/learning/src/resources/learning-resource-read.service.spec.ts) |
| Registry discovery/direct-call parity | [`mcp-resource-registry.contract.spec.ts`](../../../server/apps/ai/test/contract/mcp-resource-registry.contract.spec.ts) |
| Official clients and both protocol eras | [`mcp-resources.e2e-spec.ts`](../../../server/apps/ai/test/e2e/mcp-resources.e2e-spec.ts) |

## Readiness boundary

US2 is independently demonstrable with synthetic local data and makes no model request or learning-state write. It is not production-ready evidence: GATE-B production OAuth, GATE-C production configuration, GATE-D source rights/retention, and GATE-E approved baselines/client records remain open. Overall release status remains **NOT_READY**.
