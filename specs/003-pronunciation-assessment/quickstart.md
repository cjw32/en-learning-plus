# Quickstart: validate the AI pronunciation assessment implementation

This is an implementation-verification guide, not permission to cross a closed release gate. Validation must not install `ffmpeg`, add packages, edit environment/PM2/Docker/MinIO configuration, run production database migrations, call Azure, upload real learner recordings, push or deploy.

## 1. Planning artifact checks

Run from the repository root:

```bash
test -f specs/003-pronunciation-assessment/spec.md
test -f specs/003-pronunciation-assessment/plan.md
test -f specs/003-pronunciation-assessment/research.md
test -f specs/003-pronunciation-assessment/data-model.md
test -f specs/003-pronunciation-assessment/quickstart.md
test -f specs/003-pronunciation-assessment/requirements-traceability.md
test -f specs/003-pronunciation-assessment/tasks.md
test -f specs/003-pronunciation-assessment/implementation-evidence.md
test -f specs/003-pronunciation-assessment/contracts/pronunciation-api.openapi.yaml
jq empty specs/003-pronunciation-assessment/contracts/pronunciation-result.schema.json
jq empty specs/003-pronunciation-assessment/contracts/pronunciation-provider.schema.json
rg -n 'NEEDS CLARIFICATION|\[FEATURE\]|\[DATE\]|\[###-feature' \
  specs/003-pronunciation-assessment/plan.md \
  specs/003-pronunciation-assessment/research.md \
  specs/003-pronunciation-assessment/data-model.md \
  specs/003-pronunciation-assessment/requirements-traceability.md \
  specs/003-pronunciation-assessment/contracts
```

Expected now: required files exist, JSON parses, and the placeholder search returns no matches. `tasks.md` is the reviewed implementation boundary and task state is backed by executed evidence.

The OpenAPI YAML should be parsed during implementation with an already-approved repository tool or the project runtime; do not add a YAML dependency merely to validate this plan.

## 2. Protected-file guard

Compare the protected paths to the implementation-start baseline and review them explicitly:

```bash
git diff -- package.json server/package.json apps/web/package.json pnpm-lock.yaml server/pnpm-lock.yaml
git diff -- server/Dockerfile server/ecosystem.config.js
git status --short
```

Expected for implementation: no dependency, lockfile, Docker, PM2 or environment change. Feature source, tests, contracts, Prisma schema/migration and documents may change; production migration execution remains prohibited.

## 3. Authorization gates before implementation

Do not start the dependent work until each applicable owner explicitly approves and evidence is recorded:

| Gate                        | Required evidence                                                                                   | Work blocked while closed                       |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Audio decoder/runtime       | Explicit approval for `ffmpeg`/`ffprobe` or equivalent; fixed version and sandbox limits            | Server audio acceptance and real Provider calls |
| Private object storage      | Private bucket exists, anonymous access absent, lifecycle ≤24h, backups excluded, delete SLA tested | Any server-side audio persistence               |
| Provider model identity     | Vendor-backed immutable scoring model/revision or enforceable change notice                         | Production Provider adapter                     |
| Privacy and region          | Region, subprocessors, zero retention/no training and minimum-data contract approved                | Provider calls                                  |
| Source usage rights         | Explicit right to send selected course/RAG text for pronunciation assessment                        | Non-manual third-party targets                  |
| Price and budgets           | Versioned regional price plus approved per-call, subject-day, system-day, system-month caps         | Provider admission                              |
| Evaluation dataset          | Provenance/authorization, annotations and deletion constraints approved                             | Live evaluation and learning write              |
| Quality/fairness thresholds | Baseline accepted; all zero-tolerance cases pass                                                    | Production and learning-write gates             |

Unknown/missing evidence is a closed gate, not a permissive default.

## 4. Build and regression commands

Use the repository's existing toolchain:

```bash
pnpm --filter @en/server build
pnpm --filter @en/server test
pnpm --filter @en/web type-check
pnpm --filter @en/web test:unit
pnpm --filter @en/web build
```

Also run existing Coach, RAG, course, WordBook and ordinary exercise regression suites with every pronunciation gate off. The test double must assert zero pronunciation Provider calls.

## 5. Contract validation matrix

