# Quickstart: validate the English Learning MCP Server implementation

This is a verified local validation/run guide. It is not authorization to change an OAuth provider, edit production configuration, run a database migration, call a paid model, use real learner data, push, or deploy. The runtime is disabled by default.

## 1. Validate implementation artifacts

Run from the repository root:

```bash
test -f specs/004-english-learning-mcp/spec.md
test -f specs/004-english-learning-mcp/plan.md
test -f specs/004-english-learning-mcp/research.md
test -f specs/004-english-learning-mcp/data-model.md
test -f specs/004-english-learning-mcp/quickstart.md
test -f specs/004-english-learning-mcp/tasks.md
test -f specs/004-english-learning-mcp/contracts/README.md
test -f specs/004-english-learning-mcp/contracts/mcp-streamable-http.md
test -f specs/004-english-learning-mcp/contracts/mcp-authorization.md
test -f specs/004-english-learning-mcp/contracts/write-confirmation.openapi.yaml
jq empty specs/004-english-learning-mcp/contracts/mcp-capabilities.schema.json
rg -n 'NEEDS CLARIFICATION|\[FEATURE\]|\[DATE\]|\[###-feature' \
  specs/004-english-learning-mcp/plan.md \
  specs/004-english-learning-mcp/research.md \
  specs/004-english-learning-mcp/data-model.md \
  specs/004-english-learning-mcp/contracts
```

Verified: all files exist, JSON parses, and the placeholder search returns no matches. `tasks.md` is the authoritative implementation ledger.

The OpenAPI document should be parsed later with an already-approved repository/runtime tool. Do not add a YAML package solely to validate this design artifact.

## 2. Verify protected boundaries

```bash
git diff -- package.json server/package.json apps/web/package.json pnpm-lock.yaml server/pnpm-lock.yaml
git diff -- server/Dockerfile server/ecosystem.config.js
git status --short
```

Expected for this phase: no dependency/lockfile, Docker, PM2, environment or production configuration change caused by this plan; no source implementation. Existing user changes remain untouched.

## 3. Production-enablement prerequisites

Do not enable the applicable production capability until the owner has approved and recorded each gate:

| Gate | Evidence required | Work blocked while closed |
|---|---|---|
| Official MCP SDK | Exact server/node/client package versions, license/security review, manifest and lockfile change approved by user | Protocol implementation and contract harness |
| OAuth authorization server | Approved issuer/resource audience, JWKS or introspection, immediate revocation, client identity, scope/consent and registration mode | Remote private MCP capabilities |
| Subject provisioning | Audited immutable-sub to local-user link/revoke/delete procedure; no email auto-link | Any learner data access |
| Source rights | Per-source/per-field MCP display permission and invalidation evidence | Affected word/course/material content |
| Confirmation flow | Project HTTPS page, same-user reauth, five-minute state machine, concurrent consume and recovery tests | `submit_answer` discovery/call |
| Governance | Approved rate, concurrency, deadlines, size, token/cost budgets and baseline process | Production MCP/AI/write gates |
| Evaluation/client matrix | Authorized synthetic dataset, zero-tolerance passes, approved AI baseline, four actual client records | Production enablement and SLO claims |

Unknown or pending evidence is a closed gate.

## 4. Local build and regression commands

Use the existing repository toolchain:

```bash
pnpm --filter @en/server build
pnpm --filter @en/server test
pnpm --filter @en/server test:e2e
pnpm --filter @en/web type-check
pnpm --filter @en/web test:unit
pnpm --filter @en/web build
```

Also run targeted MCP contract/integration/security/eval suites and the existing Coach, RAG, exercise, review, pronunciation, WordBook and course tests. With every MCP gate off, the test double must observe zero MCP/OAuth-specific business/model calls and unchanged old behavior.

## 5. Protocol matrix

### Modern `2026-07-28`

- Valid stateless POST discovery and every allowed Resource/Tool/Prompt call.
- GET/DELETE return 405; no session allocation.
- Missing/wrong `MCP-Protocol-Version`, required `_meta`, `Mcp-Method`, `Mcp-Name`, and header/body conflicts produce the specified protocol errors before business work.
- Request/response stream close reaches the same invocation AbortSignal and stops new RAG/model/domain steps.
- URL elicitation emits modern input-required state without embedding secrets or answers.

