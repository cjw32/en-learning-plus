# Implementation Plan: English Learning MCP Server

**Branch**: `004-english-learning-mcp`（Spec Kit 逻辑分支；本轮未创建或切换 Git 分支） | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-english-learning-mcp/spec.md`

**Status**: Complete — Ready for Tasks only after explicit user acceptance of this Plan

**Scope of this artifact**: 本计划只定义技术方案、契约、数据模型、验证路径和发布门槛；不安装依赖、不修改生产配置、不创建数据库迁移、不编码、不推送或部署。

## Summary

在现有 `server/apps/ai` NestJS 应用内增加 English Learning MCP Server，通过一个 Streamable HTTP URL 支持 `2026-07-28` 现代时代和 `2025-11-25` initialized/sessionful 时代。协议边界采用官方 TypeScript MCP SDK v2；现代请求无会话、POST-only，旧时代保留受限短期 session 以支持 lifecycle 和 URL elicitation。MCP 原始响应绕过现有统一 HTTP envelope，但所有 Learning、RAG、模型、Prisma 与 Redis 能力仍由现有依赖注入图提供。

授权接入经批准的外部 OAuth 2.1/OIDC 授权服务器，本服务只做 resource server。每请求验证面向 MCP 资源的 token，并以不可变 `(issuer, sub)` 映射现有用户；能力发现和执行均取 `协议时代 ∩ 客户端能力 ∩ scope ∩ feature gate`。`submit_answer` 使用自有 HTTPS 页面和五分钟单次确认意图，确认、幂等、作答、掌握度和复习更新由数据库权威状态保证。

业务层优先复用 `LearningModule`、现有 RAG/引用、Exercise、OwnedGrading、Attempt/SM-2 以及 Coach 的模型/治理能力。词典、课程单项读取和学习报告在共享业务层补齐窄合同；需要现有 CoachRequest 外键的 RAG/练习/作答经一个固定方法的 `McpLearningBridge` 建立 `origin=MCP` 内部 operation envelope，不开放任意 Coach 或 Prisma 访问，也不建立平行学习事实。

## Technical Context

**Language/Version**: 服务端 TypeScript `^5.7`、NestJS `^11`、Node.js `^20.19 || >=22.12`（当前类型基线 Node 24）；Web 确认页沿用 TypeScript `~6.0`、Vue `^3.5`

**Primary Dependencies**: 优先复用现有 NestJS、Express adapter、Prisma 7/PostgreSQL、Redis/ioredis、Zod/`@en/common`、Jest 30/Supertest、LangGraph/模型网关、现有 RAG/引用和 Coach governance。协议实现计划使用官方 `@modelcontextprotocol/server`、`@modelcontextprotocol/node`，contract harness 计划使用官方 `@modelcontextprotocol/client`；三者当前均不存在，精确版本及 lockfile 变更须另获用户批准，本轮不安装

**Storage**: PostgreSQL 为主体映射、授权投影、invocation、幂等、确认、Trace 与所有学习写入的权威；Redis 仅保存限流/并发、取消和 `2025-11-25` 短期 session 协调；首版不缓存私有正文

**Testing**: 现有 Jest 30、Supertest 与确定性 fake OAuth/model/RAG；官方 MCP client harness 覆盖两个时代；现有 `server/apps/ai/test/evals` 增加版本化 MCP fixtures、分离的 deterministic/AI reports 和 release gates；真实客户端互操作在隔离候选环境执行

**Target Platform**: 现有 Linux Node AI 服务与 HTTPS 反向代理；兼容发布时稳定版 Codex、Claude Desktop、一个主流 IDE MCP 客户端和官方/兼容 Inspector，实际产品版本只固定在发布证据中

**Project Type**: pnpm monorepo Web 应用 + NestJS 主业务/AI 应用 + 共享学习领域库

**Performance Goals**: 第一候选环境形成并批准 P50/P95、成功率、取消终止率、Token 与成本基线后再声明 SLO；设计硬期限为 metadata/discovery 2 s、普通读取 3 s、RAG 5 s overall（复用现有 1.5 s retrieval budget）、报告 5 s、模型/写工具每次 30 s；确认等待不占用请求，intent 固定 5 分钟

**Constraints**: 同一 endpoint 精确支持两个协议版本并拒绝更早版本；所有私有请求逐次 bearer 校验；所有输入 strict schema 且无 `userId`；单处理器递归深度 0；response structured JSON 上限 256 KiB、单文本 Resource 上限 64 KiB；私有响应 `no-store`；取消在每个下游步骤与提交边界前重检；未知 OAuth/来源权利/预算/协议配置一律 fail closed

**Scale/Scope**: 第一阶段 5 类 Resource、6 个 Tool、3 个 Prompt、3 个 scope、2 个协议时代、4 类客户端；仅英语学习数据，不含 stdio、通用网络/文件/数据库工具、原始发音录音、删除或任意修改工具

## Constitution Check

`.specify/memory/constitution.md` 仍为未填写模板，没有可执行的项目级原则。本计划以 `develop-ai-learning-feature` 的 SDD 规则、已确认规格和用户本轮限制作为门禁。

### Phase 0 pre-research gate

| Gate | Result | Evidence / treatment |
|---|---|---|
| Repository boundary | PASS | 已确认目标为 `en-learning-plus`，产物仅位于 `specs/004-english-learning-mcp/` |
| SDD sequence | PASS | `spec.md` 已 Clarified/Ready for Plan；本阶段只产出 Plan/Research/Data Model/Contracts/Quickstart，不创建 `tasks.md` |
| Existing architecture first | PASS | 复用 AI app、LearningModule、Coach model/governance、RAG/citations、Prisma、Redis、Zod 和现有测试框架 |
| Immutable subject / isolation | PASS | 用户只由验证后的 `(issuer, sub)` 映射；URI/Tool/Prompt/cursor 无法选择主体 |
| Consequential-action confirmation | PASS | 唯一学习进度写 Tool 使用项目确认页、五分钟单次 intent 和事务内最终门禁 |
| Bounded AI behavior | PASS | strict schemas、无工具递归、期限/取消/预算、模型输出再验证与 fail-closed 均有设计 |
| User authorization limit | PASS | 不新增依赖、不改生产配置、不编码、不推送或部署；SDK/OAuth 均列为未来审批门槛 |

### Phase 1 post-design gate

Phase 1 产物维持全部门禁，且补齐了协议 arm、OAuth port、业务复用矩阵、数据实体/状态机、外部合同、验证顺序和发布门禁。没有未解决的技术澄清项。

**Post-design result**: PASS for planning；BLOCKED for implementation dependency changes and production enablement until explicit gates in “Dependencies and rollout gates” are approved.

## Architecture

```text
MCP client
  │ HTTPS + Bearer token
  ▼