- Strict Zod schemas reject unknown keys, invalid enum values, NaN/Infinity, score values outside 0–100, confidence outside 0–1 and oversized strings/arrays.
- Generate JSON Schema twice and prove byte-for-byte deterministic output matching committed artifacts.
- Confirm no public request contains a caller-selectable identity field.
- Confirm no public response contains storage location, permanent URL, Provider request ID, raw response, internal endpoint or stack.
- Verify `prosody: null` when unavailable; never allow missing/guessed values.
- Verify timestamps are both null or a legal ordered pair within audio duration.
- Verify inserted words have no target position; repeated target words retain distinct positions.
- Verify confidence `<.60` produces no full result, `.60–.79` is `REFERENCE_ONLY`, and `>=.80` does not itself bypass other learning gates.
- Verify the HTTP envelope keeps numeric status in the outer `code` and stable business enum in `error.code`.

## 6. Web recorder tests

### Capability and formats

- Secure context, `navigator.mediaDevices.getUserMedia`, `MediaRecorder` and actual `MediaRecorder.isTypeSupported` are checked separately on every attempt.
- Prefer WebM/Opus where actually supported; fall back to MP4/AAC. No User-Agent-only allowlist.
- Cover current/previous desktop Chrome, Edge, Firefox, Safari, Android Chrome and iOS Safari. Playwright Chromium/Firefox/WebKit is useful but does not replace real iOS/Android device evidence.

### State and cleanup

- Test permission explanation before the user gesture, denied permission, no device, device removal, permission revocation and unsupported browser.
- Test `READY → RECORDING → RECORDED → UPLOADING → ANALYZING → terminal`; no pause/resume exists for a scored recording.
- Local controls react within 300 ms, duration/waveform is visible without interpreting content, and statuses are not color-only.
- Enforce 500 ms minimum, 30 s maximum, 8 MiB maximum and 30-word/200-character target bounds at the earliest safe point, then independently on the server.
- Route leave, cancel and re-record release every media track, `AudioContext`, analyser, timer and object URL.
- Audio Blob/object URLs remain in a non-persisted store. Never enable the repository's Pinia persistence plugin for raw audio state.
- Upload overrides the global Axios timeout to 30 s and supports cancellation; result polling stops on terminal/disposal/deadline.

## 7. Audio security tests

Use synthetic/non-human fixtures for parser attacks. Before any Provider invocation, cover:

- declared MIME, extension, signature, container and codec mismatch;
- truncated/corrupt/polyglot files and trailing payload;
- multiple tracks, deceptive duration metadata and invalid timestamps;
- over 8 MiB, under 500 ms, over 30 s, extreme sample rate/channel count;
- decode timeout, excessive output/CPU/memory and malformed codec frames;
- silence, low volume, clipping, continuous noise, insufficient speech and obvious non-target language.

The approved audio subprocess adapter must use a fixed executable, argument array without a shell, protocol/codec allowlists, no network, random temporary paths, concurrency and time/CPU/memory/output limits, stdout/stderr caps, kill-on-timeout, post-conversion probe and cleanup on all exits.

If the decoder/runtime is absent or unapproved, capability checks must fail closed before Provider admission. MIME/magic-only validation is not an acceptable production fallback.

## 8. Lifecycle and Provider tests with fakes

- Word, phrase and sentence happy paths, including `prosody = null`.
- Confidence boundaries `.59`, `.60`, `.79`, `.80`.
- Missing mandatory score, out-of-range score, contradictory error type, unmappable repeated word, and invalid/partial timestamp.
- Provider timeout, 429, 5xx, malformed response and unknown request acceptance.
- One concurrent assessment per subject, 6/minute, 120/day.
- Missing price version or any missing/exceeded budget closes admission.
- Each logical assessment normally has one call. Attempt 2 occurs only for proven non-acceptance or contractually idempotent replay.
- Cancel at upload, queue, Provider, result-validation and learning-transaction boundaries. Late results are billed/audited if applicable but never saved as learning facts.
- Same idempotency key/hash replays the original operation; same key/different hash is 409. User retry creates a new linked assessment.
- Queue replay/worker crash cannot duplicate Provider ledger rows, attempts, review events or budget charge.

## 9. Ownership and privacy tests

With two test subjects, attempt read, stream, upload, submit, retry, cancel, delete and source/attempt association across owners. Every operation must have zero success and the same external not-found behavior as a random identifier.

Also verify:

- payload, Prompt or Provider content cannot change the authenticated subject;
- queue payload contains only `assessmentId`;
- Provider input contains only canonical audio, reference text, locale and technical connection metadata;
- audio and full text never enter logs, Coach prompts/memory, Redis queue payload, ordinary backups or Trace;
- playback re-authorizes each request and uses `private, no-store`;
- cancel/delete revokes playback immediately, purge finishes within one hour, normal expiry within 24 hours;
- account deletion explicitly cleans database rows, object storage, cache, temporary access and subject mapping.

## 10. Database and learning tests

Use disposable PostgreSQL and Redis/MinIO instances only after implementation approval.

- Migration backfills every legacy `LearningAttempt` as `EXERCISE` and proves old required relationships remain valid.
- XOR constraint rejects incomplete exercise attempts and pronunciation attempts carrying fake exercise/Coach references.
- Partial active-assessment unique index remains correct if Redis is unavailable.
- Concurrent duplicate submit yields one Provider ledger entry, one `LearningAttempt`, one review event per target and one budget settlement.
- Inject failure after each transactional step; result/attempt/events/item state either all commit or all roll back.
- Reliable mapped word scores use existing quality thresholds; omitted maps to 0; inserted/uncertain/unmapped/manual items do not write. Repeated occurrences for one item use the lowest quality.
- Low confidence, invalid schema/audio, cancelled, expired/revoked source, rights failure and cross-owner cases never change learning state.
- A successful assessment with a failed learning transaction is visibly `learningWriteStatus = FAILED`, not misreported as saved.
- Delete earliest, middle and latest pronunciation attempts; replay remaining events to the exact expected state, create one idempotent recalculation audit per affected item, and invalidate/rebuild private learning summaries.

## 11. Storage and deletion tests

Against a disposable private MinIO bucket and fake clock:

- startup validation rejects absent bucket or anonymous-read policy and never mutates production policy at runtime;
- stored keys reveal no subject, target or original filename;
- no object is available without service authorization;
- cancellation/deletion immediately changes database access state even if object deletion temporarily fails;
- cleanup scanner uses durable database claims/idempotency so clustered AI processes cannot double-purge;
- retries eventually reach `PURGED` before the one-hour deadline;
- normal assets expire within 24 hours and never enter backup fixtures;
- tombstones contain only irreversible hashes, scope, safe status and timestamps.

## 12. Trace and redaction tests

Every logical assessment must connect upload attempts, audio validation, queue, Provider calls, result validation, cancellation/retry, costs and learning write. Assert 100% coverage of required durations/versions/terminal state.

Scan trace/log/error payloads for bearer tokens, API keys, real subject IDs, target/recognized full text, audio bytes, object keys, bucket names, storage URLs, raw Provider responses and stack traces; expected occurrence is zero. Cross-owner trace query success is zero.

## 13. Evaluation and release report

Use only versioned JSONL cases with authorization provenance. Report, without collapsing blockers into one composite score:

- WER as `(substitutions + deletions + insertions) / reference words`, without truncating values above 1;
- precision/recall/F1 for mispronounced, omitted and inserted statuses separately;
- timestamp MAE and P95 error;
- score versus human-gold MAE and correlation;
- repeated-run maximum/mean absolute score delta;
- bad-audio rejection true/false-positive rates;
- first-pass/final Schema rate, Provider success, P50/P95 latency and cost;
- invalid-learning-write and cross-owner leakage counts;
- matched-human-score accent-group mean residual difference.

Fixed spec gates: eligible request Provider success `>=99%`, repeated overall-score maximum difference `<=5`, matched acceptable-accent group anomaly gap `<=5`, upload-to-terminal P95 `<=15 s`, and every call over 30 s times out without learning write. Other quality thresholds remain “pending measurement” until the first candidate baseline is reviewed; they must not be invented.

Live Azure evaluation is disabled by default and additionally requires test-only credentials, Provider/privacy/model approval, an authorized dataset and a positive bounded evaluation budget. Cross-owner access, sensitive leakage, unauthorized samples, invalid/cancelled learning writes, fabricated prosody and malicious-audio bypass are zero-tolerance release blockers.

## 14. Progressive rollout

Enable independently, with rollback at each gate:

1. recording UI with local-only audio and no server submission;
2. private upload/audio validation with fake Provider;
3. approved Provider calls with results hidden from learning state;
4. structured result display after evaluation approval;
5. learning write after mapping/fairness/security approval;
6. Coach minimal-summary recommendation.

Turning all pronunciation gates off must restore existing behavior immediately, prevent new external calls and leave Coach/RAG/WordBook/Course/ordinary exercises fully operational.
