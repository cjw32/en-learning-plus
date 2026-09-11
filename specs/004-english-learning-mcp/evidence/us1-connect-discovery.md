# US1 secure connection and capability-discovery evidence

**Recorded**: 2026-09-11
**Scope**: T028–T043, local deterministic fakes only
**Requirements**: SC-001–SC-004, SC-012
**Release interpretation**: implementation evidence, not a production compatibility or SLO claim

## Result

Both supported protocol eras connected through the official v2 client in process and discovered the expected authorized inventory. The focused US1 run passed 9 suites / 72 tests; the official-client E2E run passed 1 suite / 6 tests. All denial fixtures finished before protected data or model work.

| Zero-tolerance counter | Observed |
|---|---:|
| Unauthorized capabilities returned by discovery | **0** |
| Unauthorized direct calls that succeeded | **0** |
| Protected data calls after a denial | **0** |
| Model calls after a denial | **0** |
| Operations newly started after the tested cancellation point | **0** |
| Secrets, raw subjects, bearer tokens, stack traces, or resource-existence details in safe errors/challenges | **0** |

These are deterministic fixture results. They do not establish real-provider, real-data, multi-client, production latency, cancellation-rate, cost, or compatibility baselines.

## Capability inventory and intersection

The versioned registry contains exactly 14 entries. Discovery and direct invocation use the same predicate:

`supported protocol era ∩ declared client capability ∩ granted scope ∩ enabled feature gate ∩ active authorization`

| Type | Name | Required scope | Effect | Confirmation | Idempotency | Gate |
|---|---|---|---|---|---|---|
| Resource template | `en-learning://words/{wordId}` | `learning:read` | read | none | safe repeat | global + read |
| Resource template | `en-learning://courses/{courseId}/materials/{materialId}` | `learning:read` | read | none | safe repeat | global + read |
| Resource | `en-learning://me/reviews/today` | `learning:read` | read | none | safe repeat | global + read |
| Resource | `en-learning://me/reports/summary` | `learning:read` | read | none | safe repeat | global + read |
| Resource | `en-learning://me/weaknesses` | `learning:read` | read | none | safe repeat | global + read |
| Tool | `search_words` | `learning:read` | read | none | safe repeat | global + read |
| Tool | `get_due_words` | `learning:read` | read | none | safe repeat | global + read |
| Tool | `search_learning_materials` | `learning:read` | read | none | safe repeat | global + read + RAG |
| Tool | `create_quiz` | `quiz:create` | create exercise | none | required | global + quiz |
| Tool | `submit_answer` | `answer:submit` | write progress | URL elicitation | required | global + confirmation + submit |
| Tool | `get_learning_report` | `learning:read` | read | none | safe repeat | global + read |
| Prompt | `english_interview` | `learning:read` | prompt only | none | not applicable | global + read |
| Prompt | `business_english` | `learning:read` | prompt only | none | not applicable | global + read |
| Prompt | `vocabulary_review` | `learning:read` | prompt only | none | not applicable | global + read |

Each descriptor also carries schema version `en-learning.mcp.v1`, a description, and a bounded deadline/result size. The checked-in public contract owns the full Tool input/output and safe-error schemas. US1 verifies discovery metadata and direct-call parity; capability-handler validation before business services is completed and evaluated by the later Tool stories, so this document does not claim final SC-004 release readiness.

### Tested matrix

The following matrix is identical for `2026-07-28` and `2025-11-25` unless the row explicitly changes a client declaration, scope, gate, or authorization state.

| Case | Visible count | Expected inventory | Direct-call result |
|---|---:|---|---|
| All scopes, capabilities, gates, and authorization active | 14 | Complete inventory above | Exactly the same 14 allowed |
| `learning:read`; read gate only; RAG/quiz/confirmation/submit off | 11 | Five resources/templates, `search_words`, `get_due_words`, `get_learning_report`, three prompts | Those 11 allowed; other three denied |
| Client has no URL-elicitation capability | 13 | Complete inventory except `submit_answer` | `submit_answer` denied |
| Client declares resources only | 5 | Five resources/templates | All tools/prompts denied |
| No scopes | 0 | Empty | All 14 denied |
| Authorization revoked | 0 | Empty | All 14 denied |
| Global gate closed | 0 | Empty | All 14 denied |

The matrix snapshot and parity loop are executable in [`mcp-capability-matrix.security.spec.ts`](../../../server/apps/ai/test/security/mcp-capability-matrix.security.spec.ts).

## Representative protocol transcripts

Values that could identify a token, subject, client, authorization, or session are redacted or represented by bounded HMAC/opaque placeholders.

### Modern stateless `2026-07-28`

```http
POST /ai/v1/mcp
Authorization: Bearer [redacted]
Content-Type: application/json
Mcp-Protocol-Version: 2026-07-28
Mcp-Method: server/discover

{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"fixture-client","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
# no Mcp-Session-Id

{"jsonrpc":"2.0","id":1,"result":{"supportedVersions":["2026-07-28"],"resultType":"complete",...}}
```

