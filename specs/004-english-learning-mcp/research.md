# Phase 0 Research: English Learning MCP Server

**Feature**: `004-english-learning-mcp`
**Date**: 2026-09-11
**Scope**: 只记录技术决策与证据；不安装依赖、不修改生产配置、不迁移数据库、不编码、不推送或部署。

## Decision 1: official SDK and one Streamable HTTP endpoint

**Decision**: 在现有 AI NestJS 进程中增加一个项目自有的 Streamable HTTP URL，以官方 TypeScript SDK v2 的 server/core 与 Node HTTP 适配包实现协议，不手写 JSON-RPC、SSE、会话或协商。认证后由官方 `isLegacyRequest` 路由到共享能力工厂的两个协议 arm：

- `2026-07-28`：`createMcpHandler` 的 stateless、POST-only 现代路径；每请求使用协议 `_meta`，GET/DELETE 返回 405。
- `2025-11-25`：`NodeStreamableHTTPServerTransport` 的 initialized、sessionful 路径，支持 POST/GET/DELETE 和 `Mcp-Session-Id`。

两条路径复用 Nest 注入的业务 Service、数据库/Redis 连接和同一授权/能力政策，只接受上述两个精确版本。旧时代每个 session 绑定认证主体、OAuth 客户端和协商能力，但其每个 HTTP 请求仍重新验证 bearer token；session 不是认证权威。

**Rationale**:

- 当前官方 TypeScript SDK v2 面向 `2026-07-28`，并提供 2025 握手时代的 transport 与官方双时代路由示例；官方处理器能够避免自制 framing、取消、错误编码和传输安全语义。
- 当前 AI 应用已经拥有 Nest 生命周期、共享 LearningModule、Prisma、Redis、模型治理和日志边界。新增独立进程会复制配置、健康检查和连接池，收益不足。
- 现代 arm 的每请求 Server 实例隔离客户端能力与 scope；旧时代 session 只保存协议协商/返回通道状态，具有 15 分钟 idle、`min(token expiry, 1h)` absolute 上限并在 Redis/内存协调层清理；重型依赖仍保持单例。
- 原始 MCP handler 必须在 Nest 的普通响应 envelope、全局异常过滤器和 JSON body 转换之前接管对应路径，否则会破坏标准状态、headers 与 JSON-RPC body。

**Alternatives considered**:

- 手写 MCP 协议：拒绝；兼容与安全成本高，且会复制官方实现。
- 把两个时代都实现为单一长生命周期 Server：拒绝；按用户动态能力注册容易产生跨请求状态泄露。
- SDK 默认的 stateless legacy fallback：只适合简单调用，不能可靠承载旧时代 URL elicitation 的 server→client 请求和完成通知，拒绝作为本功能的完整兼容方案。
- 新建独立 MCP 应用/服务：首阶段拒绝；增加部署与运维面，且没有隔离业务数据的必要收益。
- stdio 传输：拒绝；规格明确第一阶段为远程 Streamable HTTP。

**Dependency consequence**: 仓库当前未包含 `@modelcontextprotocol/server`、`@modelcontextprotocol/node` 或 contract harness 所需的 `@modelcontextprotocol/client`。后续实现必须先获得用户对官方 SDK 精确版本和 manifest/lockfile 变化的明确授权；在此之前 MCP 功能保持不存在/关闭。Nest + SDK Node adapter 已足够，不计划增加另一个 Web framework adapter；也不得用手写协议规避该门槛。

**Primary evidence**:

