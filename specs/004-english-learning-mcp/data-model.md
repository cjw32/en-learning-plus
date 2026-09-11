# Data Model: English Learning MCP Server

**Feature**: `004-english-learning-mcp`
**Date**: 2026-09-11
**Status**: Design only; no Prisma schema or migration is created in this phase.

## Modeling principles

1. PostgreSQL is authoritative for subject mapping, grant state, confirmation, idempotency and learning writes. Redis is coordination only.
2. `Exercise`, `ExerciseSubmission`, `LearningAttempt`, `LearningReviewEvent` and `LearningItemState` remain the only learning facts. No MCP-specific attempt/mastery tables are introduced.
3. Protocol records contain hashes, enums, versions and business links, not bearer tokens, raw answers, private resource bodies, internal prompts or provider responses.
4. Every user-owned row cascades or participates explicitly in the existing learning-data deletion coordinator. A database cascade is a final guard, not the whole revocation/delete workflow.
5. The names and scalar types below are implementation guidance. A future migration must follow repository naming/index conventions and add database CHECK constraints where Prisma cannot express an invariant.

## Relationship overview

```text
User
 ├─ 1..* McpSubjectMapping
 ├─ 1..* McpClientAuthorization
 │       ├─ 1..* McpInvocation ── 0..1 CoachRequest ── 0..1 CoachTrace
 │       │       └─ 1 McpTrace ── 1..* McpTraceStep
 │       └─ 1..* McpIdempotencyIntent ── 0..1 McpWriteConfirmation
 │                    ├─ 0..1 Exercise
 │                    ├─ 0..1 ExerciseSubmission
 │                    └─ 0..1 LearningAttempt
 └─ existing authoritative learning facts

CoachConversation(origin=MCP)
 └─ internal CoachRequest envelope only for RAG/create/submit bridge paths
```

## New durable entities

### McpSubjectMapping

Maps an immutable subject from an approved issuer to exactly one existing user. The raw `sub` is not stored; the verifier computes an HMAC with a versioned server-held key.

| Field | Type | Required | Rules |
|---|---|---:|---|
| `id` | cuid/string | yes | Primary key |
| `issuer` | string(512) | yes | Exact normalized HTTPS issuer from approved provider |
| `subjectHmac` | string(128) | yes | HMAC of issuer + immutable sub; never a reversible encoding |
| `hmacKeyVersion` | string(64) | yes | Supports controlled key rotation |
| `userId` | FK User | yes | Existing local learner only; never auto-create |
| `status` | enum | yes | `ACTIVE`, `REVOKED`, `DELETING` |
| `linkedAt` | timestamp | yes | Auditable provisioning time |
| `revokedAt` | timestamp | no | Required when `REVOKED` |
| `createdAt`, `updatedAt` | timestamp | yes | Standard timestamps |

Constraints:

- Unique `(issuer, subjectHmac)`.
- Partial unique `(issuer, userId) WHERE status = ACTIVE`; remapping requires explicit revoke/provision workflow while preserving the old revoked audit row.
- `ACTIVE` mapping must reference an active user.
- No email, display name, client-reported subject or Web token claim may be used to bypass this table.
- User deletion changes status to `DELETING` before removing the link, so new requests fail before physical deletion completes.

### McpClientAuthorization

Local projection of one user/client authorization. The external authorization server remains authoritative for token issuance and grant validity.

| Field | Type | Required | Rules |
|---|---|---:|---|
| `id` | cuid/string | yes | Internal authorization ID |
| `userId` | FK User | yes | Must equal the subject mapping result |
| `subjectMappingId` | FK McpSubjectMapping | yes | Mapping used when authorization was observed/provisioned |
| `issuer` | string(512) | yes | Immutable |
| `audience` | string(1024) | yes | Exact canonical MCP resource URI |
| `clientId` | string(512) | yes | Verified OAuth client ID, not self-reported clientInfo |
| `clientDisplayName` | string(120) | no | Sanitized presentation only; never authorization input |
| `scopes` | string array/JSON | yes | Sorted unique subset of `learning:read`, `quiz:create`, `answer:submit` |
| `authorizationVersion` | integer | yes | Monotonic; included in cache/session keys |
| `status` | enum | yes | `ACTIVE`, `REVOKED`, `DELETING` |
| `grantedAt`, `lastSeenAt` | timestamp | yes | Minimal audit |
| `revokedAt` | timestamp | no | Required when not active |
| `retentionExpiresAt` | timestamp | no | Set on revoke/delete per approved policy |

