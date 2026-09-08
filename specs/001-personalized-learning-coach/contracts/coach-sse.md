# Coach SSE Contract v1

**Endpoint**: `GET /ai/v1/coach/requests/{requestId}/events`
**Authentication**: Bearer access JWT; request ownership is rechecked before replay or live subscription.
**Media type**: `text/event-stream`
**Replay**: Client sends `Last-Event-ID`; server resumes after that event while the one-hour Redis replay buffer exists.

## Envelope

Every SSE `data` value is one JSON object:

```text
{
  schemaVersion: "coach.sse.v1",
  eventId: string,
  requestId: string,
  sequence: number,
  timestamp: ISO-8601 UTC string,
  type: EventType,
  payload: EventPayload
}
```

Rules:

- `eventId` is opaque and unique within a request.
- `sequence` starts at 0 and strictly increases by 1 for stored non-heartbeat events.
- Replayed events keep the same ID and sequence.
- The client deduplicates by `eventId` and never appends the same `content_delta` twice.
- The server persists the final validated result before emitting `completed`.
- `heartbeat` events may omit sequence advancement and contain no application data.
- No envelope contains a JWT, user ID, Prompt, model reasoning, raw tool arguments, answer key, database error, or stack.

## Event Types

### `connected`

First event after authorization and subscription.

```text
payload: {
  status: "QUEUED" | "RUNNING" | terminal request status,
  replayedThrough: number | null
}
```

If the request is already terminal and its replay buffer exists, the server replays stored events. If the buffer expired, the stream returns HTTP 410 and the client reads `GET /coach/requests/{requestId}`.

### `status`

High-level workflow state safe for the learner.

```text
payload: {
  step:
    | "validating"
    | "understanding"
    | "personalizing"
    | "finding_materials"
    | "generating"
    | "grading"
    | "saving"
    | "recommending"
    | "finalizing",
  label: string
}
```

Allowed labels are server-owned localized messages such as:

- 正在检查请求
- 正在理解你的学习需求
- 正在读取你的学习进度
- 正在查找相关学习材料
- 正在生成适合你的内容
- 正在批改答案
- 正在保存学习进度
- 正在准备下一步建议

The model cannot supply `label`.

### `tool_status`

Friendly tool lifecycle without parameters or raw result.

```text
payload: {
  tool:
    | "get_learner_profile"
    | "get_due_words"
    | "search_learning_materials"
    | "create_exercise"
    | "grade_answer"
    | "save_attempt",
  state: "started" | "succeeded" | "failed" | "skipped",
  label: string,
  retryable: boolean | null
}
```

Tool names are stable codes for typed UI mapping. Labels remain user-friendly. A failure event never includes provider/SQL errors.

### `content_delta`

Incremental learner-visible text.

```text
payload: {
  channel: "explanation" | "correction" | "example" | "progress",
  delta: string
}
```

Rules:

- `delta` is display-only and length bounded.
- It is not parsed as the final object.
- The UI marks streamed text provisional until `result`.
- Internal reasoning and hidden exercise answers are forbidden.
- If final validation fails, the UI discards/marks provisional content and renders the valid degraded result.

### `result`

Exactly one authoritative final object for a successful or degraded request.

```text
payload: {
  result: CoachResultV1
}
```

`CoachResultV1` must validate against `coach-result.schema.json`. The server—not the browser—performs schema, citation, authorization, and scenario-consistency checks before emission.

### `completed`

Terminal acknowledgement after `result`.

```text
payload: {
  status: "COMPLETED",
  resultEventId: string,
  learningSaveStatus: "saved" | "replayed" | "not_saved" | "not_applicable"
}
```

No events except heartbeat are emitted afterward.

### `cancelled`

Terminal cancellation.

```text
payload: {
  status: "CANCELLED",
  saveStatus: "NOT_STARTED" | "NOT_SAVED" | "SAVED_ONCE" | "NOT_APPLICABLE",
  message: string
}
```

If the learning transaction had already committed, `SAVED_ONCE` is required. The client must not describe that request as “not saved.”

