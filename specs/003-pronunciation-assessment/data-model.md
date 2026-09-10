# Phase 1 Data Model: AI 发音评测

**Date**: 2026-09-10
**Database**: existing PostgreSQL through Prisma 7
**Principle**: PostgreSQL is the durable authority; Redis/queue/object storage cannot independently declare success. All names below are proposed design names, not code created by this phase.

## Relationship overview

```text
User
 └─ PronunciationAssessment 1 ── 1 PronunciationTarget snapshot
        │ 0..1
        ├──────── PronunciationAudioAsset
        │ 1..N
        ├──────── PronunciationWordAssessment
        │ 0..N
        ├──────── PronunciationProviderCall
        │ 1
        ├──────── PronunciationTrace ── N PronunciationTraceStep
        │ 0..1
        └──────── LearningAttempt(PRONUNCIATION)
                       └─ N LearningReviewEvent
                              └─ LearningItemState(PRONUNCIATION_WORD)

PronunciationDeletionTombstone
 └─ N LearningStateRecalculationEvent
```

## Enums

### PronunciationAssessmentStatus

`CREATED`, `AUDIO_VALIDATING`, `AUDIO_READY`, `QUEUED`, `PROCESSING`, `COMPLETED`, `REFERENCE_ONLY`, `UNRECOGNIZABLE`, `REJECTED`, `CANCELLED`, `TIMED_OUT`, `FAILED`, `DELETING`, `DELETED`

Allowed transitions:

```text
CREATED → AUDIO_VALIDATING → AUDIO_READY → QUEUED → PROCESSING
                  │              │           │          │
                  └─ REJECTED    └─ REJECTED ├─ CANCELLED/TIMED_OUT/FAILED
                                             └─ COMPLETED/REFERENCE_ONLY/
                                                UNRECOGNIZABLE/REJECTED

Any non-deleted state → DELETING → DELETED
Any cancellable non-terminal state → CANCELLED
```

- `COMPLETED` means a reliable structured assessment, not necessarily a successful learning write.
- `REFERENCE_ONLY` means confidence `0.60–0.79`; it never creates a learning attempt.
- `UNRECOGNIZABLE` means confidence `<0.60`; full scores/word conclusions are not exposed.
- Retry never revives a terminal row; it creates a new assessment with `retryOfAssessmentId`.

### Other enums

- `PronunciationExerciseType`: `WORD`, `PHRASE`, `SENTENCE`
- `PronunciationTargetSource`: `MANUAL`, `WORD_BOOK`, `COURSE_WORD`, `RAG_CITATION`, `COACH_EXERCISE`
- `PronunciationConfidenceTier`: `RELIABLE`, `REFERENCE_ONLY`, `REJECTED`
- `PronunciationWordStatus`: `CORRECT`, `MISPRONOUNCED`, `OMITTED`, `INSERTED`, `UNCERTAIN`
- `PronunciationAudioStatus`: `UPLOADING`, `QUARANTINED`, `VALIDATING`, `READY`, `INVALID`, `REVOKED`, `PURGING`, `PURGED`
- `PronunciationLearningWriteStatus`: `NOT_ELIGIBLE`, `PENDING`, `SAVED`, `FAILED`, `COMPENSATING`, `COMPENSATED`
- `ProviderCallStatus`: `STARTED`, `SUCCEEDED`, `UNRECOGNIZABLE`, `TIMED_OUT`, `RATE_LIMITED`, `CANCELLED`, `FAILED`, `INVALID_RESPONSE`
- `ProviderRetryDecision`: `NOT_NEEDED`, `SAFE_NOT_ACCEPTED`, `PROVIDER_IDEMPOTENT`, `UNKNOWN_ACCEPTANCE_NO_RETRY`, `LIMIT_REACHED`
- `LearningAttemptType`: existing rows become `EXERCISE`; new variant `PRONUNCIATION`
- `LearningTargetType`: add `PRONUNCIATION_WORD`; do not reuse `WORD` for speech mastery

## PronunciationAssessment

One row is the durable authority for one logical evaluation.

