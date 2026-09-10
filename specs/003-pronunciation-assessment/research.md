# Phase 0 Research: AI 发音评测

**Date**: 2026-09-10
**Status**: Complete for planning; external enablement decisions remain explicit rollout gates
**Method**: inspected repository architecture/dependencies and compared official Provider documentation. No dependency, configuration, code or external service was changed.

## Decision 1: Keep the feature inside the existing Web + AI app + learning library

**Decision**: Use the existing Vue Web app for capture/presentation, the existing NestJS AI app for orchestration and external scoring, and `server/libs/learning` for authoritative targets and learning-state projection.

**Rationale**:

- JWT authentication and immutable subject extraction already exist in shared auth.
- The AI app already has BullMQ/Redis patterns for queued, cancellable, budget-governed external work.
- The learning library already owns `LearningAttempt`, item state, review events and the SM-2 scheduler.
- The knowledge/RAG layer already owns citation lifecycle and access revalidation.
- Keeping one deployable backend avoids a new service, transport, deployment path and operational dependency.

**Alternatives considered**:

- Put scoring into the ordinary server app: rejected because external AI governance and queues already live in the AI app.
- Route it through Coach/LangGraph: rejected because scoring is deterministic/provider-driven and raw audio must not enter prompts or Coach memory.
- Add a pronunciation microservice: rejected for v1 because it duplicates auth, queue, storage and deployment concerns without proven scale need.

## Decision 2: Use a dedicated provider-neutral port with Azure as the sole first adapter candidate

**Decision**: Define `PronunciationAssessmentProvider` first; target Azure Speech Pronunciation Assessment short-audio REST for the first adapter, default disabled until all gates pass.

**Rationale**:

- Azure scripted assessment exposes overall pronunciation, accuracy, completeness, fluency, optional prosody, word offsets/durations, word accuracy and miscue types suitable for the confirmed contract.
- Google Cloud Speech-to-Text V2 supplies ASR transcript/confidence/timestamps but no required reference-text pronunciation score dimensions or miscue contract.
- Amazon Transcribe's `PRONUNCIATION` item type identifies a spoken-word token; it is not a pronunciation-quality score and does not meet the spec.
- A provider-neutral boundary prevents Azure's raw shape and error taxonomy from entering UI or learning records.

**Alternatives considered**:

- Multi-provider averaging: rejected by the confirmed spec and because score scales are not interchangeable.
- Google/AWS as first provider: rejected because mandatory scoring capabilities are missing.
- Self-hosted model: out of scope and would create training, fairness and infrastructure work not justified for v1.

**Official sources** (accessed 2026-09-10):