Constraints:

- Immutable `(userId, subjectMappingId, issuer, audience, clientId)`.
- Scope set is normalized and contains no unknown value.
- Reauthorization creates a new authorization ID or increments an explicitly audited version; it never mutates identity.
- No access token, refresh token, authorization code, client secret or raw external grant payload is stored.
- Every request checks provider token state and this local status; last known `ACTIVE` cannot override uncertain provider revocation.

### McpInvocation

One attempted Resource, Tool or Prompt operation. It provides a durable correlation and terminal state even when the response stream disconnects.

| Field | Type | Required | Rules |
|---|---|---:|---|
| `id` | cuid/string | yes | Server operation ID; never taken from caller |
| `authorizationId` | FK McpClientAuthorization | yes | Current authorization projection |
| `userId` | FK User | yes | Denormalized only for scoped queries; must equal authorization user |
| `traceId` | string(128) | yes | Globally unique correlation ID |
| `protocolEra` | enum | yes | `MODERN_2026_07_28`, `LEGACY_2025_11_25` |
| `transport` | enum | yes | `STREAMABLE_HTTP` |
| `sessionIdHmac` | string(128) | no | Legacy only; raw session ID not persisted in trace |
| `protocolRequestIdHmac` | string(128) | no | Allows correlation without storing caller content |
| `capabilityType` | enum | yes | `RESOURCE`, `TOOL`, `PROMPT`, `DISCOVERY` |
| `capabilityName` | string(128) | yes | Allowlisted registered name/URI family |
| `capabilityVersion` | string(64) | yes | Manifest version |
| `inputSchemaVersion` | string(64) | no | Not applicable to all discovery calls |
| `inputFingerprint` | string(128) | no | HMAC/SHA-256 of canonical validated input; no raw input |
| `status` | enum | yes | State machine below |
| `deadlineAt` | timestamp | yes | Capability-specific hard deadline |
| `cancelRequestedAt` | timestamp | no | First observed cancellation |
| `coachRequestId` | FK CoachRequest | no | Only constrained Bridge paths |
| `idempotencyIntentId` | FK McpIdempotencyIntent | no | Required for `create_quiz`/`submit_answer` |
| `resultType` | enum | no | `SUCCESS`, `INPUT_REQUIRED`, `NOT_SAVED`, `REPLAYED`, `ERROR` |
| `safeErrorCode` | string(64) | no | Stable public code, never raw exception |
| `businessResultType` | string(64) | no | Allowlisted type such as `EXERCISE`/`ATTEMPT` |
| `businessResultIdHmac` | string(128) | no | Trace-safe link; authoritative ID stays on idempotency relation |
| `startedAt`, `finishedAt`, `createdAt`, `updatedAt` | timestamp | mixed | Lifecycle timestamps |

State machine:

```text
RECEIVED → AUTHORIZED → VALIDATED → RUNNING
RECEIVED/AUTHORIZED/VALIDATED/RUNNING → REJECTED | CANCELLED | TIMED_OUT | FAILED
RUNNING → INPUT_REQUIRED | COMPLETED | RECONCILING
INPUT_REQUIRED is terminal for that transport request; a later retry is a new invocation linked to the same intent
RECONCILING → COMPLETED | FAILED
```

Constraints:

- `traceId` unique.
- A legacy session hash is legal only for legacy era.
- A pure Resource/Prompt/read invocation must not have a CoachRequest unless it actually uses the allowlisted RAG bridge.
- `COMPLETED` has a result type and `finishedAt`; a terminal row is immutable except retention redaction/unlink.
- Cancellation after business commit results in `COMPLETED`/`REPLAYED`, not `CANCELLED`.

### McpIdempotencyIntent

Durable idempotency and cost-replay authority for `create_quiz` and `submit_answer`.