| Field                     | Type                  | Rules                                                                                                  |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `id`                      | String PK             | opaque cuid                                                                                            |
| `userId`                  | String FK             | from verified token context only                                                                       |
| `clientIdempotencyKey`    | VarChar(128)          | unique with `userId`                                                                                   |
| `requestBodyHash`         | VarChar(128)          | same key/different hash is conflict                                                                    |
| `contentFingerprint`      | VarChar(128)          | target hash + raw audio SHA-256 + media metadata + hashed upload idempotency key + fingerprint version |
| `retryOfAssessmentId`     | nullable self FK      | links user-requested retry lineage                                                                     |
| `status`                  | enum                  | compare-and-set transitions only                                                                       |
| `exerciseType`            | enum                  | duplicated from target for indexed query/trace                                                         |
| `confidenceTier`          | nullable enum         | derived by pinned policy                                                                               |
| `recognizedText`          | nullable text         | absent for structurally invalid results                                                                |
| `overallScore`            | nullable Decimal(5,2) | all required scores set together for complete/reference result                                         |
| `accuracyScore`           | nullable Decimal(5,2) | 0..100                                                                                                 |
| `completenessScore`       | nullable Decimal(5,2) | 0..100                                                                                                 |
| `fluencyScore`            | nullable Decimal(5,2) | 0..100                                                                                                 |
| `prosodyScore`            | nullable Decimal(5,2) | null means unavailable; never inferred                                                                 |
| `confidence`              | nullable Decimal(4,3) | 0..1                                                                                                   |
| `summary`                 | nullable text         | deterministic by default; non-authoritative LLM wording optional later                                 |
| `suggestions`             | nullable JSON         | bounded string array                                                                                   |
| `nextAction`              | nullable enum         | `RETRY`, `REVIEW`, `CONTINUE`, deterministic                                                           |
| `resultSchemaVersion`     | nullable VarChar(64)  | required with result                                                                                   |
| `resultHash`              | nullable VarChar(128) | hash of canonical public result                                                                        |
| `provider`                | nullable VarChar(64)  | adapter identity, not secret endpoint                                                                  |
| `modelVersion`            | nullable VarChar(128) | vendor-backed model identity; required for production success                                          |
| `providerAdapterVersion`  | nullable VarChar(64)  | code/contract adapter version                                                                          |
| `assessmentRuleVersion`   | nullable VarChar(64)  | score/status mapping                                                                                   |
| `normalizationVersion`    | nullable VarChar(64)  | text/token rules                                                                                       |
| `confidencePolicyVersion` | nullable VarChar(64)  | confidence formula/calibration                                                                         |
| `weaknessMappingVersion`  | nullable VarChar(64)  | learning quality projection                                                                            |
| `budgetVersion`           | nullable VarChar(64)  | approved policy                                                                                        |
| `priceVersion`            | nullable VarChar(64)  | exact regional price source                                                                            |
| `publicErrorCode`         | nullable VarChar(64)  | stable allowlisted error only                                                                          |
| `learningWriteStatus`     | enum                  | separate from assessment success                                                                       |
| `deadlineAt`              | DateTime              | overall processing deadline                                                                            |
| lifecycle timestamps      | DateTime?             | cancel/queue/start/finish/hide/delete                                                                  |

Relations: one target snapshot, zero/one audio, many words, many Provider calls, one trace, zero/one pronunciation learning attempt.

Constraints/indexes:

- `UNIQUE(userId, clientIdempotencyKey)`.
- Index `(userId, createdAt DESC, id DESC)` for owned history.
- Index `(status, deadlineAt)` for recovery/timeout sweep.
- Index `retryOfAssessmentId`.
- PostgreSQL partial unique index on `userId` for active processing states to enforce one in-flight assessment even if Redis fails.
- Complete/reference results require all four mandatory scores, confidence, schema/model/provider/rule versions and result hash.
- `COMPLETED` requires `confidence >= 0.80`; `REFERENCE_ONLY` requires `0.60 <= confidence < 0.80`; `UNRECOGNIZABLE` requires `confidence < 0.60` and no full score object.
- `cancelRequestedAt IS NULL` is rechecked in the final result/write transaction.

## PronunciationTarget

Immutable target snapshot, one-to-one with an assessment. Separating it prevents later source edits from silently changing what was scored.

