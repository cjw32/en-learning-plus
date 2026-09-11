# English Learning MCP public contracts

These are the implemented public contracts for feature `004-english-learning-mcp`. The runtime remains disabled by default; this documentation does not authorize production configuration, migration, push, or deployment.

## Files

| File | Purpose |
|---|---|
| [mcp-streamable-http.md](./mcp-streamable-http.md) | Exact two-era transport, lifecycle, cancellation and error behavior |
| [mcp-authorization.md](./mcp-authorization.md) | OAuth resource-server metadata, token, subject and scope contract |
| [mcp-capabilities.schema.json](./mcp-capabilities.schema.json) | Versioned public manifest plus Resource, Tool and Prompt input/output shapes |
| [write-confirmation.openapi.yaml](./write-confirmation.openapi.yaml) | Project-owned browser confirmation page/API contract |

## Contract source and generation

Strict Zod source schemas live in `packages/common/mcp`; `packages/common/mcp/generate-json-schema.ts` deterministically generates the committed JSON Schema. The contract test requires byte-for-byte equality. Internal Coach tool schemas are not the public contract.

Runtime registrations live in `server/apps/ai/src/mcp/resources`, `tools`, and `prompts`. Contract, security, both-era E2E, and schema-drift tests are the verification source; production issuer and client-baseline evidence remains approval-gated.

Common invariants:

- The accepted MCP protocol versions are exactly `2026-07-28` and `2025-11-25`.
- Public schema version is `en-learning.mcp.v1` unless a capability-specific version is declared.
- Inputs use `additionalProperties: false`; a caller cannot pass `userId`, subject, score, mastery, due date, database fields, arbitrary path/URL or service name.
- Identity is injected only from `McpRequestContext` after token verification.
- Capability discovery is filtered by protocol era, declared client capability, current scope and feature gates. A hidden capability is also rejected on direct call.
- All successful structured results contain `schemaVersion`, `ok`, `traceId`, and capability-specific content/version semantics. Failures use stable safe codes without stack/database/provider detail.
- Public results are validated again after domain service execution and before transport serialization.

## Capability inventory

| Type | Stable name/URI | Scope | Effect |
|---|---|---|---|
| Resource | `en-learning://words/{wordId}` | `learning:read` | read-only, rights-filtered |
| Resource | `en-learning://courses/{courseId}/materials/{materialId}` | `learning:read` | read-only, entitlement-filtered |
| Resource | `en-learning://me/reviews/today` | `learning:read` | private read-only |
| Resource | `en-learning://me/reports/summary` | `learning:read` | private read-only |
| Resource | `en-learning://me/weaknesses` | `learning:read` | private read-only |
| Tool | `search_words` | `learning:read` | read-only |
| Tool | `get_due_words` | `learning:read` | read-only |
| Tool | `search_learning_materials` | `learning:read` | read-only, AI-budgeted |
| Tool | `create_quiz` | `quiz:create` | creates an owned Exercise; no mastery/review change |
| Tool | `submit_answer` | `answer:submit` | consequential write; URL confirmation required |
| Tool | `get_learning_report` | `learning:read` | read-only |
| Prompt | `english_interview` | `learning:read` | returns workflow messages only |
| Prompt | `business_english` | `learning:read` | returns workflow messages only |
| Prompt | `vocabulary_review` | `learning:read` | returns workflow messages only |

`submit_answer` is absent unless the client explicitly supports URL elicitation and the submit/write gates are open. No Prompt invokes a Tool or provides confirmation.

## Public error taxonomy

The protocol layer uses current MCP/HTTP errors where required. Capability structured failures use this stable application taxonomy:

| Code | Meaning | Retryable by default |
|---|---|---:|
| `UNAUTHENTICATED` | missing/invalid/expired/revoked token or subject mapping | no; reauthorize |
| `INSUFFICIENT_SCOPE` | valid token lacks complete required scope | no; obtain consent |
| `CAPABILITY_UNAVAILABLE` | era/client capability/feature gate does not expose the item | no |
| `VALIDATION_FAILED` | strict input/URI/cursor/result validation failed | no |
| `RESOURCE_NOT_FOUND` | missing or unauthorized resource; same outward behavior | no |
| `CURSOR_INVALID` | cursor expired, tampered or mismatched | no; restart list |
| `DATA_NOT_AVAILABLE` | required real data is absent; nothing fabricated | conditional |
| `SOURCE_RIGHTS_DENIED` | approved projection cannot expose requested content | no |
| `IDEMPOTENCY_CONFLICT` | same key with different request fingerprint | no |
| `IN_PROGRESS` | matching operation is active/reconciling | yes after bounded delay |
| `CONFIRMATION_REQUIRED` | URL-mode confirmation must be completed | user action |
| `CONFIRMATION_PENDING` | URL opened but project confirmation not complete | user action |
| `CONFIRMATION_INVALID` | expired/rejected/consumed/mismatched confirmation | new confirmation |
| `RATE_LIMITED` | admission bucket/lease denied | yes after supplied delay |
| `BUDGET_EXCEEDED` | unapproved or exhausted AI budget | no for this request |
| `CANCELLED` | cancellation observed before commit | client decision |
| `TIMEOUT` | hard deadline reached | conditional for reads/idempotent replay |
| `DEPENDENCY_UNAVAILABLE` | OAuth/RAG/model/data dependency unavailable | conditional |
| `INTERNAL_ERROR` | redacted unexpected failure | conditional |

Authentication failures must use the authorization challenge described in `mcp-authorization.md`; a structured failure body never substitutes for a required 401/403 challenge.