raw /ai/v1/mcp middleware
  │ token verifier → subject mapping → immutable McpRequestContext
  │ exact era gate → scope/client-capability/feature-gate registry
  ├─ 2026-07-28 stateless POST handler
  └─ 2025-11-25 initialized session transport (POST/GET/DELETE)
       │
       ▼
MCP capability adapters ── strict public Zod/JSON Schema ── result projection
  │
  ├─ Resources/ordinary reads → LearningModule domain services
  ├─ RAG/create/grade/save → constrained McpLearningBridge
  │                              └─ origin=MCP internal Coach operation envelope
  └─ submit_answer → idempotency + durable URL confirmation
                         │ final assert/claim
                         ▼
                    existing authoritative LearningAttempt/SM-2 transaction

Cross-cutting: McpAdmission · cancellation/deadline · McpTrace · redaction · retention
Durability: PostgreSQL authority; Redis only session/governance/cancellation coordination
```

### Boundary decisions

- `server/apps/ai/src/mcp` owns protocol, OAuth resource-server adapter, capability registry, public schema gate, confirmation orchestration, MCP admission/cancellation, response projection and MCP Trace.
- The MCP route is mounted before `InterceptorInterceptor`, `InterceptorExceptionFilter` and ordinary Nest body handling for that path. Its response must retain official MCP status, headers and JSON-RPC/MRTR body.
- `server/libs/learning` remains the authority for ownership, learning rules, report aggregation, exercise/submission state and transactions. MCP adapters never execute Prisma queries.
- `CoachModule` exposes one allowlisted `McpLearningBridge`, not its graph/runtime or arbitrary tools. Pure Resource/Prompt calls never create CoachRequest rows.
- `packages/common/mcp` becomes the source of public strict Zod contracts and deterministic JSON Schema. Internal Coach schemas may contribute shared enums/sub-schemas but are not exported as MCP contracts.
- The existing Web auth remains valid only for the confirmation page/API. It cannot authenticate an MCP request.

## Protocol and transport design

### One URL, two arms

The canonical resource identifier and endpoint are deployment inputs, for example `https://<approved-host>/ai/v1/mcp`; this plan does not edit a host or proxy configuration.