### Legacy `2025-11-25`

- Valid initialize, then POST/GET/DELETE with the allocated session ID.
- Tool/Resource/Prompt call before initialize fails.
- Earlier/unknown version is rejected before a session is allocated; the server does not silently counter-offer a supported version.
- Missing/unknown/expired session and session use with a different subject/client fail without business access.
- `notifications/cancelled`, disconnect and DELETE cancel only that session/request.
- URL elicitation completion notification may resume the initiating session, but loss/restart still allows safe same-call manual retry from durable state.

### Shared assertions

- Only exact supported versions are accepted.
- Both arms produce the same authorized capability contracts and application semantics.
- Session, manifest, cancellation, cursor, confirmation and cache state never cross subject/client/era.
- Private/scope-dependent responses use `private, no-store`.

## 6. OAuth and capability discovery

Use a deterministic fake `McpAccessTokenVerifier`; do not start with a production issuer.

Test missing/malformed/query-string token, wrong issuer, wrong resource audience, wrong OAuth client, expired/not-yet-valid/revoked token, unknown key/introspection outage, unmapped or duplicate subject, inactive local authorization and incomplete scope. Each case must fail before a Resource service, RAG, model, confirmation creation or learning write.

For two users, two clients, both eras and these scope sets:

- `learning:read`
- `quiz:create`
- `answer:submit`
- all three
- none

assert that discovery equals `protocol era ∩ declared client capabilities ∩ token/local scopes ∩ feature gates`. Direct invocation of every hidden item must fail at the same boundary. `clientInfo` spoofing cannot change OAuth client ID.

Verify 401/403 Bearer challenges, `resource_metadata`, complete required scope and absence of target-existence detail. Validate the public Protected Resource Metadata document and confirm the MCP service exposes no authorization/token endpoint.

## 7. Resource and cursor tests

- Word and course identifiers accept only the bounded patterns; paths, URLs, SQL-like expressions, service names and identity selectors are rejected.
- `me` always resolves from authenticated context; a URI/query/prompt containing another user identifier cannot change it.
- Word fields are independently rights-filtered. A forbidden field is absent/unavailable, not model-filled.
- Course material is re-authorized against current entitlement/source/version on list and read.
- Today-review, report and weakness empty states are successful and explicitly describe data completeness.
- Stable ordering plus ID tie-breaker yields no duplicate/missing item across pages while unrelated rows change.
- Cursor tampering, expiry, filter/resource/subject/client reuse and oversized page values fail safely.
- Rights revoke, source delete, entitlement loss and user delete prevent new content immediately; old private cache contains no body because v1 does not cache it.
- Resource JSON stays within 64 KiB per text item and the general 256 KiB response ceiling; truncation/pagination is explicit.

## 8. Tool contract and service-boundary tests

For all six Tools:

- strict schemas reject unknown keys, `userId`, NaN/Infinity, overlong strings, oversized arrays, deep objects and unsupported schema versions before domain/model work;
- public outputs pass the committed schema, size and sensitive-field projection;
- stable failures never contain stack, SQL/database details, raw provider output, internal Prompt or sensitive learner text;
- each handler invokes only its fixed business collaborator and never Prisma/arbitrary Coach/network/file/command access;
- one MCP Tool handler never calls another MCP Tool; recursion depth remains zero.

Specific assertions:

- `search_words`: query 1–200, page max 50, rights-filtered stable results and valid empty success.
- `get_due_words`: date/timezone/current course ownership, max 100; scheduler failure never returns all learned words as if due.
- `search_learning_materials`: query max 1000/topK max 20; existing rights/access/citation/conflict rules; insufficient retrieval returns no invented evidence.
- `create_quiz`: 1–20 items/max 50 targets, one idempotent owned Exercise, no mastery/review/statistics change, no answer key/rubric in output.
- `get_learning_report`: range max 90 days/max 50 detail records; aggregates existing facts and marks missing data instead of inferring it.