- [MCP Specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Official TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [SDK HTTP serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md)
- [SDK 2026-07-28 migration support](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)
- [Official dual-era routing example](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/examples/legacy-routing/server.ts)

**Hard version gate**: `supportedProtocolVersions` 固定为两个版本仍不够；旧 SDK initialize 可能对更老请求 counter-offer 受支持版本。因此 legacy arm 在创建 session 或调用业务 Service 前另做精确 pre-initialize 检查。现代 arm 同时校验 `MCP-Protocol-Version`、必需 `_meta`、`Mcp-Method`、适用的 `Mcp-Name` 及 header/body 一致性。

## Decision 2: external OAuth authorization server; this service is resource server only

**Decision**: 定义 `McpOAuthTokenVerifier` 端口，由后续获批的 OAuth 2.1/OIDC 授权服务器适配器实现。MCP 入口只作为资源服务器：发布 Protected Resource Metadata，每请求验证 bearer token 的签名或活跃状态、`iss`、MCP 资源 `aud`、`exp`/`nbf`、客户端标识、scope 与撤销状态，然后以 `(issuer, sub)` 查询一对一的本地 `McpSubjectLink`。不接受 email、Tool 参数、URI、Prompt 或客户端元数据作为身份映射依据。

**Rationale**:

- 现有 `AuthGuard` 只验证应用 JWT 并提取 `userId`/`exp`，没有 MCP 所需的资源受众、外部客户端、scope、授权发现和撤销语义。
- 资源服务器边界保留现有用户实体作为学习数据所有者，同时不让本项目承担授权服务器、动态注册或账号登录协议的安全责任。
- `(issuer, sub)` 是 OIDC 主体的稳定键；自动按 email 链接会在邮箱变更、复用或未验证时造成账户接管。
- 令牌只存在于请求内存，不写数据库、Redis、Trace 或日志；下游业务只接收 `McpExecutionContext`。

**Alternatives considered**:

- 直接复用 Web JWT：拒绝；它没有经确认的 MCP audience/client/scope 契约。
- 自研授权服务器：拒绝；超出项目能力与规格范围。
- token exchange/透传第三方令牌：拒绝；扩大受众和机密传播面。
- 按 email 自动映射：拒绝；不是不可变身份键。

**Provider-independent contract**: 支持本地 JWKS 验签或远程 introspection 的适配实现，但具体方式由获批授权服务器决定。未知 issuer、未知 key、元数据不可用、撤销状态不确定或映射不存在时一律 fail closed。客户端注册优先 Client ID Metadata Documents，其次预注册；仅在供应方明确支持且安全批准时使用 Dynamic Client Registration。

**Primary evidence**:

- [MCP Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [SDK bearer-auth middleware](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/middleware/bearerAuth.html)

## Decision 3: per-request capability registry

**Decision**: 每次通过认证后，根据 `protocol era ∩ declared client capabilities ∩ granted scopes ∩ feature gates` 构建不可变能力清单，并只注册清单内的 Resources、Tools 和 Prompts。所有用户能力至少要求 `learning:read`；`create_quiz` 要求 `quiz:create`；`submit_answer` 同时要求 `answer:submit`、写入开关和 URL mode elicitation 能力。

**Rationale**:

- “列出后再在执行时拒绝”会向低权限客户端泄露能力并诱导错误工具选择。
- 发现与执行共用同一政策函数可避免 TOCTOU 式授权分歧；执行前仍须重新检查当前令牌、scope、所有权和 feature gate。
- 旧时代能力缺失不能通过客户端名称猜测；只信协商结果。

**Alternatives considered**:

- 注册全部能力并在调用时鉴权：拒绝；不满足 least disclosure。
- 为每个 scope 部署独立 endpoint：拒绝；造成契约漂移和配置膨胀。
- 仅依赖工具描述要求客户端自律：拒绝；不是安全边界。

## Decision 4: URL-mode elicitation for write confirmation

**Decision**: `submit_answer` 首次调用只验证输入与归属、计算规范化答案摘要和操作摘要、建立五分钟确认意图，然后返回指向项目 HTTPS 确认页的 URL-mode elicitation。URL 只包含随机 selector，不包含答案、用户标识、token 或预授权能力。确认页使用现有 Web 登录重新认证，并证明本地 Web 用户与 `McpSubjectLink` 指向同一用户。浏览器中的确认事实才授权写入；客户端对“打开 URL”的 accept 不构成业务确认。确认后，客户端以完全相同请求重试；服务端锁定并一次性消费匹配的确认意图。

确认绑定：`userId`、issuer、client ID、scope snapshot、exercise ID、exercise version、canonical answer digest、operation summary digest、idempotency key、过期时间。任一值变化、拒绝、取消、过期、已消费或账户/授权被撤销均不得写入。

**Rationale**:

- URL mode 为敏感的带外用户交互提供标准机制，但不是 OAuth 授权本身。
- 确认事实由项目域名和数据库状态证明，客户端不能通过布尔参数自我证明。
- 原调用重试与相同幂等键把用户看到的操作精确绑定到将提交的内容。

**Alternatives considered**:

- `confirmed: true` 参数或客户端签名：拒绝；服务端无法证明用户看过并同意。
- 在 OAuth consent 中一次性同意所有未来作答：拒绝；不满足紧邻具体写入的确认。
- 让确认页直接执行作答：拒绝；割裂 MCP 调用终态和客户端重试/取消语义。
- form-mode elicitation 传答案：拒绝；答案已经在工具请求中，且写入确认需要项目自有登录与明确摘要。

**Primary evidence**: [MCP Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)

**Era projection**:

- 现代 arm 使用 `InputRequiredResult`/`inputRequired.elicitUrl(...)` 与受完整性保护、绑定期限/参数的 `requestState`；state 不放秘密，因为签名不等于加密。浏览器尚未完成时的重试返回 `confirmation_pending/not_saved`，避免无限重开 URL。
- 旧时代 arm 使用 URL elicitation 的 `elicitationId`；向准确的发起 session 发送 completion notification 只是优化，通知丢失或服务重启后仍允许同一请求人工重试。
- 两条路径共享数据库确认状态机；任何协议通知或 SDK action 均不能替代它。

## Decision 5: narrow MCP-to-learning bridge over existing Coach operation envelope

**Decision**: 不复制 Exercise/Submission/Attempt/Citation 表，也不让 MCP Module 持有任意 Coach/Prisma 能力。仅对确实依赖当前 Coach request 外键的 RAG、练习和作答路径，由 `CoachModule` 导出一个固定调用图的 `McpLearningBridge`。Bridge 为这些调用创建 `origin=MCP` 的内部 Coach conversation/request envelope，随后复用现有 Tool、模型网关、`ExerciseService`、`OwnedGradingService` 和 `AttemptService`。普通 Resource、Prompt、词典/报告读取不会创建 CoachRequest，只创建 `McpInvocation`/Trace。

`CoachConversation` 增加 `origin: COACH|MCP`（默认 `COACH`）；现有会话列表显式只返回 `COACH`。MCP conversation 只承载内部关联，不创建用户消息、不出现在普通历史，并由既有 retention 扩展清理。`McpInvocation` 可选一对一关联下游 `CoachRequest`/`CoachTrace`。传给 Coach idempotency 的键从 `authorizationId + capability + McpIdempotencyIntent.id` 派生，避免客户端/渠道键域碰撞。

**Rationale**:

- 当前 `Exercise.requestId`、`Exercise.conversationId`、`ExerciseSubmission.gradeRequestId`、`LearningAttempt.saveRequestId` 和 `KnowledgeCitation.requestId` 强制关联 Coach；一次性把它们全部多态化会触及多张核心表和 repository，回归面大于一个受限桥接边界。
- `origin` 与查询过滤可避免内部 envelope 污染用户历史；`McpInvocation` 保留协议级终态，不强迫纯读取操作进入 Coach Trace。
- 建立平行 MCP Exercise/Attempt 会产生双份掌握度与复习真相；受限 Bridge 则完整复用现有不变量。

**Alternatives considered**:

- 所有 MCP 调用都创建 Coach request：拒绝；Resource/Prompt/普通读取没有该业务语义。
- 把所有核心表改为同时关联 `McpInvocation`：首阶段拒绝；改动与回归面显著更大，可在未来重构现有领域 operation 模型时重新评估。
- MCP 专用 Exercise/Attempt 表：拒绝；形成平行事实来源。
- MCP handler 直接写 Prisma：拒绝；违反规格和 LearningModule 边界。

## Decision 6: reuse matrix and missing domain contracts

**Decision**:

| MCP capability | Authoritative reusable service | Planned narrow addition |
|---|---|---|
| word Resource / `search_words` | `WordBookMaterialProvider`, Prisma WordBook data, `SourceRightsService` | LearningModule 内增加 `WordSearchService` 与逐字段公开投影；主业务 WordBookService 后续也委托它 |
| course Resource | `CourseMaterialProvider`, ownership/access rules, source rights | 增加单项读取和稳定版本投影，不在 handler 查表 |
| today's review / `get_due_words` | `ReviewScheduleService` | MCP cursor/size projection adapter |
| report / weaknesses / `get_learning_report` | `LearnerProfileService`, review/attempt repositories | LearningModule 内新增只读 `LearningReportService` |
| `search_learning_materials` | `LearningMaterialService.searchV2`, RAG, citations | MCP schema/output projection，不改变检索规则 |
| `create_quiz` | `LearnerProfileService`, `ExerciseTargetingService`, exercise model gateway, `ExerciseService` | 受限 `McpLearningBridge.createQuiz` + `origin=MCP` internal envelope |
| `submit_answer` | `OwnedGradingService`, `AttemptService`, SM-2 review updates | 确认/idempotency orchestrator + Bridge；最终业务写统一事务化 |
| Prompts | Coach prompt registry的版本/转义模式 | MCP 独立 prompt registry；不复用或泄露内部 system prompt 文本 |

**Rationale**: 复用的是领域 Service 与不变量，而不是把内部 LangGraph Tool 当外部协议契约。外部合同需要独立版本、scope、确认、错误和大小语义。

**Alternatives considered**:

- 直接导出 Coach tools：拒绝；其输入包含 Coach request/conversation 语义，且没有 MCP 确认与发现边界。
- 在 MCP handlers 组合 Prisma 查询：拒绝；复制所有权和学习规则。

## Decision 7: strict public contracts and bounded execution

**Decision**: 在 `packages/common/mcp` 定义严格、版本化的 Zod 源合同，并确定性生成/提交 JSON Schema；MCP SDK 注册仅引用这些公共 schema。输入拒绝未知字段，不包含 `userId`，对象深度最大 6，单次响应结构化 JSON 最大 256 KiB，文本资源单项最大 64 KiB。采用以下首版上限，后续只能经评测和计划变更调整：

| Operation | Input/result bound | Deadline | Retry |
|---|---|---:|---|
| discovery/metadata | capability list fixed | 2 s | client-safe |
| word/course/private Resource | page default 10, max 50 | 3 s | at most 1 transient read retry |
| `search_words` | query 1–200 chars, limit max 50 | 3 s | at most 1 transient read retry |
| `get_due_words` | date range one day, limit max 100 | 3 s | at most 1 transient read retry |
| `search_learning_materials` | query max 1000, topK max 20 | 5 s overall; reuse 1.5 s retrieval budget | existing bounded provider policy |
| `create_quiz` | 1–20 items, max 50 targets | 30 s | no automatic model retry unless existing accepted policy proves safe |
| `submit_answer` | max 50 item answers, answer item max 4,000 chars | 30 s per attempt; confirmation TTL 5 min | only idempotent client replay |
| `get_learning_report` | range max 90 days, detail limit max 50 | 5 s | at most 1 transient read retry |

单个 MCP 工具处理器不调用另一个 MCP 工具，递归深度固定为 0；请求内模型并行度 1、数据库子查询并行度由业务 orchestrator 明确限制。超时和客户端断开通过 `AbortSignal` 向 RAG、模型和可取消业务操作传播；越过数据库提交边界后返回已提交或可重放终态。

**Alternatives considered**:

- 沿用内部 schema 作为公共合同：拒绝；会冻结内部结构并泄露无关字段。
- 无上限依赖全局 body limit：拒绝；无法控制模型成本和响应放大。
- 通用 MCP 工具链允许工具互调：拒绝；本项目不需要且扩大递归风险。

## Decision 8: opaque cursors and cache policy

**Decision**: 游标由版本、resource/tool name、排序键、filters hash、subject hash（私有场景）和短过期时间组成，经服务端现有密钥能力作 HMAC 签名；客户端不能编辑。所有列表稳定按业务排序键加 ID tie-breaker。首版不缓存私有正文或混合检索结果；响应为 `Cache-Control: private, no-store`。公共且权利白名单稳定的词典/课程投影可使用 content version/updatedAt 生成 ETag，但来源撤权/删除必须使版本失效。

**Rationale**: 不持久缓存是首版最小泄露面；有状态分页表没有必要。签名游标阻止 filter/subject 篡改，稳定排序避免重复或漏项。

**Alternatives considered**:

- 明文 offset cursor：拒绝；可篡改且更新期间不稳定。
- Redis 缓存全部 MCP 结果：拒绝；增加撤权、删除和跨用户键治理。
- URI 中加入真实 user ID：拒绝；规格使用 `me` 绑定认证主体。

## Decision 9: MCP-specific admission and audit, shared primitives

**Decision**: 复用现有 Redis 治理 store、成本计量、取消和 redaction 的实现模式，但建立 MCP 专用 `McpAdmissionService`、key namespace 和策略配置。key 至少绑定 `subjectHash + clientHash + capability`，网络来源仅作为附加维度。Durable `McpInvocation` 与 `McpTrace` 记录终态；Redis 只做限流/并发/短暂取消协调，不能决定写入成功。

首个候选环境必须测量并批准实际限额；在此之前使用代码内安全上限和 default-off feature gate，不宣称生产 SLO。AI 能力继续通过现有 budget/model policy；无价格版本或预算时 fail closed。

**Alternatives considered**:

- 把 MCP 计数混入 Coach key：拒绝；无法按外部客户端隔离和分析。
- 仅按 IP 限流：拒绝；NAT 误伤且不能约束单用户/客户端。
- 仅写普通日志：拒绝；无法证明确认、幂等和写入终态，且原始日志更易泄敏感数据。

## Decision 10: retention and deletion

**Decision**: 以下是待治理批准的最小首版期限，不是对生产配置的修改：

- pending confirmation：5 分钟后失效；拒绝/过期/失败的临时绑定 24 小时内清除，Trace 只留结果枚举和摘要 hash。
- legacy session、cancel key 与短期 response coordination：idle 15 分钟、absolute `min(token expiry, 1h)`；reconciliation lease 最多 24 小时。
- 已完成幂等意图不长期复制完整响应；保留 key digest、终态和业务资源关联到对应 Exercise/Attempt 生命周期结束。
- 客户端授权本地投影：活跃到撤销；撤销后最小事实和 MCP Trace metadata 沿用当前项目 180 天审计基线，再删除或去标识。诊断正文默认关闭；明确 incident 授权时最多 7 天。
- token、答案原文、私有资源正文、内部 Prompt、原始模型响应：不进入 Trace。

账户删除流程先撤销/阻断授权，再取消 session/downstream、清理 Redis/私有缓存，并在现有 24 小时物理清理基线内删除 subject link、客户端授权投影、未消费确认、幂等用户关联及私有结果；必须保留的最小 Trace 先 unlink 为不可关联 metadata。期限均须在生产启用前接受治理批准。

**Alternatives considered**:

- 无限期保留：拒绝；不符合数据最小化。
- 请求结束立即删除全部幂等信息：拒绝；不能安全重放或解释不确定写入。
- 只依赖数据库 cascade：拒绝；不能通知外部授权服务器撤销，也不能覆盖 Redis/Trace 派生数据。

## Decision 11: deterministic tests separated from AI evaluation

**Decision**: 协议、OAuth、schema、身份、scope、确认、幂等、所有权、分页、缓存、取消和错误投影使用确定性测试；工具选择、参数生成、Prompt 行为、RAG/练习/批改质量使用版本化 MCP eval 数据集。模型评分不得替代任何安全断言。

发布报告必须分别输出协议矩阵、功能/安全零容忍项和 AI 指标。跨用户成功、身份注入、令牌泄露、未确认写入、重复写入、虚假引用/保存状态、内部 Prompt 泄露任一计数大于 0，发布结果直接失败。其余成功率、选择准确率、schema 首次/最终通过率、P50/P95、token、成本与取消终止率先形成批准基线，再比较回退阈值。

**Alternatives considered**:

- 用单一 LLM judge 分数发布：拒绝；不可证明确定性安全属性。
- 只运行 SDK conformance：拒绝；不覆盖本项目所有权、确认和学习副作用。
- 直接使用真实学习数据作评测：拒绝；专项数据必须隔离、授权和版本化。

## Resolved unknowns and remaining approval gates

本研究没有未解决的澄清占位项。以下均已形成设计边界，但属于未来实施或生产启用的显式门槛：

1. 用户批准官方 MCP SDK 精确版本和依赖/lockfile 变更后才能实现协议入口。
2. 安全/隐私批准具体外部 OAuth 供应方、issuer/audience、撤销方式、客户端注册策略和生产配置后，远程私有能力才能启用。
3. URL-mode 确认页、五分钟确认状态机和并发/重放测试通过前，`submit_answer` 保持关闭。
4. 来源逐字段权利白名单通过审查前，相应词典/课程字段或整个资源保持不可用。
5. 预算、限流、延迟、真实客户端兼容和 AI 指标获得批准基线前，MCP 全局/分能力开关保持关闭且不得宣称生产 SLO。