| Field              | Type              | Rules                                                                                 |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------- |
| `id`               | String PK         | opaque                                                                                |
| `assessmentId`     | unique FK         | cascade with assessment until deletion tombstone                                      |
| `userId`           | String FK         | denormalized owner for defensive checks                                               |
| `sourceType`       | enum              | exactly one source variant                                                            |
| `exerciseType`     | enum              | derived from authoritative token/length rules                                         |
| `languageTag`      | VarChar(16)       | v1 allowlist `en-US`, `en-GB`                                                         |
| `referenceText`    | VarChar(200)      | max 30 English words and 200 chars                                                    |
| `normalizedTokens` | JSON              | ordered tokens with stable target positions                                           |
| `targetHash`       | VarChar(128)      | includes normalization version                                                        |
| source FKs         | nullable          | `wordId`, `courseId`, `knowledgeCitationId`, `coachRequestId`, `exerciseId`, `itemId` |
| source identity    | nullable strings  | record type/id/version/content hash/rights version                                    |
| `authorizedAt`     | DateTime          | latest successful access check                                                        |
| `expiresAt`        | nullable DateTime | source/Coach target expiration                                                        |

Validation by source:

- `MANUAL`: only text/locale; all source FKs null; never presented as cited/course content.
- `WORD_BOOK`: `wordId` required and reference text read server-side from `WordBook`.
- `COURSE_WORD`: `courseId` and authoritative word/item required; current `Course.description/url` is not lesson-text authority. Longer course text must use an authorized citation.
- `RAG_CITATION`: active `knowledgeCitationId`, exact permitted span and content hash required. Existing citation ownership/lifecycle checks are reused; a new `pronunciationAssessment` content-use right is required before third-party transmission.
- `COACH_EXERCISE`: owned active Coach resource and stable item/target identity required; client-returned free text is not authority.

All non-manual source combinations receive a database CHECK matching the discriminator. Source ownership, current version, rights and expiry are revalidated at create, Provider admission and learning write.

## PronunciationAudioAsset

Sensitive, short-lived object metadata. Bucket/object address is server-only and never part of public schemas or normal Trace.

| Field                                     | Type              | Rules                                                     |
| ----------------------------------------- | ----------------- | --------------------------------------------------------- |
| `id`, `assessmentId`, `userId`            | identifiers       | assessment relation unique                                |
| `objectKey`                               | unique String     | cryptographically random, contains no text/user/file name |
| `declaredMediaType`                       | String            | audit only; never trusted                                 |
| `detectedMediaType`, `container`, `codec` | nullable String   | set by approved probe                                     |
| `byteSize`                                | Int               | `1..8,388,608`                                            |
| `durationMs`                              | nullable Int      | READY requires `500..30,000`                              |
| `sampleRate`, `channelCount`              | nullable Int      | detected values and canonical output values               |
| `sha256`                                  | VarChar(64)       | content identity/idempotency                              |
| `qualityStatus`                           | enum/string       | bounded safe classification                               |
| `status`                                  | enum              | lifecycle below                                           |
| `expiresAt`                               | DateTime          | no later than submission + 24 h                           |
| `accessRevokedAt`, `purgedAt`             | nullable DateTime | verifiable deletion                                       |

Lifecycle: `UPLOADING → QUARANTINED → VALIDATING → READY|INVALID`; READY/INVALID reaches `REVOKED → PURGING → PURGED` on expiry/cancel/delete. Playback requires owner, READY, no revocation, no expiry and non-hidden assessment. Cancel/delete revokes synchronously; durable cleanup must finish within one hour.

## PronunciationWordAssessment

Normalized per-word facts. Maximum size is bounded by 30 targets plus bounded insertions.