## 9. Confirmation tests

Use a fake clock and two authenticated local Web users.

1. First valid `submit_answer` creates an idempotency/confirmation intent and no ExerciseSubmission, LearningAttempt, review event or item-state change.
2. URL contains only a high-entropy selector; database stores only its HMAC. It contains no token, user, client, exercise, answer or pre-authenticated authority.
3. Unauthenticated Web user and a different Web user receive indistinguishable failure and cannot view/decide the intent.
4. Confirmation page shows client, exact exercise version, answer count and all three effects: save attempt, update mastery, update review schedule.
5. Changed operation-summary digest, client, scope/grant version, exercise/version, normalized answer digest or idempotency key cannot consume the confirmation.
6. Boundaries at 4:59.999 and 5:00.000 prove the exact five-minute expiry.
7. Reject, close/cancel, expired and already-consumed intents never write.
8. Concurrent confirm/claim attempts yield one winner. A failed claimed attempt is reconciled or requires a new confirmation; it is never blindly reusable.
9. The confirmation POST never performs grading or learning writes. Only a retried original MCP call can continue.
10. A client without URL elicitation neither discovers nor directly invokes `submit_answer`, even if its token has `answer:submit`.

## 10. Idempotency and atomic learning write

- `create_quiz`: same user/client/tool/key and same fingerprint returns one Exercise and no second model cost; different fingerprint is a permanent conflict.
- `submit_answer`: same key/answers serially, concurrently and after disconnect produces one Submission, one LearningAttempt, one review event per target and one budget charge. Different content is conflict.
- Active PROCESSING returns bounded in-progress/retry-after; an expired lease enters reconciliation before retry.
- Inject failure before/after grading preparation and at every final transaction statement. Before commit, Confirmation, Submission, Attempt, review events, item state and idempotency completion all remain uncommitted/not successful.
- Crash after commit but before response is reconciled from business unique keys as `saved`/`replayed`; no second grade, cost or learning write.
- Cross-user Exercise and random non-existent Exercise produce the same outward not-found behavior and zero write.
- Client cannot supply score, mastery, review date or save status. Validated existing grading and SM-2 logic remain authoritative.

## 11. Cancellation, deadlines and governance

For both protocol eras, cancel at discovery, Resource read, RAG, model, grading preparation, immediately before transaction, during commit and after commit.

- After cancellation is observed, newly started downstream steps = 0.
- A cancellable dependency receives AbortSignal and terminates where possible.
- Before commit returns `cancelled/not_saved`; after commit returns or reconciles the one committed result.
- Session/controller/Redis cancellation state is cleaned at terminal/deadline/disconnect.

Exercise network, subject, client, subject+client and per-capability rate/concurrency gates. Verify HMAC keys, bounded retry-after, lease release and no raw identity in Redis. Test request/tool/depth/parallel/byte/schema/token/model/cost/deadline exhaustion before expensive work.

OAuth/RAG/model/Redis failures never fabricate data or saved state. If a required proof cannot be obtained, fail closed. AI idempotent replay uses saved validated grading instead of charging again.

## 12. Trace, retention and deletion

Each Resource/Tool/Prompt request must correlate one MCP Trace and optional downstream CoachTrace. Assert 100% presence of applicable protocol, authorization version, capability/schema/scope decision, governance, deadline/cancel, service/model/prompt/retrieval versions, token/cost, confirmation/idempotency and terminal/write facts.

Scan Trace/log/error/session/cache/idempotency fields for bearer/refresh tokens, raw sub/user ID, client secret, raw Tool/Prompt inputs, answer text, resource/retrieval excerpts, internal Prompt, provider response, stack and database errors; expected count is zero.

With a fake clock, prove:

- legacy session/cancel state respects idle 15 minutes and absolute ≤1 hour;
- expired/rejected confirmation private bindings clear within 24 hours;
- reconciliation leases terminalize or expire within 24 hours;
- diagnostic content is absent by default and, if explicitly enabled for test, expires within 7 days;
- Trace/authorization minimal metadata follows the proposed 180-day baseline only after governance approval;
- account deletion revokes access immediately, clears sessions/private caches/confirmations and removes user-linked MCP data within 24 hours; any retained Trace is unlinkable.