Every POST creates a fresh SDK server/handler. `GET` and `DELETE` return `405` with `Allow: POST` and allocate no session. Unknown dates return a schema-valid safe `400`; no downgrade occurs.

### Legacy initialized session `2025-11-25`

```http
POST /ai/v1/mcp
Authorization: Bearer [redacted]
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"fixture-client","version":"1.0.0"}}}
```

```http
HTTP/1.1 200 OK
Mcp-Session-Id: legacy_[opaque]

{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25",...}}
```

The client then sends `notifications/initialized` (`202`), and later POST/GET/DELETE requests carry the opaque session ID and exact protocol date. GET opens SSE; DELETE returns `200`, removes the binding, and subsequent use returns `404`. The binding contains only issuer plus HMAC subject/client and authorization ID/version, expires after 15 idle minutes or the earliest of token expiry and one hour, and fails closed when Redis state is missing or unavailable. Pre-initialize calls and earlier/unknown dates return `400` without allocating a session.

### Authentication failure

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://resource.mcp.test/.well-known/oauth-protected-resource/ai/v1/mcp"
Content-Type: application/json

{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"Authentication required"}}
```

The challenge exposes only safe resource metadata. Query/cookie tokens, ambiguous authorization headers, web JWTs, bad issuer/audience/time/client/scope, inactive grants, and uncertain revocation are rejected before admission or dispatch.

## T028–T043 traceable evidence

The first command below produced **9/9 suites and 72/72 tests passing**. The second produced **1/1 suite and 6/6 tests passing**.

```sh
pnpm --filter @en/server test -- --runInBand apps/ai/test/contract/mcp-modern-transport.contract.spec.ts apps/ai/test/contract/mcp-legacy-transport.contract.spec.ts apps/ai/test/contract/mcp-protocol-negotiator.contract.spec.ts apps/ai/test/security/mcp-oauth.security.spec.ts apps/ai/test/security/mcp-authorization.security.spec.ts apps/ai/test/security/mcp-capability-matrix.security.spec.ts apps/ai/test/security/mcp-request-pipeline.security.spec.ts apps/ai/test/integration/mcp-http-boundary.integration.spec.ts apps/ai/test/setup/mcp-module-shell.spec.ts
pnpm --dir server exec jest --runInBand --testRegex '.*\.e2e-spec\.ts$' --testPathPatterns 'mcp-connect-discovery\.e2e-spec\.ts$'
```

The HTTP integration suites require permission to open a temporary local listener. An initial restricted-sandbox run had 68 passing assertions and four `listen EPERM` failures; rerunning the identical command with local-listener permission passed all 72 assertions.

| Task | Executable evidence | Implementation/contract evidence | Result |
|---|---|---|---|
| T028 | [`mcp-modern-transport.contract.spec.ts`](../../../server/apps/ai/test/contract/mcp-modern-transport.contract.spec.ts) | [`mcp-streamable-http.md`](../contracts/mcp-streamable-http.md) | 9 modern contract cases pass |
| T029 | [`mcp-legacy-transport.contract.spec.ts`](../../../server/apps/ai/test/contract/mcp-legacy-transport.contract.spec.ts) | [`mcp-streamable-http.md`](../contracts/mcp-streamable-http.md) | 7 legacy contract cases pass |
| T030 | [`mcp-oauth.security.spec.ts`](../../../server/apps/ai/test/security/mcp-oauth.security.spec.ts) | [`mcp-authorization.md`](../contracts/mcp-authorization.md) | 13 OAuth/OIDC security cases pass |
| T031 | [`mcp-capability-matrix.security.spec.ts`](../../../server/apps/ai/test/security/mcp-capability-matrix.security.spec.ts) | [`mcp-capabilities.schema.json`](../contracts/mcp-capabilities.schema.json) | 9 matrix/parity cases pass; both unauthorized counters are zero |
| T032 | [`mcp-http-boundary.integration.spec.ts`](../../../server/apps/ai/test/integration/mcp-http-boundary.integration.spec.ts) | [`mcp-streamable-http.md`](../contracts/mcp-streamable-http.md) | 3 raw boundary/SSE/abort cases pass |
| T033 | [`mcp-oauth.security.spec.ts`](../../../server/apps/ai/test/security/mcp-oauth.security.spec.ts) | [`mcp-protected-resource.controller.ts`](../../../server/apps/ai/src/mcp/auth/mcp-protected-resource.controller.ts) | Protected metadata and safe challenge assertions pass |
| T034 | [`mcp-oauth.security.spec.ts`](../../../server/apps/ai/test/security/mcp-oauth.security.spec.ts) | [`oidc-mcp-access-token-verifier.ts`](../../../server/apps/ai/src/mcp/auth/oidc-mcp-access-token-verifier.ts) | Signature/JWKS/claim/client/scope/revocation failures close safely |
| T035 | [`mcp-authorization.security.spec.ts`](../../../server/apps/ai/test/security/mcp-authorization.security.spec.ts) | [`mcp-authorization.service.ts`](../../../server/apps/ai/src/mcp/auth/mcp-authorization.service.ts) | 4 identity mapping/revalidation cases pass |
| T036 | [`mcp-protocol-negotiator.contract.spec.ts`](../../../server/apps/ai/test/contract/mcp-protocol-negotiator.contract.spec.ts) | [`mcp-protocol-negotiator.ts`](../../../server/apps/ai/src/mcp/transport/mcp-protocol-negotiator.ts) | 13 exact-date/no-downgrade cases pass |
| T037 | [`mcp-modern-transport.contract.spec.ts`](../../../server/apps/ai/test/contract/mcp-modern-transport.contract.spec.ts) | [`mcp-modern-transport.factory.ts`](../../../server/apps/ai/src/mcp/transport/mcp-modern-transport.factory.ts) | Fresh stateless official-SDK server and abort propagation pass |
| T038 | [`mcp-legacy-transport.contract.spec.ts`](../../../server/apps/ai/test/contract/mcp-legacy-transport.contract.spec.ts) | [`mcp-legacy-session.manager.ts`](../../../server/apps/ai/src/mcp/transport/mcp-legacy-session.manager.ts) | Identity binding, lifecycle, expiry, revocation, and fail-closed store pass |
| T039 | [`mcp-capability-matrix.security.spec.ts`](../../../server/apps/ai/test/security/mcp-capability-matrix.security.spec.ts) | [`mcp-capability-registry.ts`](../../../server/apps/ai/src/mcp/capabilities/mcp-capability-registry.ts) | Exact 14-item snapshot and discovery/direct-call parity pass |
| T040 | [`mcp-request-pipeline.security.spec.ts`](../../../server/apps/ai/test/security/mcp-request-pipeline.security.spec.ts) | [`mcp-request-pipeline.ts`](../../../server/apps/ai/src/mcp/transport/mcp-request-pipeline.ts) | 11 boundary→authn→authz→admission→dispatch cases pass |
| T041 | [`mcp-http-boundary.integration.spec.ts`](../../../server/apps/ai/test/integration/mcp-http-boundary.integration.spec.ts) | [`main.ts`](../../../server/apps/ai/src/main.ts) and [`mcp-http-boundary.ts`](../../../server/apps/ai/src/mcp/transport/mcp-http-boundary.ts) | Raw JSON/SSE/status/header semantics bypass the global envelope |
| T042 | [`mcp-module-shell.spec.ts`](../../../server/apps/ai/test/setup/mcp-module-shell.spec.ts) | [`mcp.module.ts`](../../../server/apps/ai/src/mcp/mcp.module.ts) | 3 default-off/fail-fast/exact-route cases pass |
| T043 | [`mcp-connect-discovery.e2e-spec.ts`](../../../server/apps/ai/test/e2e/mcp-connect-discovery.e2e-spec.ts) | Official `Client` + `StreamableHTTPClientTransport`, in-process fetch | 6/6 both-era discovery/revocation/scope cases pass; denied data/model calls are 0/0 |

## Security conclusions

- Bearer extraction accepts one strict authorization header only; query/cookie/ambiguous channels fail before token verification.
- Signature/JWKS, issuer, resource audience, `exp`, `nbf`, authorized client, scope, active grant, mapping, authorization version, and revocation are revalidated. Ordinary web JWTs are not MCP credentials.
- Immutable identity is keyed by `(issuer, subject)` and execution receives an internal user ID plus HMAC identifiers; raw subject/token values are not session or trace fields.
- Discovery visibility and direct-call permission are computed by the same registry predicate. A hidden capability cannot be invoked by name.
- The raw HTTP boundary preserves JSON-RPC status/headers and SSE bytes, and propagates client disconnect through the request `AbortSignal`.
- The E2E denial counters prove no protected repository/model callback ran after revocation or insufficient scope in either protocol era.

## Remaining approval gates and readiness

| Gate | State on 2026-09-11 | Consequence |
|---|---|---|
| GATE-A — exact MCP packages | **Approved and consumed for T004 only** | The three exact `2.0.0` packages are available; this does not authorize any other dependency. |
| GATE-B — external authorization server | **Not approved** | Only local verifier ports/fakes are evidence. No production issuer/client registration/secrets/network integration was performed. |
| GATE-C — production configuration | **Not approved** | MCP remains disabled by default; no production value, feature-gate enablement, deployment, push, or infrastructure change was performed. |
| GATE-D — source rights and retention | **Not approved** | Production learning-source fields and retention durations are not release-ready. |
| GATE-E — client baselines and release claims | **Not approved** | No production quality, latency, token, cost, cancellation, SLO, or client-compatibility claim is made. |

US1 is independently demonstrable with local fakes and the official SDK/client. Overall release status remains **NOT_READY** until the remaining stories, real approved integrations, actual client matrix, production-safe governance evidence, and GATE-B through GATE-E approvals are complete.