| Field                    | Type                  | Rules                                                                  |
| ------------------------ | --------------------- | ---------------------------------------------------------------------- |
| `id`, `assessmentId`     | identifiers           | parent cascade/void semantics                                          |
| `sequence`               | Int                   | unique display order within assessment                                 |
| `targetPosition`         | nullable Int          | stable occurrence position; repeated words remain distinct             |
| `insertionAfterPosition` | nullable Int          | anchors inserted tokens                                                |
| `word`, `normalizedWord` | String                | bounded; escaped for display                                           |
| `startMs`, `endMs`       | nullable Int          | both null or `0 <= start <= end <= duration`                           |
| `score`                  | nullable Decimal(5,2) | 0..100                                                                 |
| `status`                 | enum                  | public five-value mapping                                              |
| `feedback`               | nullable VarChar(500) | non-diagnostic allowlisted/template output                             |
| `wordId`                 | nullable FK           | only server-authoritative WordBook mapping enables learning projection |
| `alignmentConfidence`    | nullable Decimal(4,3) | 0..1                                                                   |
| `alignmentReliable`      | Boolean               | gates learning write                                                   |
| `quality`                | nullable Int          | 0..5 candidate projection                                              |
| `mappingVersion`         | VarChar(64)           | pinned projection                                                      |

Constraints:

- `UNIQUE(assessmentId, sequence)` and partial unique `(assessmentId, targetPosition)` where position is not null.
- `INSERTED` requires no target position and no quality.
- `UNCERTAIN` requires no quality.
- `OMITTED` has a target position, no fabricated timestamp, and quality 0 only when the complete assessment is reliable and source maps to a WordBook item.
- Invalid timestamps are normalized to a null pair before persistence/public projection; they never enable seeking.

## PronunciationProviderCall

One row per actual billable-or-potentially-billable external attempt.

| Field                                                               | Type              | Rules                                                 |
| ------------------------------------------------------------------- | ----------------- | ----------------------------------------------------- |
| `assessmentId`, `attemptNo`                                         | identifiers/int   | unique pair; automatic attempts max 2                 |
| `provider`, `modelVersion`                                          | String            | model required for approved production success        |
| `providerAdapterVersion`, `apiContractVersion`, `capabilityVersion` | String            | independently versioned                               |
| `applicationConnectionId`                                           | String            | generated locally, not represented as Provider-issued |
| `providerRequestId`                                                 | nullable String   | internal only; store only if actually returned        |
| `inputHash`                                                         | String            | canonical target/audio/version hash                   |
| `status`                                                            | enum              | terminal external call classification                 |
| `providerAccepted`                                                  | nullable Boolean  | null means unknown acceptance                         |
| `startedAt`, `finishedAt`, `latencyMs`                              | timing            | bounded and consistent                                |
| `cost`, `currency`, `priceVersion`                                  | decimal/string    | potential/actual cost with approved source            |
| `failureCode`, `retryDecision`                                      | bounded enums     | safe internal classification                          |
| `lateResultDiscardedAt`                                             | nullable DateTime | proves cancellation boundary behavior                 |
| `responseHash`                                                      | nullable String   | raw response is not retained                          |

`UNIQUE(provider, providerRequestId)` applies when a request ID exists. Attempt 2 is allowed only with `SAFE_NOT_ACCEPTED` or contractually proven Provider idempotency; unknown acceptance never auto-retries.

## PronunciationTrace and PronunciationTraceStep

These reuse Coach pseudonymous-subject/HMAC and allowlist-redaction primitives but not the Coach-specific table.

`PronunciationTrace` fields include `assessmentId` unique, pseudonymous subject mapping, exercise type, target word/character counts, audio type/size/duration, Provider/model, upload/queue/decode/Provider/total latency, terminal status, confidence/tier, retry/cancel/timeout/degraded flags, learning-write status/count, estimated/actual cost, currency, all policy/schema versions and retention expiry.

`PronunciationTraceStep` uses ordered phases `UPLOAD`, `VALIDATE_AUDIO`, `QUEUE`, `PROVIDER`, `VALIDATE_RESULT`, `SAVE_LEARNING`, `PURGE`, with start/end/duration, safe status/error and strict allowlisted metadata.

Neither table may contain real `userId`, target/recognized full text, object key, bucket, URL, JWT/key, raw response, stack trace or audio bytes.

## Evolution of existing learning tables

### LearningAttempt

Current rows require Exercise, ExerciseSubmission and CoachRequest. The compatible target shape is:

- add `attemptType LearningAttemptType @default(EXERCISE)`;
- keep existing exercise flow semantics, but make `exerciseId`, `submissionId`, `saveRequestId` and `gradingHash` nullable at the schema level;
- add unique nullable `pronunciationAssessmentId` and relation;
- add `evidenceHash` and `policyVersion` for the pronunciation variant;
- enforce a database CHECK:
  - `EXERCISE`: all legacy references and `gradingHash` present, pronunciation ref absent;
  - `PRONUNCIATION`: pronunciation ref/evidence hash/policy version present, all legacy references absent.