1. Parse only the Authorization header and bounded protocol metadata before body buffering.
2. Verify OAuth token, local grant and subject mapping.
3. Classify the request with the official era helper, then apply an independent exact-version gate.
4. Build the authorized capability manifest once and use it for both discovery and dispatch.
5. Dispatch to the era-specific official transport while injecting the same immutable request context and AbortSignal.
6. Validate and project every result; complete `McpInvocation`/Trace even when the response stream has disappeared.

Modern `2026-07-28` requests validate `MCP-Protocol-Version`, mandatory `_meta`, `Mcp-Method`, applicable `Mcp-Name`, and header/body consistency. GET/DELETE are 405. Cancellation is request/response stream abort. Protocol-specific `-32020/-32021/-32022` errors are covered by contract tests.

Legacy `2025-11-25` performs an exact pre-initialize version check before allocating a session; earlier versions are rejected instead of accepting an SDK counter-offer. Session state stores only authorization ID/version, HMAC subject/client, negotiated capabilities and request controllers. Every POST/GET/DELETE revalidates bearer token; changed subject or client terminates the session. Idle expiry is 15 minutes, absolute expiry is `min(token expiry, 1 hour)`. Cancellation supports `notifications/cancelled` and disconnect.

## Authentication and capability policy

### OAuth resource server

- A public RFC 9728 Protected Resource Metadata document identifies the canonical MCP resource, approved authorization servers and supported scopes.
- `McpAccessTokenVerifier` returns only verified `issuer`, `subject`, `audience`, `clientId`, scopes, token expiry and authorization version/status. Provider-specific JWKS/introspection logic stays behind the port.
- `McpSubjectMappingService` resolves the HMAC-keyed `(issuer, sub)` mapping. It never auto-links by email and never creates a user during an MCP call.
- `McpClientAuthorization` is a local projection for consent/audit/revocation; the external AS is authoritative for token issuance and grant truth. No raw token is stored.
- Invalid/missing/revoked/wrong-audience tokens return 401 plus the required resource metadata challenge. Valid token with insufficient scope returns 403, `insufficient_scope`, required scope set and resource metadata. Responses do not reveal whether a target exists.
- OAuth `client_id`/authorized party is the security identity. Self-reported client name/version is presentation and compatibility evidence only.

### Capability visibility matrix

| Capability | Minimum scope | Client capability | Additional gate |
|---|---|---|---|
| all 5 Resources | `learning:read` | resources | source rights/entitlement/private subject as applicable |
| `search_words`, `get_due_words`, `search_learning_materials`, `get_learning_report` | `learning:read` | tools | RAG gate/budget only for material search |
| `create_quiz` | `quiz:create` | tools | AI budget + quiz feature gate |
| `submit_answer` | `answer:submit` | tools + URL elicitation | submit/write gate + ready confirmation implementation |
| all 3 Prompts | `learning:read` | prompts | only references currently visible capabilities |

The same pure policy decides list/discovery and invocation. Direct calls to a hidden capability fail before intent creation, model/RAG execution or business access.

## Resource design

All Resources use JSON content, a contract version, resource/content version, `updatedAt`, `truncated`, and optional opaque `nextCursor`. Identity remains `me`; callers cannot substitute a user.