- [Azure Pronunciation Assessment overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/pronunciation-assessment-tool)
- [Azure Pronunciation Assessment how-to](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)
- [Google Cloud Speech-to-Text V2 recognition REST](https://cloud.google.com/speech-to-text/v2/docs/reference/rest/v2/projects.locations.recognizers/recognize)
- [Amazon Transcribe streaming Item API](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_streaming_Item.html)

## Decision 3: Call Azure REST with native fetch, not a new SDK

**Decision**: When authorized, call the short-audio REST endpoint using Node's existing native `fetch` and `AbortController`.

**Rationale**:

- The request is one synchronous short-audio operation with a small adapter surface.
- Native fetch supports the 30-second deadline and cancellation signal.
- It avoids adding an SDK dependency and reduces transitive package/security surface.
- Provider API version, application connection ID and returned Provider headers can be captured distinctly.

**Alternatives considered**:

- Azure Speech SDK: not selected for v1 because its realtime/session features are unnecessary for upload-after-recording and would add a dependency.
- Browser-to-Provider direct calls: rejected because it would expose credentials and bypass auth, budgets, retention and result validation.

## Decision 4: Treat Provider model identity as a production gate

**Decision**: `modelVersion` must mean a vendor-backed scoring model/revision identity. An API version, endpoint region or locally invented label cannot satisfy it. If the Provider cannot expose or contractually attest an immutable identity/change policy, production assessment remains disabled.

**Rationale**:

- The public Azure response documents assessment and recognition results but does not expose the underlying pronunciation model revision.
- Replay explanation and version regression require knowing when the scoring engine changes.
- Fabricating a model version would falsely satisfy FR-024/FR-075/FR-084 and undermine fairness/stability baselines.

**Alternatives considered**:

- Store the REST API version as `modelVersion`: rejected because it versions the protocol, not necessarily the scoring model.
- Store `unknown`: acceptable only for development fixtures; the confirmed spec requires queryable model version for production.

## Decision 5: Normalize browser formats through a separately approved, sandboxed audio toolchain

**Decision**: Accept WebM/Opus and MP4/AAC at the API, validate their actual container/codec, then emit 16 kHz mono 16-bit PCM WAV for Azure. The intended implementation uses constrained `ffprobe`/`ffmpeg` subprocesses only after explicit dependency approval.

**Rationale**:

- Azure short-audio REST documents PCM WAV and OGG/Opus constraints; it does not promise direct WebM/Opus or MP4/AAC ingestion.
- Current Web browsers need the two confirmed container options for cross-browser capture.
- Server-side canonicalization makes duration, channel, sample-rate, quality and Provider input deterministic.
- Repository and local runtime inspection found no existing audio parser/transcoder or `ffmpeg`/`ffprobe` binary.

**Required controls**: fixed executable path, no shell interpolation, byte/time/CPU/memory/output caps, protocol allowlist, no network, random temporary paths, magic/container verification, post-conversion re-probe and cleanup on all exits.

**Alternatives considered**:

- Trust client MIME/extension: rejected as unsafe and explicitly forbidden by the spec.
- Send browser bytes directly to Azure: rejected because format support does not match.
- Add a JavaScript/WASM decoder: not selected; it would add a large dependency and still needs security/performance review.

**Official source**: [Azure short-audio REST format requirements](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short) (accessed 2026-09-10).

## Decision 6: Reuse MinIO infrastructure, but never the public avatar bucket

**Decision**: Reuse the existing MinIO client/cluster integration with a dedicated private audio bucket and lifecycle, pending production configuration approval.

**Rationale**:

- Existing `MinioService` proves the repository already operates object storage.
- Its current startup policy grants public read for `avatar/*`; pronunciation audio is sensitive and cannot inherit that policy.
- A separate bucket makes private ACL, no-public-policy, 24-hour expiration, cache invalidation and backup exclusion independently auditable.

**Alternatives considered**:

- Store audio in PostgreSQL: rejected due to large binary/TTL/streaming concerns.
- Reuse the avatar bucket with another prefix: rejected because bucket-level policy behavior creates accidental exposure risk.
- Keep audio only in process memory: rejected because asynchronous processing and optional cross-session playback need durable short-lived storage.

## Decision 7: Persist durable state in PostgreSQL; use Redis only for coordination

**Decision**: Assessment/idempotency/provider-call/learning-write state is authoritative in PostgreSQL. BullMQ and Redis carry IDs, locks, rate counters and cancellation signals.

**Rationale**:

- This mirrors existing Coach patterns while surviving worker/Redis retries.
- A queue message containing only `assessmentId` avoids replicating audio, target text or user details.
- Database compare-and-set transitions make cancel/result/write races testable.

**Alternatives considered**:

- Store the workflow entirely in BullMQ: rejected because queue history is not the product/audit source of truth.
- Put audio or full Provider request in the queue: rejected for privacy and size.

## Decision 8: Extend `LearningAttempt`, do not create a parallel attempt source

**Decision**: Add a discriminated `LearningAttemptType` (`EXERCISE`, `PRONUNCIATION`), make exercise-only references nullable, add a unique optional pronunciation relation, and enforce an XOR database constraint after backfill.

**Rationale**:

- Current `LearningAttempt` requires `exerciseId`, `submissionId` and `saveRequestId`, so a pronunciation attempt cannot be represented without fake Coach/exercise rows.
- Synthetic rows would corrupt domain meaning and couple pronunciation to LangGraph.
- The confirmed spec explicitly requires one learning-attempt authority.
- A staged compatible migration keeps current exercise paths unchanged while adding a legitimate second variant.

**Alternatives considered**:

- Create `PronunciationAttempt` as a second learning fact table: rejected by FR-051.
- Create fake ExerciseSubmission/CoachRequest records: rejected as misleading and operationally coupled.
- Put pronunciation evidence only in JSON on existing item state: rejected because it loses attempt identity, idempotency and auditability.

## Decision 9: Separate pronunciation mastery from vocabulary/error-type mastery

**Decision**: Add `PRONUNCIATION_WORD` to `LearningTargetType`; use existing SM-2 state mechanics with the existing score-to-quality boundaries.

**Rationale**:

- A learner may know a word's meaning/spelling but mispronounce it; using `WORD` would conflate distinct skills.
- Reusing `LearningItemState` and `LearningReviewEvent` preserves due-date and Coach due-item infrastructure.
- Only reliable target-position evidence can affect pronunciation state; inserted/uncertain tokens never reduce vocabulary mastery.

**Initial mapping to evaluate**: reuse current `AttemptService.qualityFromScore`: `90–100→5`, `75–89→4`, `60–74→3`, `40–59→2`, `1–39→1`, omitted/no confirmed score `→0`. This becomes `pronunciation-quality.v1` and remains behind the learning-write gate until calibrated.

## Decision 10: Use deterministic alignment and conservative confidence

**Decision**: Normalize Unicode/case/punctuation with a versioned expansion policy, then align target and recognized token sequences by deterministic dynamic programming. Set normalized confidence to `min(valid provider recognition confidence, alignment coverage)` after hard structural/audio checks.

**Rationale**:

- Position-aware sequence alignment handles repeated words, omitted words, insertions and reordering without merging identical tokens.
- Provider pronunciation scores are performance measures, not certainty; ASR confidence and alignment coverage better represent result reliability.
- Taking the minimum is conservative and honors the fixed `<.60`, `.60–.79`, `>=.80` bands.

**Alternatives considered**:

- Use overall pronunciation score as confidence: rejected because ability and certainty are different concepts.
- Average signals: rejected because a high signal can hide a structurally weak alignment.
- Let an LLM align or revise scores: rejected as nondeterministic and forbidden for core results.

## Decision 11: Poll durable status rather than add realtime transport

**Decision**: Create/upload/submit through REST, return `202 Accepted`, then poll `GET /assessments/{id}` with bounded backoff; use existing Axios upload progress.

**Rationale**:

- Assessment duration is short, states are durable and v1 does not require streaming tokens/audio.
- Polling survives page reconnect and avoids new dependencies/protocol state.
- Existing SSE infrastructure remains available for future need but is not required now.

## Decision 12: Keep pronunciation Trace separate while reusing governance patterns

**Decision**: Add pronunciation-specific trace/provider-call records, borrowing redaction, pseudonymous subject, versioning, budgeting and cancellation semantics from Coach.

**Rationale**:

- Existing `CoachTrace` requires prompt/model/token fields and a `CoachRequest`; forcing pronunciation into it would create fake data.
- Speech calls need audio metadata, decode latency, provider acceptance/billing and learning-write fields that Coach Trace does not model.
- Separate storage prevents raw response/audio leakage while still enabling one logical trace to link all attempts.

## Decision 13: Delete by revoke + recompute + audited adjustment

**Decision**: Audio-only deletion preserves structured results/history. Full assessment deletion immediately hides details, revokes audio, then recomputes affected pronunciation item state from remaining eligible events in chronological order and records before/after adjustment evidence.

**Rationale**:

- Removing an evidence-producing assessment must remove its current learning impact.
- Mutating old review-event snapshots silently would destroy auditability.
- Replaying remaining deterministic events yields explainable state under pinned scheduler/mapping versions; an adjustment record explains the change.

## Decision 14: Fail closed on content rights, privacy, price and retry ambiguity

**Decision**: RAG/course content sent to a third party requires a new explicit `pronunciationAssessment` usage right; Provider use also requires approved region/privacy evidence, a dynamic regional price catalog and all four budget levels. Unknown request acceptance is considered potentially billable and is not automatically retried.

**Rationale**:

- Current RAG rights for embedding/excerpt display/evaluation do not automatically authorize third-party speech assessment.
- Azure documents speech privacy behavior, but the exact production region/configuration still needs explicit approval.
- Pricing changes by region and optional prosody capability; remembered or hard-coded prices are unsafe.
- Connection abort is not proof that the Provider did not accept/process the request.

**Official sources** (accessed 2026-09-10):

- [Azure Speech data privacy and security](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-to-text/data-privacy-security)
- [Azure Speech quotas and limits](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits)
- [Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/speech/)
- [Azure Speech language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)

## Resolved unknowns and remaining rollout gates

All architecture questions needed for Plan are resolved. The following are intentionally not guessed and do not require a new product decision; they are evidence/authorization gates before implementation or release:

| Gate                             | Owner/evidence required                                        | Fail-closed behavior                                       |
| -------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| Audio runtime dependency         | User approval plus security/resource-limit review              | Reject upload before Provider; Provider call disabled      |
| Private bucket/config            | User/ops approval, lifecycle and backup exclusion verification | Audio persistence and Provider call disabled               |
| Provider model identity          | Vendor-backed immutable identity/change notice                 | Production adapter disabled                                |
| Region/privacy/subprocessors     | Approved region and current legal/security evidence            | Provider disabled                                          |
| Third-party source-content right | Explicit rights version for pronunciation assessment           | Only manual/locally authoritative eligible targets proceed |
| Prices and budgets               | Versioned regional catalog + 4 approved caps                   | New Provider calls rejected                                |
| Quality/fairness baseline        | Authorized dataset and approved thresholds                     | Learning write and production rollout disabled             |
| Prosody                          | `en-US` support plus separate price approval                   | Return `prosodyScore: null`                                |