No fake exercise/submission/Coach records and no second attempt table are allowed.

### LearningItemState and LearningReviewEvent

- Add `PRONUNCIATION_WORD` to `LearningTargetType`.
- Continue keying state by `(userId, targetType, targetKey)`; for pronunciation the key is derived from authoritative `wordId`, not word text alone.
- Add `evidenceKind`, `schedulerVersion`, `policyVersion` and nullable `voidedAt` to review events so deleted evidence can be replayed and explained.
- Reuse row locks, same-attempt uniqueness, duplicate-target lowest-quality rule, current `qualityFromScore` thresholds and `SM2_V1`.
- Only `COMPLETED`, confidence `>=.80`, currently authorized, structurally valid, uncancelled assessments can write.
- `CORRECT`/`MISPRONOUNCED` with a legal score use `qualityFromScore(score, 100)`; `OMITTED` maps to 0; `INSERTED`, `UNCERTAIN`, missing `wordId` or unreliable alignment produce no learning event.

## LearningStateRecalculationEvent

Audit generated when a full assessment deletion removes learning evidence.

Fields: `id`, `deletionId`, `itemStateId`, irreversible source attempt hash, `previousState`, `nextState`, scheduler/policy/recalculation versions, replayed event count, created/finished timestamps and status. Unique `(deletionId, itemStateId)` makes compensation retry-safe.

Compensation algorithm, in one locked transaction per deletion unit:

1. Hide assessment and mark learning write `COMPENSATING`; audio was already revoked.
2. Lock all affected item states and relevant review events.
3. Seed from the earliest retained event's `previousState` (or initial SM-2 state).
4. Replay non-void events in `(createdAt, id)` order using each event's pinned scheduler/policy version.
5. Update current item state, write recalculation before/after audit, and mark source events void.
6. Mark assessment/deletion `COMPENSATED`; then permit detailed-result/evidence purge and emit private learning/RAG summary invalidation.

Failure leaves `COMPENSATING` and retries idempotently; it never exposes a half-recomputed state as successful deletion.

## PronunciationDeletionTombstone

Prefer extracting/reusing the existing Coach deletion tombstone pattern, with scopes `PRONUNCIATION_AUDIO` and `PRONUNCIATION_ASSESSMENT`. If the existing Coach-named table is temporarily extended, record the naming debt rather than building a parallel unreliable deletion mechanism.

Store only subject/resource hashes, scope, idempotency key, status, purge deadline, timestamps and safe failure code. Audio deletion deadline is no more than one hour after revocation; normal audio expiry is no more than 24 hours after submission. Account deletion must explicitly enumerate object storage/cache/links because database cascade alone cannot remove MinIO objects.

## PronunciationEvaluationCase

Keep evaluation cases as versioned, strict JSONL fixtures rather than a production table. Each fixture contains dataset/case version, test-only audio reference and SHA-256, authorization basis/source/use/deletion constraint, target and human token/error/timestamp/score gold labels, audio conditions, expected Provider/learning/security outcome, judge/rubric/double-review/arbitration metadata and all runtime versions.

The ingestion path must never automatically import user recordings. Accent labels may only come from authorized metadata; no voice-derived demographic or sensitive inference is permitted.

## Migration sequence for a future implementation

This plan does not run a migration. A future approved implementation should:

1. Add enums/new tables/new nullable fields and default existing attempts to `EXERCISE`.
2. Backfill `attemptType`, scheduler/evidence defaults and verify every legacy row has all required old references.
3. Add indexes concurrently where operationally appropriate.
4. Deploy code that understands both variants while pronunciation flags remain off.
5. Validate XOR and range invariants with read-only queries, then add/validate database CHECK constraints.
6. Run complete existing Coach/exercise regression before enabling capture.
7. Keep Provider and learning-write gates off until external/storage/evaluation approvals pass.

Rollback must disable all pronunciation gates first. New pronunciation rows are not coerced into exercise rows; any schema rollback requires an explicit data retention/export decision rather than destructive implicit conversion.