| Field | Type | Required | Rules |
|---|---|---:|---|
| `id` | cuid/string | yes | Internal intent ID |
| `userId` | FK User | yes | Authenticated owner |
| `authorizationId` | FK McpClientAuthorization | yes | Initiating grant |
| `issuer` | string(512) | yes | Identity namespace |
| `clientId` | string(512) | yes | Verified OAuth client |
| `toolName` | enum | yes | `create_quiz`, `submit_answer` only |
| `clientKeyDigest` | string(128) | yes | Digest of 16–128 char caller key; raw key not traced |
| `requestFingerprint` | string(128) | yes | Canonical normalized body + relevant resource versions |
| `logicalResource` | string(128) | no | Exercise/answer logical target, normalized |
| `status` | enum | yes | State machine below |
| `leaseOwnerHmac` | string(128) | no | PROCESSING lease, never hostname/user data |
| `leaseExpiresAt` | timestamp | no | Bounded recovery lease |
| `attemptCount` | integer | yes | Bounded retries; not model call count |
| `exerciseId` | FK Exercise | no | Set for completed create or answer target |
| `submissionId` | FK ExerciseSubmission | no | Set only after atomic submit commit |
| `learningAttemptId` | FK LearningAttempt | no | Set only after atomic submit commit |
| `gradingResult` | JSON | no | Strict, safe operation staging; encrypted/retained minimally, never raw provider result |
| `gradingResultHash` | string(128) | no | Validates staged result before reuse |
| `safeTerminalProjection` | JSON | no | Bounded public replay fields only; purgeable/reconstructable |
| `safeErrorCode` | string(64) | no | Stable error |
| `createdAt`, `updatedAt`, `finishedAt` | timestamp | mixed | Lifecycle |

Unique constraint: `(userId, issuer, clientId, toolName, clientKeyDigest)`.

State machine:

```text
RESERVED → PROCESSING → COMPLETED
PROCESSING → RECONCILING → COMPLETED | FAILED_RETRYABLE | FAILED_FINAL
RESERVED/PROCESSING → CANCELLED
FAILED_RETRYABLE → PROCESSING       (same fingerprint only, bounded lease)
```

Invariants:

- Same unique key + same fingerprint returns current/completed state; different fingerprint is permanent `IDEMPOTENCY_CONFLICT`.
- `COMPLETED` replay reconstructs from linked Exercise/Submission/Attempt where possible; it never recalls a model or rewrites learning state.
- An expired PROCESSING lease enters RECONCILING and queries authoritative unique business rows before any retry.
- Raw caller key is not placed in logs/Trace; the application may retain it only if required by existing authoritative service constraints and then under the learning record lifecycle.
- `submit_answer` completion requires both `submissionId` and `learningAttemptId`; `create_quiz` completion requires `exerciseId` and forbids the other two.

### McpWriteConfirmation

Server-verifiable, five-minute, single-use confirmation for one exact `submit_answer` intent.

| Field | Type | Required | Rules |
|---|---|---:|---|
| `id` | cuid/string | yes | Internal confirmation ID |
| `selectorHmac` | string(128) | yes | Unique HMAC of random URL selector; raw selector is never stored |
| `idempotencyIntentId` | FK McpIdempotencyIntent | yes | Unique; only submit-answer intent |
| `userId` | FK User | yes | MCP subject-mapped user |
| `authorizationId` | FK McpClientAuthorization | yes | Initiating grant |
| `issuer`, `clientId` | string | yes | Immutable binding |
| `requiredScope` | enum | yes | Literal `answer:submit` |
| `scopeSnapshotDigest` | string(128) | yes | Detects grant changes |
| `toolVersion` | string(64) | yes | Exact contract/operation semantics |
| `exerciseId` | FK Exercise | yes | Owned exercise |
| `exerciseVersion` | string(128) | yes | Exact answerable content version |
| `answerDigest` | string(128) | yes | Canonical answers; no original answers |
| `operationSummary` | JSON | yes | Allowlisted display facts: action, item count, state changes; max 4 KiB |
| `operationSummaryVersion` | string(64) | yes | Versioned UX semantics |
| `operationSummaryDigest` | string(128) | yes | Exact displayed-operation binding |
| `state` | enum | yes | `PENDING`, `CONFIRMED`, `CLAIMED`, `CONSUMED`, `REJECTED`, `EXPIRED`, `CANCELLED`, `FAILED` |
| `expiresAt` | timestamp | yes | Exactly `createdAt + 5 minutes` |
| `confirmedAt`, `claimedAt`, `consumedAt` | timestamp | no | Must match state progression |
| `confirmingWebUserIdHmac` | string(128) | no | Proof of equality without duplicate identity |
| `createdAt`, `updatedAt` | timestamp | yes | Lifecycle |