### `error`

Terminal request failure or safe budget stop.

```text
payload: {
  code:
    | "AUTH_REQUIRED"
    | "TOKEN_INVALID"
    | "FORBIDDEN"
    | "RESOURCE_NOT_FOUND"
    | "VALIDATION_FAILED"
    | "SCHEMA_INVALID"
    | "MATERIAL_NOT_AVAILABLE"
    | "MODEL_UNAVAILABLE"
    | "TOOL_TIMEOUT"
    | "REQUEST_TIMEOUT"
    | "BUDGET_EXCEEDED"
    | "RATE_LIMITED"
    | "IDEMPOTENCY_CONFLICT"
    | "STATE_CONFLICT"
    | "CANCELLED"
    | "INTERNAL_ERROR",
  message: string,
  retryable: boolean,
  retryAfterSeconds: number | null,
  saveStatus: "NOT_STARTED" | "NOT_SAVED" | "SAVED_ONCE" | "NOT_APPLICABLE"
}
```

If a business-generated degraded `result` can safely satisfy the request, emit `result` then `completed` instead of `error`. Never emit a fabricated score or saved state to avoid an error.

### `heartbeat`

Optional connection keepalive.

```text
payload: {}
```

It carries no learner, model, tool, or trace data.

## Ordering by Workflow

### Explanation/correction

```text
connected
status(validating)
status(understanding)
tool_status(get_learner_profile, ...)
tool_status(search_learning_materials, ...)  # only when needed
status(generating)
content_delta*
status(recommending)
result
completed
```

### Exercise generation

```text
connected
status(validating)
status(understanding)
tool_status(get_learner_profile, ...)
tool_status(get_due_words, ...)              # when review context is needed
tool_status(search_learning_materials, ...)
tool_status(create_exercise, ...)
status(recommending)
result(responseType=exercise)
completed
```

### Answer grading and save

```text
connected
status(validating)
tool_status(grade_answer, started)
status(grading)
tool_status(grade_answer, succeeded)
tool_status(save_attempt, started)            # valid grading only
status(saving)
tool_status(save_attempt, succeeded|failed)
status(recommending)
result(responseType=grading)
completed
```

`save_attempt` must never appear before a successful `grade_answer`.

## Reconnect Semantics

1. The Vue client stores the last fully processed `eventId`.
2. On a network failure, it reconnects with the same access token, request ID, and `Last-Event-ID`.
3. The server re-authenticates and rechecks request ownership.
4. Events after that ID are replayed, then live events continue.
5. Duplicate IDs are ignored by the client.
6. If the replay buffer expired, the server returns 410; the client reads the durable request resource.
7. Reconnect never creates or retries a Coach request and cannot call `save_attempt`.

## Retry Semantics

- A retry is an explicit authenticated API operation, not an automatic consequence of SSE disconnect.
- Retry of a completed request returns the original final result.
- Retry of a failed/cancelled request creates a new request with `retryOfRequestId`.
- Any prior valid submission/save key remains authoritative; a retry can receive `learningUpdate.status=replayed`.
- Authentication, authorization, validation, and state conflicts are not automatically retryable.

## Cancellation Semantics

- Closing the browser stream alone is not a durable cancellation request.
- The UI calls the cancel endpoint and may also abort its local stream.
- The worker observes durable/Redis cancellation and aborts LangChain runnable/model calls via `AbortSignal`.
- No new graph node starts after cancellation is observed.
- A primary-database learning transaction is atomic: it either rolls back or commits once.

## Vue State Mapping

```text
idle
  → connecting
  → queued
  → generating | tool_running | grading | saving
  → completed | cancelled | failed | timed_out | budget_exceeded
```

The UI:

- disables duplicate submission while the same idempotency key is active;
- offers Cancel only for non-terminal requests;
- offers Retry only when `retryable=true` or the network state is unknown;
- renders `result` using shared inferred types;
- shows saved/replayed/not-saved learning changes separately from grading quality;
- never renders provisional deltas as a persisted message if no valid final result exists.