| URI | Service path | Projection/cache rule |
|---|---|---|
| `en-learning://words/{wordId}` | new `WordDictionaryService.get` over WordBook + SourceRightsService | only field-level allowlist; public eligible version may use ETag |
| `en-learning://courses/{courseId}/materials/{materialId}` | new `LearningResourceReadService` over active Knowledge document/release + entitlement/source rights | entitlement on every read; private/no-store |
| `en-learning://me/reviews/today` | `ReviewScheduleService` | timezone from profile or validated override; private/no-store |
| `en-learning://me/reports/summary` | new `LearningReportService` | aggregate on demand; no new facts table; private/no-store |
| `en-learning://me/weaknesses` | `LearningReportService.getWeaknessSummary` using LearnerProfile | explicit data completeness/evidence status; private/no-store |

List ordering is stable and uses ID tie-breakers. The HMAC cursor binds resource/tool, version, filters hash, sort key, subject hash when private and short expiry. Invalid/expired cursors return a stable error; no offset or identity appears in the cursor. First release does not cache private/mixed content in Redis.

## Tool design and service reuse

| Tool | MCP orchestration | Limits/effect |
|---|---|---|
| `search_words` | `WordDictionaryService.search` → rights-filtered public projection | query 1–200, limit default 10/max 50, cursor; read-only |
| `get_due_words` | `ReviewScheduleService` → MCP pagination projection | one date, limit max 100; read-only |
| `search_learning_materials` | `McpLearningBridge.searchMaterials` → current RAG/citations with deadline/signal | query max 1000, topK max 20; read-only but AI budgeted |
| `create_quiz` | Bridge fixed chain: profile/review/targeting → RAG → current exercise generator/service | 1–20 items, max 50 targets; creates owned Exercise only, no progress change |
| `submit_answer` | confirmation/idempotency orchestrator → Bridge grading preparation → final Learning transaction | max 50 answers; only progress-changing Tool |
| `get_learning_report` | `LearningReportService` | max 90-day range, max 50 detail items; read-only |

Each contract declares `schemaVersion`, effect, scope, confirmation, idempotency, result-size and retry metadata. Inputs are strict, reject unknown fields and never accept client scores, mastery, due dates, database fields or user identity. Outputs pass a second schema and rights/redaction projection. Empty results are successful; unavailable RAG/model returns an explicit non-fabricated state.

`create_quiz` reserves a durable idempotency intent before any model cost. The Bridge uses a derived internal key and creates a non-user-visible `origin=MCP` operation envelope. Invalid/cancelled/schema-failed output cannot create a READY exercise; the public projection never contains answer key or grading rubric.

## Submit-answer confirmation and transaction

```text
first call
  validate auth/scope/capability/input/ownership/version/idempotency
  → reserve idempotency + create PENDING confirmation (no learning write)
  → URL elicitation

browser
  opaque URL → Web login → same local user check → show summary
  → PENDING to CONFIRMED (or REJECTED)

same tool call retried
  revalidate everything → lock intent + confirmation
  → CONFIRMED to CLAIMED
  → prepare/obtain idempotent grading result
  → final ownership/version/grant/deadline/cancel check
  → one transaction: Submission + Attempt + review events + item states
                     + confirmation CONSUMED + idempotency COMPLETED
  → saved | replayed | not_saved
```

The answer is canonicalized before hashing; raw answer stays only in the authoritative submission path, not the confirmation record/URL/Trace. Browser confirmation binds the exact answer and exercise version. Modern MRTR and legacy elicitation both project the same durable state; protocol action/notification is never the authorization fact.

Model grading is prepared outside the final transaction and stored only as an operation result eligible for idempotent reuse; it cannot change learning state. The final application service extends the current Attempt transaction so `ExerciseSubmission`, `LearningAttempt`, `LearningReviewEvent`, `LearningItemState`, confirmation consumption and completed idempotency status commit together. A crash after commit reconciles from authoritative business unique keys and returns the original `saved/replayed` result without a second model charge. A failure before commit yields `not_saved`; no mastery/review partial state is exposed as success.

Confirmation states:

```text
PENDING → CONFIRMED → CLAIMED → CONSUMED
PENDING → REJECTED | EXPIRED | CANCELLED
CONFIRMED → CLAIMED | EXPIRED | CANCELLED
CLAIMED → CONSUMED | FAILED
```

