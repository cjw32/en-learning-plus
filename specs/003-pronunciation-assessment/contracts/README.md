# Pronunciation assessment contracts

These Phase 1 contracts describe the intended boundary; they are not an implemented or deployed API.

## Contract files

- `pronunciation-api.openapi.yaml`: authenticated public REST lifecycle under `/ai/v1`.
- `pronunciation-result.schema.json`: provider-neutral public successful/reference result.
- `pronunciation-provider.schema.json`: internal adapter result/failure envelope. Audio bytes are passed as a TypeScript `Buffer`/stream port argument and are deliberately absent from JSON.

During implementation, strict Zod schemas in `packages/common/pronunciation/` should become the runtime/type source and deterministically generate the committed JSON Schema artifacts, following the existing Coach contract pattern.

## Boundary rules

- The authenticated subject comes exclusively from the verified bearer token. Public bodies have no client-selectable subject field.
- Every target backed by WordBook, Course, RAG or Coach is resolved and authorized server-side. Returned text is not accepted as proof of authority.
- Cross-owner and nonexistent resources return the same not-found response.
- Public responses never expose storage bucket/key, permanent object URL, provider request ID, raw provider response, internal endpoint, credential or stack trace.
- Audio playback is a fresh authenticated server stream (`private, no-store`), not a public permanent URL.
- Objects are strict: unknown fields are rejected. New optional fields may be added only in a compatible schema version; changing required semantics requires a new version.
- `prosody` is explicitly `null` when unavailable. It is never synthesized.
- Confidence below `0.60` has no `PronunciationResult`; `0.60–0.79` may carry a result marked `REFERENCE_ONLY`; `>=0.80` may be `RELIABLE` but learning write still needs every independent gate.
- The outer HTTP envelope keeps numeric HTTP status semantics. Stable business failures live in `error.code` to avoid the existing numeric/string `code` ambiguity.

## Idempotency

Every mutating route requires `Idempotency-Key` except delete status reads. The server binds the key to the authenticated subject and a canonical request/content hash:

- same key + same hash: return the original resource/operation without a second Provider call or learning write;
- same key + different hash: `409 IDEMPOTENCY_CONFLICT`;
- an explicit retry creates a new assessment linked by `retryOfAssessmentId`; it does not overwrite the original history.

## Polling

Submitting returns `202`. Clients poll the assessment resource with bounded backoff (recommended 750 ms, 1 s, then 2 s) and stop on a terminal status, cancellation, page disposal or overall client deadline. There is no SSE contract in v1.

## Version set

Every reliable result pins result schema, provider adapter/API, vendor model, normalization, assessment rule, confidence policy, learning mapping, scheduler, budget and price versions. An API version must never be substituted for an unknown vendor model identity.
