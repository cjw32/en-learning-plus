# T003 MCP SDK v2 compatibility and security decision

**Reviewed**: 2026-09-11
**Decision status**: candidate pins recorded; packages are not installed and GATE-A remains closed.
**Requirements**: FR-001–FR-009, FR-052, PLAN-DualProtocol.

## Candidate exact pins

| Package | Intended use | Candidate exact version | Evidence |
|---|---|---:|---|
| `@modelcontextprotocol/server` | server/core, capability registration, modern handler, era classification, input-required helpers | `2.0.0` | npm marks 2.0.0 as the current stable v2 line implementing the 2026-07-28 spec |
| `@modelcontextprotocol/node` | Node HTTP/Web Request conversion and legacy Node Streamable HTTP transport | `2.0.0` | official node package changelog records 2.0.0 with 2026-07-28 support and CommonJS/ESM builds |
| `@modelcontextprotocol/client` | test-only in-process protocol/compatibility harness | `2.0.0` | npm marks 2.0.0 as the current stable v2 client line |

T004 may add these exact versions only after explicit user approval. It must re-check the registry dist-tags, lockfile resolution, licenses, integrity hashes, advisories, transitive changes, Node/TypeScript compatibility, and package provenance immediately before installation. A newer version is a specification/task change, not an automatic substitution.

Primary sources:

- [MCP 2026-07-28 release and protocol summary](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [Official TypeScript SDK v2 documentation](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Official HTTP serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md)
- [Official 2026-07-28 migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
- [Official protocol-version guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md)
- [Official dual-era routing implementation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/examples/legacy-routing/server.ts)
- [Server 2.0.0 npm metadata](https://www.npmjs.com/package/@modelcontextprotocol/server?activeTab=versions)
- [Client 2.0.0 npm metadata](https://www.npmjs.com/package/@modelcontextprotocol/client)
- [Node package changelog](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/middleware/node/CHANGELOG.md)

## Protocol and API mapping

| Planned behavior | Official v2 API/contract | Implementation/test location |
|---|---|---|
| Classify old handshake traffic before strict modern dispatch | `isLegacyRequest(request, parsedBody?)` | `server/apps/ai/src/mcp/transport/mcp-protocol-negotiator.ts`; T028/T029/T036 |
| Modern 2026-07-28 per-request server | `createMcpHandler(factory, { legacy: 'reject' })` | `server/apps/ai/src/mcp/transport/mcp-modern-transport.factory.ts`; T028/T037 |
| Node request/response bridge | `toWebRequest` and `toNodeHandler` from `@modelcontextprotocol/node` | `server/apps/ai/src/mcp/transport/mcp-request-pipeline.ts`; T032/T040/T041 |
| Legacy 2025-11-25 initialized session | `NodeStreamableHTTPServerTransport` with non-empty `sessionIdGenerator`, `McpServer.connect`, and explicit POST/GET/DELETE routing | `server/apps/ai/src/mcp/transport/mcp-legacy-session.manager.ts`; T029/T038 |
| Capability registration | `McpServer.registerResource`, `registerTool`, and `registerPrompt` on a request/session-specific server | capability registries; T039/T059/T072/T088/T122 |
| Modern URL elicitation | `inputRequired` + `inputRequired.elicitUrl`, integrity-protected `requestState`, validated `inputResponses` | `server/apps/ai/src/mcp/elicitation/mcp-modern-confirmation.presenter.ts`; T093/T106 |
| Legacy URL elicitation | v2 legacy shim or session-associated elicitation over the originating request; durable project confirmation remains authoritative | `server/apps/ai/src/mcp/elicitation/mcp-legacy-confirmation.presenter.ts`; T093/T107 |
| Modern client negotiation | `Client` with `versionNegotiation: { mode: 'auto' }` and explicit assertions on `getProtocolEra()` | `server/apps/ai/test/e2e/mcp-connect-discovery.e2e-spec.ts`; T043 |
| Cancellation | modern response-stream close; legacy `notifications/cancelled`/disconnect; application `AbortSignal` remains shared | `server/apps/ai/src/mcp/governance/mcp-deadline.ts`; T013/T023/T032 |

The server must still enforce an independent allowlist containing exactly `2026-07-28` and `2025-11-25`. SDK classification or negotiation must not silently accept an earlier legacy revision.

## Repository compatibility

- Runtime observed at review: Node `v24.18.0`, satisfying the v2 SDK's Node 20+ baseline.
- Server compiler is TypeScript `^5.7.3`; `@types/node` is `^24.0.0`. The SDK publishes both ESM and CommonJS artifacts. T004 must confirm the actual Nest CommonJS build resolves the chosen exports.
- Shared contracts already use Zod `^4.3.6`, compatible with the v2 SDK's Zod v4 examples. MCP SDK runtime types remain inside the AI adapter rather than leaking into the public common contract package.
- The AI service uses `@nestjs/platform-express`; no extra Express/Hono/Fastify MCP adapter is planned. The Node middleware package is sufficient for conversion around the existing Nest/Express HTTP server.
- No `@modelcontextprotocol/*` package is present in `server/package.json`, `packages/common/package.json`, or `pnpm-lock.yaml` at this review point.

## Security review and required controls

1. **Authentication is not provided by the handler.** Official documentation states that `createMcpHandler` trusts supplied `authInfo` and does not read/verify bearer headers. The project verifier, audience/client/scope checks, subject mapping, and revocation checks must run first.
2. **Host and Origin are not automatically validated by the raw handler.** Approved host/origin allowlists and HTTPS proxy trust must run before SDK dispatch; wildcard CORS from examples is forbidden.
3. **Content type must be checked explicitly.** Custom/user-land routing must reject non-`application/json` POSTs with 415 before classification/dispatch, using the SDK helper when available.
4. **Modern state isolation requires a fresh server per request.** Heavy Nest services may be closed over, but `McpServer`, manifest, auth context, input responses, and request state cannot be shared across users.
5. **Legacy sessions are not authentication.** Each POST/GET/DELETE revalidates the bearer token and local grant, then checks immutable issuer/subject/client/authorization version.
6. **Modern client identity is presentation-only.** Current SDK guidance makes `clientInfo` a SHOULD and moves server identity to response `_meta`; absent clientInfo must not fail authentication, while a malformed present value must fail schema validation. OAuth client identity remains authoritative.
7. **`requestState` is untrusted.** It must be integrity/expiry/principal/method/parameter bound and verified before handler re-entry. It must contain no answer, token, user ID, or other secret because integrity protection is not encryption.
8. **Input-required rounds are bounded.** Project confirmation uses one durable five-minute intent and no open-ended SDK round loop; application budgets remain stricter than SDK defaults where applicable.
9. **Result schemas remain project-owned.** Official SDK wire validation does not replace strict project input/output Zod validation, rights projection, size/depth limits, or sensitive-field redaction.
10. **Supply-chain review remains pending.** npm reports MIT for the server/client packages, but license files, signatures/integrity, advisories, transitive packages, lockfile changes, and repository security alerts must be inspected under T004 before approval is consumed.

## Known compatibility constraints and unverified client deviations

- Modern `2026-07-28` has no initialize session or `Mcp-Session-Id`; GET/DELETE are 405. Legacy `2025-11-25` retains initialized, sessionful POST/GET/DELETE behavior.
- Modern requests use per-request metadata and `Mcp-Method`/applicable `Mcp-Name` headers. `clientInfo` is optional-but-validated when present; it is never an authorization signal.
- Modern server-to-client input uses multi-round-trip `input_required`; legacy clients require the SDK's live-session shim/elicitation path. A notification is only an optimization and never the confirmation fact.
- The official high-level handler can serve 2025 clients statelessly by default, but this project deliberately uses a separate sessionful legacy arm to support lifecycle and URL elicitation.
- Actual Codex, Claude Desktop, mainstream IDE, and Inspector versions/quirks are not yet verified. T144/T146 must record each product/version independently. Until then there is no compatibility pass or production claim.

## Verification decision

Every planned SDK API above has an official source and an explicit test task. No implementation relies on SDK authentication, client-reported identity, implicit downgrade, default session behavior, or example wildcard CORS. Candidate pins are documented without changing manifests or the lockfile; GATE-A remains closed.