`CONFIRMED → CLAIMED` is compare-and-set/row-locked. A failed claimed operation cannot silently reuse the confirmation; reconciliation determines whether it committed, otherwise the user reconfirms.

## Prompt design

`english_interview`, `business_english` and `vocabulary_review` live in a new deterministic MCP Prompt registry with explicit manifest version/hash and strict parameter schemas. Builders follow the existing Coach pattern of JSON serialization and visibly delimited untrusted user/resource blocks, but never return internal system prompts.

Prompts produce user-role workflow messages and recommend only capabilities visible in the current manifest. They cannot execute a Tool, alter subject/scope, claim personal facts absent from the profile, or imply confirmation. `vocabulary_review` explicitly separates read → create quiz → separately confirm submit.

## Persistence and lifecycle

The detailed entity definitions and constraints are in [data-model.md](./data-model.md). Planned additions are:

- `McpSubjectMapping`: approved issuer/subject to existing user, HMAC subject at rest.
- `McpClientAuthorization`: local client/grant projection and revocation/delete lifecycle.
- `McpInvocation`: one Resource/Tool/Prompt operation and protocol/downstream terminal state.
- `McpIdempotencyIntent`: durable create/write reservation, fingerprint, lease and replay link.
- `McpWriteConfirmation`: five-minute exact-operation confirmation state machine.
- `McpTrace`/`McpTraceStep`: protocol/security/application correlation with redacted fields.
- `CoachConversation.origin`: keeps MCP internal envelopes out of user Coach history.

No `McpExercise`, `McpAttempt`, cached report, or parallel mastery table is created. `Exercise`, `ExerciseSubmission`, `LearningAttempt`, review events and item state remain authoritative.

Lifecycle follows current project patterns: legacy sessions/cancel coordination at most 1 hour, reconciliation leases at most 24 hours, failed/expired confirmation bindings cleared within 24 hours, diagnostic content off by default and at most 7 days when explicitly enabled, trace/authorization minimal metadata 180 days pending governance approval, and account deletion physical cleanup within the existing 24-hour baseline. Raw tokens, answers, resource bodies and Prompt/model raw content are never Trace fields.

## Governance, cancellation, and observability

- Reuse `RedisCoachGovernanceStore` counter/lease primitives under an independent `mcp:*` namespace. Admission applies network, subject, client, subject+client and per-capability buckets/leases.
- `McpExecutionBudget` limits total steps, recursion (0), concurrency, deadlines, body/result bytes and schema depth. AI paths then delegate token/model/tool/cost controls to the existing Coach/RAG budget policy.
- Redis is never the authority for authorization, confirmation, idempotency or business completion. Redis loss fails closed for gates that cannot be proven, while database unique constraints still prevent duplicate writes.
- Both protocol arms normalize cancellation to one `McpCancellationContext`. Before every new downstream step and immediately before final transaction the system checks signal, deadline and current authorization. After commit it reports committed/replayable state rather than false cancellation.
- `McpTrace` covers every Resource/Tool/Prompt invocation. It records HMAC subject/client, authorization version, protocol era, capability/schema/scope decision, governance, confirmation, retries, cancellation, downstream allowlisted service/AI versions, latency/token/cost and terminal/write status. It may reference a downstream CoachTrace but does not duplicate sensitive detail.
- Redaction allowlists exclude token, raw `sub`/user ID, client secret, tool/prompt raw parameters, answers, retrieved excerpts, internal Prompt, provider response, stack and database errors. Sensitive scans are release-gated.

## Testing and evaluation strategy

### Deterministic suites