## 13. Prompt and AI evaluation

Prompt contract tests cover defaults, all enums/bounds, missing profile, malicious role/scene/expression and untrusted Resource content. Returned messages recommend only visible read Tools, do not include internal system text, do not invent personal history and state that write submission requires a separate confirmed call.

Keep two reports:

1. **Deterministic protocol/security report**: exact assertions for protocol, OAuth, scope, schema, ownership, confirmation, idempotency, cancellation, Trace and regression.
2. **AI behavior report**: tool selection/parameters, `create_quiz` personalization/CEFR/answer leakage, subjective grading consistency/error classification, Prompt injection resistance, RAG retrieval/citation quality, latency/token/cost.

Use only versioned synthetic/hand-authored isolated fixtures. Pin dataset, model, Prompt, capability/schema, source-rights, budget/price and client-matrix versions. A model judge cannot decide any deterministic security property; human review resolves disputed learning-quality labels.

## 14. Client interoperability evidence

For the release-time stable Codex, Claude Desktop, one chosen mainline IDE client and Inspector, record product/version/OS, protocol era, OAuth registration mode, negotiated capabilities, Resource/Tool/Prompt results, pagination, errors, cancellation, revocation and known limitations.

Each client independently passes connection, auth, scope-filtered discovery, one Resource, one read Tool, one Prompt, cancellation/error and revocation. Only clients that declare URL elicitation and hold `answer:submit` test/discover `submit_answer`; every other client must not see it. Inspector additionally covers the two-era negative protocol suite.

One client's success cannot compensate for another required client's failure. Any product removal or compatibility-scope reduction returns to Specify.

## 15. Release decision

Release remains blocked unless all are true:

- deterministic protocol/security and old core regressions pass 100%;
- cross-user, identity injection, unauthorized discovery/call, token/secret/internal Prompt leakage, unconfirmed write, duplicate write and fabricated citation/result/save counts are all zero;
- required Trace coverage is 100% and sensitive scan hits are zero;
- all four client categories pass independently;
- observed cancellation starts zero new downstream steps and every post-commit write resolves once;
- confirmation usability/revocation discoverability reaches the specified 90%;
- AI quality/performance/cost baseline and allowed regressions are measured in a fixed approved candidate environment.

`pending_measurement`, unapproved OAuth/source rights/budget/configuration or a closed confirmation gate means the relevant capability stays disabled. Turning every MCP gate off must leave Web, Coach, RAG, pronunciation and the existing learning loop unchanged.

## 16. Verified local scenario matrix (2026-09-11)

All commands use fake issuers/providers and synthetic/hand-authored data. The aggregate both-era E2E command below passed 6 suites / 34 tests and covers connect/discovery, resources, read Tools, quiz generation, confirmation/write, Prompts, cancellation and revocation. Deletion/retention and evaluation use the focused commands shown.

```sh
pnpm --dir server exec jest --config ./apps/ai/test/jest-e2e.json \
  --runInBand apps/ai/test/e2e/mcp-

pnpm --filter @en/server exec jest --runInBand \
  apps/ai/test/integration/mcp-retention-deletion.integration.spec.ts \
  apps/ai/test/security/mcp-public-boundary-fuzz.security.spec.ts \
  apps/ai/test/evals/mcp

pnpm --filter @en/server build
pnpm --filter @en/web type-check
pnpm --filter @en/web test:unit
pnpm --filter @en/web build
```

Verified outcomes: E2E 34/34; retention/deletion and fuzz green; MCP eval 35/35; server/Web builds and Web type-check green; Web unit tests 135/135. A clean environment needs no production secret for these tests. A disposable loopback PostgreSQL run additionally passed the MCP persistence suite 4/4 and recorded an experimental 8-client query baseline; see `evidence/query-load-baseline.md`. Real-provider/four-client execution and approved GATE-E thresholds remain pending T146, so readiness stays `NOT_READY`.