State transitions:

```text
PENDING → CONFIRMED → CLAIMED → CONSUMED
PENDING → REJECTED | EXPIRED | CANCELLED
CONFIRMED → CLAIMED | EXPIRED | CANCELLED
CLAIMED → CONSUMED | FAILED
```

Invariants:

- Unique `selectorHmac` and unique `idempotencyIntentId`.
- Confirmation page transition requires a freshly authenticated Web user whose local user ID equals `userId`; Web JWT is never copied into MCP state.
- `PENDING → CONFIRMED` and `CONFIRMED → CLAIMED` use conditional update/row lock. Only one contender can claim.
- Claim rechecks current authorization, scope, subject/client, exercise ownership/version, answer and operation digests, deadline/cancel state.
- `CLAIMED → CONSUMED` occurs in the same transaction as authoritative submission/attempt/review changes and idempotency completion.
- A `FAILED` claim is not reusable. Reconciliation either discovers the committed business rows or requires a new confirmation.

### McpTrace

One privacy-filtered trace header per `McpInvocation`.

| Field group | Fields |
|---|---|
| Correlation | `id`, unique `traceId`, `invocationId`, optional `parentCoachTraceId`, HMAC protocol request/session IDs |
| Identity | `subjectHmac`, `clientHmac`, `authorizationId`, `authorizationVersion`; never raw sub/token/secret |
| Protocol | era/version, transport, method, negotiated-capability digest, client display product/version after sanitation |
| Capability | type/name/manifest version, effect, required scope, schema versions, discovery/execution decision |
| Governance | policy version, rate/concurrency/budget result, retry count, deadline, timeout/cancellation facts |
| AI/downstream | allowlisted service names, retrieval/model/prompt/schema versions, tokens, cost, durations; no raw content |
| Write | HMAC idempotency/confirmation/business IDs; `NOT_SAVED`, `SAVED_ONCE`, `REPLAYED` |
| Terminal | result/error enum, output bytes, timestamps, retention expiry |

Constraints:

- One-to-one with `McpInvocation`; `traceId` unique.
- Metadata retention defaults to the existing 180-day baseline, pending governance approval.
- Diagnostic payload is absent by default. If an incident explicitly enables it, it is allowlisted, encrypted where supported, and expires no later than 7 days.
- Account deletion unlinks subject/client authorization data before retained non-identifying metadata can remain.

### McpTraceStep

Bounded child steps used to correlate protocol, auth, schema, domain, AI and write boundaries.

Fields: `id`, `traceId`, `sequence`, `stepType`, `component`, `operation`, `status`, `startedAt`, `finishedAt`, `durationMs`, `safeErrorCode`, optional approved version/cost/token metadata.

Rules:

- Unique `(traceId, sequence)`; maximum step count is enforced by the execution budget.
- `component` and `operation` are allowlist enums, not arbitrary service/method names.
- Step metadata rejects unknown keys and any content-like field.
- A downstream CoachTrace is linked once; its detailed steps are not copied.

## Existing entity changes

### CoachConversation

Add `origin` enum `COACH | MCP` with existing rows/default as `COACH`.

- Ordinary Coach list/query contracts explicitly filter `origin=COACH`.
- MCP Bridge uses `origin=MCP`, creates no user-visible CoachMessage, and applies bounded retention.
- A conversation must not change origin after creation.

### CoachRequest and CoachTrace

No general public contract change. MCP Bridge creates only allowlisted request input types needed by RAG/create/submit. `McpInvocation.coachRequestId` links the protocol operation; existing CoachTrace keeps model/RAG detail. Pure Resource/Prompt/ordinary read invocations have no CoachRequest.

Future implementation may add an explicit `origin` field to CoachRequest if conversation origin is insufficient for safe queries; this must default/backfill `COACH` and remain an operational discriminator, not a second identity source.

### Exercise, ExerciseSubmission, LearningAttempt, review state

They remain authoritative and owned by existing users. No alternate MCP foreign key is required when using the constrained Bridge.

The submit implementation changes orchestration, not learning semantics:

1. Resolve and verify the owned Exercise/version.
2. Produce a validated grading result without exposing a partial business submission.
3. Within the extended existing Attempt transaction, create/finalize ExerciseSubmission, create LearningAttempt, append LearningReviewEvent, update LearningItemState, consume confirmation and complete idempotency.
4. Keep existing unique keys and row locks. Injected failures leave all transaction members unchanged.

If a future implementation proves the existing service cannot accept a transaction-finalization collaborator without duplicating logic, it must return to Plan rather than weakening FR-025.

## Non-durable coordination shapes

### LegacyMcpSession (Redis + process controller registry)

Fields: opaque random session ID as lookup key; `authorizationId`, authorization version, HMAC subject/client, negotiated capabilities/scopes digest, protocol literal `2025-11-25`, created/last-seen/absolute-expiry timestamps. In-process maps may add request-ID → AbortController while the request is active.

Rules:

- Idle 15 minutes; absolute `min(token expiry, 1 hour)`.
- Every HTTP operation revalidates token/grant and compares subject/client.
- No token, raw subject, Tool input, Resource body or confirmation proof is stored.
- Delete/disconnect/expiry removes session and cancels not-yet-committed work.

### McpAdmissionLease / cancellation keys (Redis)

Keys use `mcp:` namespace and HMAC subject/client/capability/network buckets. Values contain only counters, lease IDs, expiry and safe state. Database remains authority for completed write/idempotency state.

## Read-model contracts without new fact tables

### WordDictionaryService

Repository input: validated word ID or query, optional CEFR/course filters, keyset and limit. It applies stable ordering and returns a versioned domain projection. `SourceRightsService` supplies the current field-level allowlist; disallowed phonetic/part-of-speech/exchange/example fields become unavailable rather than guessed.

### LearningResourceReadService

Resolves a course/material identifier to the active Knowledge source/document/release/chunk summary. It rechecks course entitlement, source status, content version and rights on every read. It does not return answer keys, raw storage locators or inactive source content.

### LearningReportService

Aggregates `LearnerProfileService`, `ReviewScheduleService`, `LearningAttempt`, `LearningReviewEvent` and `LearningItemState` repository facts at read time. It returns progress, review completion, recent performance, weak items/error types, snapshot/rule versions and per-dimension completeness. No cached report or inferred fact becomes authoritative.

## Deletion and retention matrix

| Data | Active lifetime | Terminal cleanup / retention | Deletion behavior |
|---|---|---|---|
| bearer token / raw sub | request only / never persisted | immediate memory release | no durable copy |
| legacy session/cancel coordination | idle 15m, absolute ≤1h | immediate on close/expiry | cancel and purge Redis/in-memory state |
| pending confirmation | exactly 5m | rejected/expired binding cleared ≤24h | cancel immediately, remove private summary |
| reconciliation lease | while processing | ≤24h | reconcile or terminalize before purge |
| idempotency business link | related Exercise/Attempt lifecycle | safe projection can be purged/reconstructed | user delete cascades/unlinks |
| authorization minimal fact | active grant | revoked fact ≤180d pending approval | revoke first; private link purge ≤24h |
| MCP Trace metadata | request | 180d existing baseline pending approval | unlink subject/client; retain only allowed non-identifying fact |
| diagnostic content | disabled by default | ≤7d only when explicitly approved | immediate purge on user deletion/incident close |

Backups must not reactivate a revoked authorization, confirmation or session. Restore procedures must replay revocation/deletion tombstones before accepting MCP traffic.

## Migration outline for a future approved implementation

This plan does not create or run a migration. A later implementation should:

1. Add enums and new MCP tables/relations; add `CoachConversation.origin` with default `COACH`.
2. Backfill/verify every existing conversation as `COACH`; do not alter Exercise/Submission/Attempt facts.
3. Add unique/index/check constraints, including confirmation state/timestamp invariants and idempotency key domain.
4. Deploy schema-aware code with every MCP gate off and no OAuth production adapter selected.
5. Validate cascades, query plans, two-user ownership and old Coach/RAG/learning regressions on disposable data.
6. Enable only fake/local protocol tests; production traffic remains closed until all plan gates pass.

Rollback begins by disabling all MCP gates and revoking active MCP grants/sessions. It must not delete authoritative Exercise/Attempt rows that were validly created through MCP. Any schema rollback therefore requires an explicit retention/export decision rather than destructive coercion.