1. Protocol: exact two-era success; older/unknown version rejection before session/business work; modern metadata/header conflict; legacy lifecycle/session/token swap; GET/DELETE differences and standard errors.
2. OAuth: missing/malformed/query token, wrong issuer/audience/client, expired/not-yet-valid/revoked token, unmapped subject, insufficient scope and metadata/challenge correctness.
3. Discovery: cross-product of era, client capability, three scopes and feature gates; hidden capability direct calls fail before side effects.
4. Contracts: unknown fields, `userId` injection, size/depth/count/date/topK bounds, output validation, URI/cursor tampering and no existence oracle.
5. Isolation: two users/two clients across Resources, RAG, Exercise, report, cursor, cache, session, confirmation, idempotency and Trace.
6. Confirmation: wrong Web user/client/scope/exercise/version/answer, decline, close, expiry, repeat and concurrent consumption; no URL secrets.
7. Idempotency/transaction: same key/content serial/concurrent replay once; same key/different fingerprint conflict; failures around grading and every transaction step; crash-after-commit reconciliation without second cost/write.
8. Cancellation: modern stream close and legacy notification/disconnect at RAG/model/pre-commit/post-commit boundaries; zero new steps after observed cancellation.
9. Governance/faults: user/client/network limits, concurrent leases, byte/token/cost/deadline bounds, Redis/RAG/model/OAuth failure, cleanup/retention and redaction.
10. Regression: MCP globally disabled and each dependency failed causes zero changes to existing Web, Coach, RAG, pronunciation and learning-loop behaviors.

### AI evaluation

Extend existing JSONL/rubric/report machinery for `create_quiz` personalization/answer leakage, subjective grading consistency/error classification, Prompt-driven tool selection/parameters/injection resistance and existing RAG/citation quality. Fixtures use synthetic/hand-authored isolated data. Dataset, model, prompt, capability/schema, rights, budget/price and client-matrix versions are pinned.

Deterministic and AI reports remain separate. A model judge cannot determine identity, scope, schema, confirmation, idempotency or write correctness. Human review is final for disputed learning-quality labels.

### Release gates

- Protocol/security deterministic assertions and existing core regressions: 100%.
- Cross-user success, identity injection, scope-outer discovery/call, token/secret/internal Prompt leakage, unconfirmed write, duplicate write, fabricated citation/result/save state: zero.
- Trace required-field coverage: 100%; sensitive scan hits: zero.
- Each of the four client categories passes its required matrix independently; clients without URL elicitation must not see `submit_answer`.
- After cancellation is observed, newly started downstream steps: zero; post-commit calls reconcile to one terminal business result.
- SC-016 confirmation comprehension/revocation discoverability: at least 90%.
- Tool success/selection/schema rates, P50/P95, token, cost and cancellation termination are `pending_measurement` until a fixed candidate environment creates an approved baseline/tolerance. Pending or unapproved values keep release gates closed.

## Dependency and rollout gates

| Gate | Required evidence | Blocked while closed |
|---|---|---|
| MCP SDK dependency | User approves exact official server/node/client versions and manifest/lockfile changes | Any MCP runtime or harness implementation |
| OAuth provider | Security/privacy approve issuer, resource audience, token verification/revocation, scopes, registration and consent UX | All remote private capabilities |
| Subject provisioning | Audited one-to-one link/revoke/delete process, no email auto-link | Any user data access |
| Source rights | Per-source/per-field `excerptDisplay`/MCP use allowlist and invalidation tests | Affected word/course/material fields or resources |
| URL confirmation | Self-owned HTTPS page, state machine, same-user test, concurrent consume/reconciliation evidence | `submit_answer` discovery and call |
| Governance baseline | Approved rate/concurrency/deadline/result-size and AI cost budgets | MCP global/AI/write production enablement |
| Evaluation/client matrix | All zero-tolerance gates, approved AI baseline and four current-client evidence records | Production enablement/SLO claims |

Planned independent default-off gates are: global MCP transport, private Resources/Prompts/read Tools, RAG Tool, quiz creation, confirmation flow, and answer submission/learning write. Turning them off must stop new external/AI calls and restore the pre-MCP behavior without migration rollback. This section names configuration concepts only; it does not authorize or create production configuration.

## Implementation sequence for a future Tasks phase

