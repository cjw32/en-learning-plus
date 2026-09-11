# Streamable HTTP contract

## Canonical endpoint

- Resource identifier and endpoint: `https://<approved-host>/ai/v1/mcp` (approval-gated deployment input; the checked-in runtime is default-off).
- Transport: HTTPS Streamable HTTP only.
- Accepted protocol versions: exactly `2026-07-28` and `2025-11-25`.
- The MCP route is a raw handler and is not wrapped in the application's normal `{ timestamp, path, message, code, success, data }` envelope.
- Every private request, including every legacy GET/DELETE, requires a fresh Bearer validation. Tokens in query strings are rejected.

## Routing order

1. Apply network/body/header admission sufficient to reject abuse before body buffering.
2. Parse strict `Authorization: Bearer <token>` and validate it through the approved resource-server adapter.
3. Resolve immutable subject and current local authorization; build `McpRequestContext`.
4. Use the official SDK era classifier, then enforce an independent exact-version gate.
5. Build the immutable capability manifest from era, client capabilities, scopes and gates.
6. Dispatch to the selected official SDK transport.
7. Translate cancellation/deadline to one application AbortSignal, validate/project the result, and finalize Trace.

No session or business service is touched if steps 1–4 fail.

## Modern arm: `2026-07-28`

- Stateless and POST-only. GET and DELETE return 405 with an appropriate `Allow` header.
- Every request carries the required protocol metadata. The adapter validates `MCP-Protocol-Version`, `_meta`, `Mcp-Method`, applicable `Mcp-Name` and header/body equality.
- Discovery and execution use the per-request manifest; no capability registration is shared between authenticated subjects.
- URL elicitation for `submit_answer` uses the modern input-required/MRTR form. `requestState` is integrity/expiry/parameter bound but contains no secret or private answer.
- Response stream close is cancellation. Once observed, no new downstream step starts; work that crossed the final database commit returns/reconciles a committed terminal state.

## Legacy arm: `2025-11-25`

- Requires `initialize` and allocates a random `Mcp-Session-Id` only after exact version/auth checks.
- Supports the official POST/GET/DELETE session lifecycle and the legacy `notifications/cancelled` flow.
- The pre-initialize gate rejects every version other than `2025-11-25`; it must not rely solely on SDK counter-offer behavior.
- Session state contains authorization ID/version, HMAC subject/client, negotiated capabilities/scope digest and active request controllers. It contains no token, raw subject or capability data body.
- Every session request revalidates token and local grant. A subject/client mismatch, revoked authorization or expired absolute lifetime closes the session.
- Idle expiry is at most 15 minutes; absolute expiry is `min(current token expiry, 1 hour)`. The implementation validates these ceilings while production values remain governance-gated.
- URL elicitation uses the legacy elicitation ID and optional completion notification. Notification delivery is not authoritative; the durable browser-confirmation record is, and manual same-call retry remains supported.

## Capability operations

Resources, Tools and Prompts follow the official method shapes for the negotiated era. The public capability content is defined in `mcp-capabilities.schema.json`.

Direct invocation is authorized again even if the item appeared in a previous list. A previous list result does not preserve access after scope/source-rights/entitlement/gate changes.

## Cancellation and terminal-state rules

- Modern: HTTP response/request abort.
- Legacy: `notifications/cancelled`, session disconnect/delete and HTTP abort.
- Both map to the current `McpInvocation` controller and durable cancellation timestamp.
- Before RAG/model/domain/transaction steps: assert not cancelled, not timed out, grant still active.
- Before final write transaction: repeat all assertions plus confirmation and ownership/version checks.
- Before commit: return `CANCELLED`/`not_saved`, with no learning change.
- After commit: never report cancellation as if it rolled back; return or reconcile `saved`/`replayed`.

## Response and cache rules

- Capability results are strict schema-validated and size-checked before sending.
- Private/scope-dependent discovery and all `me`/mixed content use `Cache-Control: private, no-store`.
- A public rights-filtered immutable projection may use ETag based on content/rights version; revocation/deletion must change or invalidate it.
- Results do not include stack traces, SQL/database detail, tokens, keys, raw provider output, internal prompts or unnecessary original learning content.
- If the connection disappears, the server still records a redacted durable terminal state; replay/query happens through idempotency/business links, not by guessing.

## Compatibility assertions

The contract harness must cover:

- exact-version success for both arms and rejection of earlier/unknown versions before allocation/business work;
- modern header/body metadata errors, POST-only behavior and stream-close cancellation;
- legacy initialize ordering, unknown/expired/session-token-swap failure, GET/DELETE and cancellation notification;
- scope/client-capability discovery filtering and direct-call recheck;
- modern and legacy URL elicitation/retry behavior;
- no cross-arm session, manifest, cancellation or response-cache reuse.

Release evidence separately pins actual Codex, Claude Desktop, one mainline IDE client and Inspector product versions and supported behaviors. A product name never substitutes for negotiated capabilities.
