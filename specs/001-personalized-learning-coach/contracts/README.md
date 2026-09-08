# Coach Contracts

These contracts are the Plan-phase source for later implementation and contract tests.

| File | Purpose |
|------|---------|
| `coach-api.openapi.yaml` | Authenticated HTTP lifecycle for profile, conversations, requests, streaming, cancel/retry, feedback, and deletion. |
| `coach-sse.md` | Ordered SSE event and replay contract. |
| `coach-result.schema.json` | Version 1 final result JSON Schema consumed by server and Vue. |
| `coach-tools.schema.json` | Version 1 internal tool input/output JSON Schemas. |

## Contract Rules

- Base URL remains under the existing AI application: `/ai/v1`.
- Every Coach route requires a verified access JWT. Public generic chat behavior is separate.
- No public request or tool input accepts `userId`.
- All JSON objects reject unknown properties unless a nested extension is explicitly versioned.
- IDs are opaque; ownership is rechecked from server authentication context.
- `Idempotency-Key` is required on logical request creation, retry, answer submission, cancellation, feedback update, and deletion.
- The server and Vue use Zod schemas in `@en/common/coach` as the runtime/type source of truth. The JSON Schemas in this directory are generated/checked equivalents.
- Contract version `coach.v1` can receive additive optional fields only. Removing fields, changing meaning, narrowing valid input, or changing an enum requires a new version.
- Invalid model output never becomes an API `result`; business-generated fallback objects still conform to `coach-result.schema.json`.

## Security Projection

The following never appear in these contracts:

- JWT or refresh token values
- API keys or database credentials
- system Prompt or model reasoning
- raw tool parameters/status payloads
- answer keys or grading rubrics in learner exercise objects
- another user's identifiers or data

## Stable HTTP Error Categories

```text
AUTH_REQUIRED
TOKEN_INVALID
FORBIDDEN
RESOURCE_NOT_FOUND
VALIDATION_FAILED
SCHEMA_INVALID
MATERIAL_NOT_AVAILABLE
MODEL_UNAVAILABLE
TOOL_TIMEOUT
REQUEST_TIMEOUT
BUDGET_EXCEEDED
RATE_LIMITED
IDEMPOTENCY_CONFLICT
STATE_CONFLICT
CANCELLED
INTERNAL_ERROR
```

The public error envelope contains `code`, `message`, `retryable`, `requestId`, and `traceId` when available. It never contains a raw stack or provider response.