1. Approve/pin official SDK dependencies; add contract source package and deterministic schema generation.
2. Add database entities/migration and repository contracts while all feature gates remain off.
3. Implement fake OAuth verifier, subject/grant mapping, Protected Resource Metadata and exact protocol routing.
4. Implement capability registry, Resource/Prompt adapters and pure read Tool paths.
5. Add shared WordDictionary, LearningResourceRead and LearningReport services; migrate existing app callers where appropriate.
6. Add MCP governance/cancellation/Trace and connect RAG read path through the constrained Bridge.
7. Add `origin=MCP` internal operation envelope and `create_quiz` idempotent flow.
8. Add Web confirmation page/API, durable confirmation/idempotency state, modern/legacy elicitation projection and atomic submit flow.
9. Run deterministic protocol/security/fault/regression suites with fake dependencies.
10. After separate approvals, run real OAuth/client/evaluation evidence, establish baselines, then consider staged enablement. No push/deploy is implied.

## Project Structure

### Documentation (this feature)

```text
specs/004-english-learning-mcp/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── README.md
    ├── mcp-streamable-http.md
    ├── mcp-authorization.md
    ├── mcp-capabilities.schema.json
    └── write-confirmation.openapi.yaml
```

`tasks.md` is intentionally absent; it belongs to the later `$speckit-tasks` phase after this Plan is accepted.

### Planned source code layout (not created in this phase)

```text
packages/common/mcp/
├── versions.ts
├── capability.schemas.ts
├── resource.schemas.ts
├── tool.schemas.ts
├── prompt.schemas.ts
├── error.schemas.ts
└── generate-contracts.ts

server/apps/ai/src/mcp/
├── mcp.module.ts
├── transport/
│   ├── streamable-http.middleware.ts
│   ├── modern-transport.factory.ts
│   └── legacy-session.manager.ts
├── auth/
│   ├── mcp-access-token-verifier.ts
│   ├── mcp-authorization.service.ts
│   └── mcp-request-context.ts
├── capabilities/
│   ├── capability-registry.ts
│   ├── resources/
│   ├── tools/
│   └── prompts/
├── confirmation/
│   ├── write-confirmation.service.ts
│   └── confirmation.controller.ts
├── governance/
│   ├── mcp-admission.service.ts
│   ├── mcp-cancellation.service.ts
│   └── mcp-idempotency.service.ts
├── observability/
│   ├── mcp-trace.service.ts
│   ├── mcp-redaction.ts
│   └── mcp-retention.service.ts
└── integration/mcp-learning.bridge.ts

server/libs/learning/src/
├── dictionary/word-dictionary.service.ts
├── resources/learning-resource-read.service.ts
├── reports/learning-report.service.ts
└── submissions/submit-answer-application.service.ts

apps/web/src/
└── [existing route/page conventions]/mcp-answer-confirmation

server/apps/ai/test/
├── contract/mcp/
├── integration/mcp/
├── security/mcp/
└── evals/mcp/
```

**Structure Decision**: MCP protocol/application adapter belongs in the existing AI app because all AI/RAG/Coach wiring is already there. Cross-channel learning facts and read/write contracts belong in LearningModule. Public contracts belong in the existing common package. The only Web change is the project-owned confirmation experience. No new deployable or framework is planned.

## Requirement traceability

| Design area | Requirements | Primary validation |
|---|---|---|
| dual-era transport/capability registry | FR-001–009 | protocol harness, era/client matrix, cancellation |
| Resources/cursors/cache/rights | FR-010–016 | contract + two-user entitlement/deletion tests |
| Tools/service reuse/write correctness | FR-017–026 | strict schema, bridge, idempotency/transaction fault tests |
| Prompt registry/injection isolation | FR-027–030 | prompt contract + adversarial evals |
| OAuth/subject/scope/consent/revocation | FR-031–038 | token/grant/discovery/confirmation tests |
| schema/content/result safety | FR-039–043 | boundary/fuzz/redaction suites |
| governance/cancel/Trace/retention | FR-044–051 | fault, deadline, trace and cleanup tests |
| eval/compatibility/release | FR-052–060, SC-001–016 | separate deterministic/AI reports + four-client evidence |

## Complexity Tracking

No active constitution rule is violated. The only intentional complexity is the two-arm protocol adapter required by FR-003. Both arms share authentication, capability policy, contracts and business orchestration; protocol differences do not fork learning logic.
