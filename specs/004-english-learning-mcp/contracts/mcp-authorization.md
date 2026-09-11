# OAuth resource-server contract

## Roles

- English Learning MCP Server: OAuth protected resource/resource server only.
- Approved external OAuth 2.1/OIDC service: authorization server and token issuer.
- Existing en-learning-plus Web auth: only re-authenticates the project-owned confirmation page; it is not an MCP access token issuer.

The MCP server does not implement authorization endpoints, mint/exchange tokens, accept tokens for other resources or proxy a client's third-party token.

## Protected Resource Metadata

The deployment exposes RFC 9728 metadata at the canonical resource's well-known location. Design example:

```json
{
  "resource": "https://<approved-host>/ai/v1/mcp",
  "authorization_servers": ["https://<approved-issuer>"],
  "scopes_supported": ["learning:read", "quiz:create", "answer:submit"],
  "bearer_methods_supported": ["header"]
}
```

The real URI/issuer are approved deployment inputs. Metadata contains no environment secret or user data.

## Token verification result

`McpAccessTokenVerifier.verify(token, expectedResource)` must either fail closed or return an immutable internal result containing:

- exact approved issuer;
- immutable subject;
- exact MCP resource audience/resource;
- actual OAuth client ID/authorized party;
- normalized scope set;
- issued/not-before/expiry facts required by the provider profile;
- active/revoked fact or verifiable authorization version;
- safe verification method/version for Trace.

The provider adapter may use local signature/JWKS verification or introspection according to the approved AS contract. Unknown keys, stale/unavailable metadata, ambiguous client, wrong/multiple unintended audience, uncertain revocation or unapproved issuer fail closed.

## Local subject and grant projection

1. Compute versioned HMAC for `(issuer, sub)`.
2. Load one active `McpSubjectMapping`; no mapping means 401/closed capability.
3. Load or validate the matching `McpClientAuthorization` with immutable user, issuer, audience and client.
4. Intersect token scopes with the active local grant; neither side can expand the other.
5. Build `McpRequestContext`; domain code receives local user ID only from this object.

Email, preferred username, display name, `clientInfo`, URI, Tool/Prompt input, cursor, model output and cache key are not identity sources. The OAuth client ID remains client identity; it must not be overwritten with the user subject.

## Scopes

| Scope | Allows | Does not by itself allow |
|---|---|---|
| `learning:read` | permitted Resources, read Tools and Prompts | quiz creation, answer submission, inaccessible course/source fields |
| `quiz:create` | create an owned Exercise through `create_quiz` | read access unless separately granted; mastery/review change |
| `answer:submit` | discover/call `submit_answer` only when URL elicitation/write gates also pass | confirmation, arbitrary grades/mastery/dates, another user's Exercise |

Each capability declares its complete required scope set. Discovery and direct invocation both check it.

## Client registration and consent

- Prefer Client ID Metadata Documents when supported.
- Otherwise use security-approved pre-registration.
- Dynamic Client Registration is a compatibility fallback only when the approved authorization server explicitly supports it and security review accepts it.
- Consent describes client identity, every requested scope, readable data, quiz creation, the exact effect of answer submission, revocation path and the fact that third-party client handling is outside en-learning-plus after disclosure.
- Data received by a client is not licensed for model training by default.

## HTTP challenge behavior

- Missing, malformed, expired, revoked, wrong-issuer/audience/client token or missing subject mapping: HTTP 401 and a Bearer challenge referencing `resource_metadata`. Do not reveal resource existence.
- Valid token but incomplete scope: HTTP 403, Bearer `error="insufficient_scope"`, complete required scope set and `resource_metadata`.
- Tokens in query strings, cookies or Tool inputs are rejected/ignored as authentication methods; only the strict Authorization header is accepted.
- Safe error text has no token fragment, raw claims, mapping ID, provider response or validation stack.

## Revocation, session and cache behavior

- Every MCP HTTP request re-verifies the token and local authorization state, including legacy session operations.
- A legacy session is bound to authorization ID/version, immutable subject and OAuth client; it closes on any identity mismatch or revocation.
- Cache/session/confirmation keys include authorization version or are actively invalidated. The first release does not cache private content.
- Revocation prevents all new work immediately. In-flight work rechecks before each new downstream step and before a write transaction.
- Account deletion first marks mapping/grants deleting/revoked, cancels active work and clears sessions/private caches, then physically removes links/data within the approved deletion window.

## Required security tests

Missing/malformed/query token; wrong issuer/audience/resource/client; expired/not-yet-valid/revoked token; signature/key rotation failure; unmapped/duplicate subject; inactive local grant; partial/extra scope; clientInfo spoof; legacy session token swap; revocation between discovery and call; revocation before final submit transaction; two users/two clients sharing cursor/confirmation/idempotency/session. All failures must occur before unauthorized business/model work.
