# Feature Specification: English Learning MCP Server

**Feature Branch**: `N/A（未配置 before_specify 分支钩子）`

**Created**: 2026-09-11

**Status**: Clarified — ready for Plan

**Input**: User description: "为 en-learning-plus 创建符合当前官方 MCP 标准的 English Learning MCP Server，使经过明确授权的兼容客户端能够发现并使用英语学习 Resources、Tools 和 Prompts，同时复用现有业务 Service，严格隔离用户数据并治理写操作。"

## Clarifications

### Session 2026-09-11

- Q: 第一阶段支持哪些协议时代与客户端范围？ → A: 同一 Streamable HTTP 入口同时支持 `2026-07-28` 现代时代与 `2025-11-25` 握手时代；更早版本明确拒绝。发布时验证当时稳定版 Codex、Claude Desktop、一个主流 IDE MCP 客户端和 Inspector，并在证据中固定实际版本。
- Q: 远程 MCP 授权由谁负责？ → A: 接入经批准的标准 OAuth 2.1/OIDC 授权服务器；English Learning MCP Server 仅作为资源服务器，直接验证面向自身受众的访问令牌，并将不可变 `sub` 一对一映射到现有用户，不自研授权服务器、不透传或交换第三方令牌。
- Q: `submit_answer` 如何取得服务端可验证的用户确认？ → A: 使用 URL mode elicitation 打开 en-learning-plus 自有 HTTPS 确认页，创建五分钟、单次使用且绑定用户、客户端、scope、练习版本、答案摘要和操作摘要的确认意图；页面重新验证同一用户后确认，原调用重试时消费该意图。未声明 URL elicitation 的客户端不得发现或调用 `submit_answer`。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 安全连接并发现学习能力 (Priority: P1)

已注册学习者从兼容 MCP 客户端连接 English Learning MCP Server，完成协议协商和授权后，只看到当前协议版本、客户端能力与授权范围允许的 Resources、Tools 和 Prompts。开发者可获得稳定、可理解的名称、描述、参数与结果语义。

**Why this priority**: 可靠发现、标准互操作和授权是所有学习场景的入口；若该边界不成立，后续任何能力都不能安全开放。

**Independent Test**: 使用批准的客户端矩阵分别执行连接、版本协商、授权和能力发现；验证兼容客户端获得正确能力，不兼容版本和未授权请求得到标准、安全的拒绝。

**Acceptance Scenarios**:

1. **Given** 客户端支持批准的协议版本且用户完成授权，**When** 客户端建立连接并发现能力，**Then** 服务返回该版本支持且在授权范围内的 Resources、Tools 和 Prompts 及完整契约。
2. **Given** 客户端使用不支持的协议版本或请求未声明能力，**When** 它发起请求，**Then** 服务返回可区分、可理解的协议错误，不执行业务调用。
3. **Given** 访问令牌缺失、过期、撤销、受众不匹配或权限不足，**When** 客户端请求私有能力，**Then** 请求被拒绝且不泄露目标资源是否存在。
4. **Given** 用户已撤销某客户端授权，**When** 该客户端发起新请求，**Then** 它不能再读取新数据或执行工具。

---

### User Story 2 - 读取本人学习资源 (Priority: P1)

学习者可以在客户端中浏览或读取词典、课程学习材料、今日复习内容、学习报告、薄弱词和主要错误类型。公共内容与用户私有内容有明确边界，私有 URI 始终绑定服务端认证主体。

**Why this priority**: 标准化、安全地复用学习数据是外部 AI 客户端最直接的用户价值，也是多工具分析的基础。

**Independent Test**: 使用两个隔离测试用户读取同一组公共资源和各自私有资源，验证公共内容一致、私有内容只属于当前主体、分页与空结果稳定，且构造他人标识无法越权。

**Acceptance Scenarios**:

1. **Given** 已授权读取公共学习内容，**When** 用户列出或读取词典与允许的课程材料，**Then** 返回最小化、分页且带版本信息的内容。
2. **Given** 用户有到期词、学习报告或薄弱项，**When** 客户端读取对应 `me` 资源，**Then** 仅返回当前认证用户的数据。
3. **Given** 用户没有到期内容或报告数据不足，**When** 客户端读取资源，**Then** 返回合法空结果或“数据不足”状态，不伪造学习历史。
4. **Given** 客户端修改 URI、模板参数或分页游标以猜测其他用户，**When** 服务解析请求，**Then** 主体仍由授权上下文决定，且拒绝结果不暴露他人资源存在性。

---

### User Story 3 - 使用只读工具完成学习分析 (Priority: P1)

用户或 Agent 可调用 `search_words`、`get_due_words`、`search_learning_materials` 和 `get_learning_report` 查询词汇、待复习内容、带真实引用的学习材料和本人表现。多个只读调用不会改变学习状态。

**Why this priority**: 只读工具以较低风险开放现有 Coach 和 RAG 能力，并支持 Agent 组合完成个性化分析。

**Independent Test**: 让多个兼容客户端完成相同的词汇查询、今日复习和学习分析，验证工具选择、参数、引用、数据隔离、结果 Schema 与调用前后学习状态。

**Acceptance Scenarios**:

1. **Given** 合法受控查询参数，**When** 调用 `search_words`，**Then** 返回匹配词、释义、词性、音标、可用词形与合法例句；无授权来源字段不被冒充为事实。
2. **Given** 当前用户有到期复习词，**When** 调用 `get_due_words`，**Then** 只返回本人当前到期内容，输入中不存在可选择的 `userId`。
3. **Given** 用户查询学习材料，**When** 调用 `search_learning_materials`，**Then** 返回经过访问过滤的真实检索结果与可核验引用；无可靠结果时明确降级。
4. **Given** Agent 连续调用多个只读工具，**When** 分析完成，**Then** 不新增作答、不更新掌握度或复习计划，也不形成无限递归调用。

---

### User Story 4 - 创建个性化练习 (Priority: P1)

学习者可基于本人等级、薄弱项、指定词汇或知识类型创建结构化练习。练习生成不改变掌握度，结果不泄露答案键或内部评分依据。

**Why this priority**: 练习生成把外部客户端中的分析转化为可完成的学习活动，同时保持写入边界清晰。

**Independent Test**: 使用不同等级和薄弱项的测试用户请求相同题型，验证练习合法且体现画像差异、材料可访问、答案不泄露、生成动作不改变学习进度。

**Acceptance Scenarios**:

1. **Given** 用户允许创建练习且画像和材料可用，**When** 调用 `create_quiz`，**Then** 返回绑定当前用户、可提交且结构合法的练习。
2. **Given** 画像部分缺失，**When** 用户创建练习，**Then** 服务使用明确标注的受限默认或返回数据不足，不虚构弱项。
3. **Given** 指定词汇、课程或材料不属于当前用户可访问范围，**When** 创建练习，**Then** 请求被安全拒绝且不创建练习。
4. **Given** 练习已生成，**When** 比较生成前后学习状态，**Then** 掌握度、复习计划和完成统计均未改变。

---

### User Story 5 - 确认后提交并保存答案 (Priority: P1)

学习者在客户端查看将发生的数据变化并明确确认后，调用 `submit_answer` 提交本人练习答案。服务重新校验确认、身份、归属、状态、参数和幂等性，完成结构化批改，并按既有业务规则原子保存作答、掌握度与复习计划变化。

**Why this priority**: 这是第一阶段唯一会改变核心学习状态的能力，也是越权、误写和重试重复写入风险最高的边界。

**Independent Test**: 对本人练习执行确认、未确认、重复、并发、过期、越权和部分失败提交；验证只有有效且服务端可证明已确认的操作保存一次，所有学习变化全成或全败。

**Acceptance Scenarios**:

1. **Given** 用户已在 en-learning-plus 自有确认页查看操作摘要、以同一身份确认且确认意图仍有效，**When** 原 `submit_answer` 调用被重试，**Then** 返回结构化批改以及创建或更新的业务资源摘要。
2. **Given** 客户端仅声称“用户已确认”但服务端没有可验证证据，**When** 调用 `submit_answer`，**Then** 服务拒绝写入。
3. **Given** 同一幂等键和同一答案被重试，**When** 请求再次到达，**Then** 返回首次结果且不重复创建作答或更新学习状态。
4. **Given** 同一幂等键对应不同答案，**When** 请求到达，**Then** 服务返回冲突且不修改既有结果。
5. **Given** 批改成功但保存事务失败，**When** 返回结果，**Then** 用户可看到批改但明确获知学习状态未更新，且不存在部分学习写入。

---

### User Story 6 - 使用标准英语学习 Prompts (Priority: P2)

用户可发现并获取 `english_interview`、`business_english` 和 `vocabulary_review` Prompt。模板使用受控参数，建议客户端先调用合适的只读工具；模板本身不会提升权限或暗中执行写操作。

**Why this priority**: 标准 Prompt 为不同客户端提供一致、易用的学习入口，但依赖前述身份和工具边界。

**Independent Test**: 使用默认参数、边界参数和恶意文本获取三个 Prompt，验证输出适合目标场景、不泄露内部指令、无法扩大 scope，且写操作要求额外确认。

**Acceptance Scenarios**:

1. **Given** 用户提供合法职位、等级、难度与轮次，**When** 获取 `english_interview`，**Then** 返回面试流程、反馈偏好和建议的只读数据获取步骤。
2. **Given** 用户选择会议、邮件、汇报或谈判场景，**When** 获取 `business_english`，**Then** 返回与水平、目标表达和难度一致的练习模板。
3. **Given** 用户选择复习范围、题型、难度和数量，**When** 获取 `vocabulary_review`，**Then** 返回先读取复习数据、再组织练习的模板，并明确提交答案需要另行确认。
4. **Given** 参数含 Prompt Injection，**When** 获取 Prompt，**Then** 恶意文本只处于不可信用户内容区域，不能改变授权主体、工具范围或服务规则。

---

### User Story 7 - 审计与评估 MCP 行为 (Priority: P2)

授权的开发和运维人员可通过 Trace 关联一次 MCP 请求的客户端、脱敏主体、协议元数据、权限、Schema 校验、业务 Service、模型与 Prompt 版本、耗时、费用、确认、重试、取消和写入结果。团队可运行独立的协议测试与 AI 行为评测。

**Why this priority**: 没有专项评测和端到端审计，无法证明协议兼容、数据隔离、写入安全或升级后的质量。

**Independent Test**: 运行版本化 MCP 评测集并抽查成功、失败、取消、越权和写入 Trace，验证指标可复现、敏感字段被排除、阻断项能阻止发布。

**Acceptance Scenarios**:

1. **Given** 一次 Resource、Tool 或 Prompt 请求结束，**When** 授权人员按 Trace ID 查询，**Then** 能关联协议入口、业务操作与终态，且看不到令牌、密钥、原始敏感内容或内部 Prompt。
2. **Given** 协议、Tool Schema、Prompt 或模型版本变化，**When** 候选版本进入发布评审，**Then** 确定性协议测试与 AI 行为评测分别运行并与批准基线比较。
3. **Given** 出现跨用户泄露、身份伪造、未确认写入或重复写入，**When** 发布门禁计算结果，**Then** 该版本不能发布。

### Edge Cases

- 客户端支持 `2025-11-25` 连接级 `initialize` 时代而不支持 `2026-07-28` 逐请求发现与协商，或反之；服务必须在同一入口选择匹配时代，其他版本明确拒绝。
- 客户端声明的协议版本、请求体元数据和 HTTP 元数据不一致。
- 客户端未声明某能力，却调用对应 Resource、Tool、Prompt、订阅或分页行为。
- HTTP 请求缺少令牌、令牌过期/撤销、签发者或受众不匹配、scope 不足，或用户在会话中撤销授权。
- 客户端尝试通过 Tool 参数、Resource URI、Prompt 参数、分页游标或缓存键注入任意 `userId`。
- 公共词典字段、课程正文、例句或词形变化没有可验证来源与展示权利。
- 今日没有到期词、用户无学习历史、画像不完整、报告暂无足够数据或私有内容已删除。
- Resource 在列出后被更新、撤权、删除或变得不可访问；旧版本与缓存不得继续泄露正文。
- Resource 内容过大、分页游标篡改、重复翻页、深层对象、超长字符串、超大数组或请求洪泛。
- RAG 返回空召回、低相关性、冲突、失效引用、超时或 Provider 不可用。
- 文档、用户输入或工具结果包含要求泄露系统 Prompt、提高权限、调用写工具或访问其他用户的指令。
- `create_quiz` 在依赖材料消失、模型输出 Schema 无效、预算不足或客户端取消时失败。
- `submit_answer` 对已过期、已提交、他人所有、答案数量不匹配或内容已变化的练习执行。
- 用户确认发生在操作摘要之后，但练习版本或答案内容在执行前发生变化。
- 客户端没有声明 URL mode elicitation、用户拒绝或关闭确认页、确认意图超过五分钟、已消费，或确认页登录主体与 MCP 主体不一致。
- 写事务提交与客户端取消/断开并发；最终状态必须可查询为“未保存”或“已保存一次”。
- 重试发生在客户端不知道首次写请求是否成功时；同一意图不得产生第二次写入。
- 客户端断开后，下游不支持取消或已越过不可逆提交边界。
- 模型或检索 Provider 失败、超时、限流、返回无效结构或产生未知费用。
- 同一客户端或用户递归、并发或快速调用多个工具，试图耗尽连接、Token、模型或数据预算。
- 错误路径包含内部堆栈、数据库详情、JWT、API Key、原始用户学习内容或未脱敏 Trace。

## Requirements *(mandatory)*

### Existing Capability Baseline

以下基线来自 2026-09-11 对目标仓库和当日官方 MCP 文档的只读审查，是本规格的事实边界：

| Area | Existing capability | Confirmed gap relevant to this feature |
|------|---------------------|----------------------------------------|
| Application boundary | 项目为工作区结构，包含 Web、主业务应用和独立 AI 应用；共享学习模块向应用层提供学习能力。 | 当前没有项目自有 MCP 协议入口、能力注册表或外部客户端互操作测试。 |
| Authentication | 受保护接口使用严格 Bearer access token 校验，并从验证结果创建不可由请求体修改的主体上下文。 | 现有 JWT 校验未体现 MCP 远程授权所需的受保护资源元数据、授权服务器发现、客户端注册、资源受众绑定、细粒度 scope、客户端授权记录和撤销链路。 |
| Learning services | 已有学习画像、今日复习、学习材料、练习生成、批改、作答原子保存、掌握度与复习调度等共享 Service。 | 词典搜索仍主要位于主业务模块；没有独立的 MCP 适配合同。专用学习报告 Service 未发现，需要组合现有只读能力或在业务层补齐合同。 |
| Coach tools | 已有 `get_learner_profile`、`get_due_words`、`search_learning_materials`、`create_exercise`、`grade_answer`、`save_attempt` 等受控工具与版本化结构合同。 | Coach 工具是内部工作流能力，不能直接等同于公开 MCP 契约；命名、权限、确认和错误语义需要 MCP 边界映射。 |
| RAG and citations | 已有向量检索、访问范围过滤、来源权利、引用签发/投影、取消与受控失败。 | MCP Resource/Tool 的分页、缓存、内容版本和引用投影尚未定义。 |
| Pronunciation | 已有发音评测、取消、隐私、费用、Trace 与学习状态更新能力。 | 第一阶段明确不通过 MCP 上传或处理原始录音，也不暴露该能力。 |
| Governance | Coach 与发音能力已有用户/IP 治理、并发、超时、取消、幂等、预算、版本和隐私安全 Trace 机制。 | 尚无客户端级 MCP 限流、MCP 请求/会话关联、写操作确认凭据或 MCP 专项评测。 |
| Protocol baseline | 2026-07-28 官方规范采用逐请求元数据、能力协商和 Streamable HTTP，取消通过关闭请求响应流表达；官方 SDK 同时支持 2025 握手时代。 | 第一阶段已确定在同一入口支持 `2026-07-28` 与 `2025-11-25`，更早版本不在兼容范围；实际客户端版本在发布证据中固定。 |

本表未列出的能力不得在 Plan 或 Implement 阶段视为已实现。

### Functional Requirements

#### Protocol and Capability Boundary

- **FR-001**: 系统 MUST 提供项目自有的 English Learning MCP Server，使批准的兼容客户端可通过第一阶段的 Streamable HTTP 远程连接访问。
- **FR-002**: 服务 MUST 遵循实现时最新且已批准的官方 MCP 规范，并对每个请求验证协议版本、协商元数据与客户端能力；版本或元数据不支持时在调用业务 Service 前返回标准错误。
- **FR-003**: 同一 Streamable HTTP 入口 MUST 同时支持 `2026-07-28` 现代时代的逐请求发现/协商和 `2025-11-25` 握手时代的 `initialize` 生命周期，并明确拒绝更早协议版本。发布兼容矩阵 MUST 覆盖发布时稳定版 Codex、Claude Desktop、一个主流 IDE MCP 客户端和官方或兼容 Inspector，且在验证证据中固定产品名称、实际版本、协议时代和能力限制；不在规格中永久冻结快速变化的客户端版本号。
- **FR-004**: 服务 MUST 支持 Resources、Tools 和 Prompts 三类服务端能力的发现与使用，只向客户端公布其协议版本、已声明能力和授权 scope 共同允许的项目。
- **FR-005**: 每个公开能力 MUST 有稳定名称、面向客户端和用户可理解的描述、受控输入、结构化输出或内容语义、权限、只读/写入属性、错误和版本信息。
- **FR-006**: 协议处理层 MUST 只负责协议解析、协商、认证上下文接入、Schema 门禁、能力路由、取消传播和结果投影；应用业务 Service MUST 负责学习规则、归属、状态转换和事务；数据访问层 MUST 只在业务 Service 授权的用户范围内持久化或查询。
- **FR-007**: MCP Handler 和任何 Tool MUST NOT 执行任意 SQL、接受数据库表达式、直接控制字段、复制学习规则或绕过现有业务 Service。
- **FR-008**: 客户端取消或断开 MUST 阻止新的下游步骤并尽可能终止可取消的检索、模型与业务操作；越过原子提交边界的写操作必须返回可查询的确定终态。
- **FR-009**: 服务 MUST 限制单个 MCP 请求可触发的 Tool 数、递归深度、并行度和总执行时间；服务不得把通用文件系统、命令、网络访问或任意内部 Service 暴露为能力。

#### Resources

- **FR-010**: 第一阶段 MUST 使用不包含真实用户标识的稳定 URI 命名空间，并至少提供以下资源或模板：

| Resource or template | Visibility | Canonical URI pattern | MIME type | Content semantics |
|----------------------|------------|-----------------------|-----------|-------------------|
| Word dictionary entry | Public/rights-filtered | `en-learning://words/{wordId}` | `application/json` | 词、释义、词性、音标、合法词形、例句、来源版本与可用性。 |
| Course material | Entitlement-filtered | `en-learning://courses/{courseId}/materials/{materialId}` | `application/json` | 当前用户有权访问的课程材料摘要、定位与来源版本。 |
| Today's review | Private | `en-learning://me/reviews/today` | `application/json` | 当前用户学习时区下的到期复习摘要。 |
| Learning report | Private | `en-learning://me/reports/summary` | `application/json` | 当前用户近期进度、复习完成情况与表现摘要。 |
| Weakness summary | Private | `en-learning://me/weaknesses` | `application/json` | 当前用户薄弱词和主要错误类型摘要及证据状态。 |

- **FR-011**: 单词与课程 MAY 使用受控 Resource Template；模板参数只能是已验证的业务资源标识和受限筛选值，不得接受用户标识、SQL、文件路径、网络地址或内部 Service 名称。
- **FR-012**: 私有 `me` Resource MUST 在服务端绑定当前认证主体；URI、模板参数、Prompt 和客户端元数据中的身份值不得改变主体。
- **FR-013**: Resource 列表和读取 MUST 支持稳定排序、受限页大小、不透明游标、合法空结果以及游标过期/篡改错误；默认只返回摘要，大型内容必须分页或截断并清楚标明。
- **FR-014**: 每个 Resource 结果 MUST 包含内容版本或更新时间及缓存语义；权限撤销、来源失效、内容删除或用户删除后，新请求和私有缓存不得继续返回旧正文。
- **FR-015**: 公共词典、课程、用户私有数据和混合检索结果 MUST 在列出、读取、缓存、分页、引用和 Trace 中保持访问范围隔离。
- **FR-016**: Resource MUST NOT 暴露原始 JWT、密钥、内部数据库结构、系统 Prompt、未脱敏 Trace、服务端日志、原始发音录音、答案键或内部评分依据。

#### Tools

- **FR-017**: 第一阶段 MUST 提供以下 Tool 契约；所有主体均从服务端授权上下文注入，Tool 输入不得含 `userId`：

| Tool | Access and effect | Controlled input | Structured output | Required scope | Confirmation | Idempotency | Failure/degradation |
|------|-------------------|------------------|-------------------|----------------|--------------|-------------|---------------------|
| `search_words` | Read-only | 关键词；可选等级、课程、结果上限与分页游标。 | 词典条目摘要、匹配信息、来源/版本、下一页游标。 | `learning:read` | No | Safe to repeat | 空结果成功；无权字段排除；数据源失败返回稳定错误。 |
| `get_due_words` | Read-only | 学习日期/时区；可选本人课程范围、结果上限与游标。 | 到期词、原因、复习状态、到期时间和分页信息。 | `learning:read` | No | Safe to repeat | 无到期词为空成功；调度不可用时不把所有已学词冒充到期词。 |
| `search_learning_materials` | Read-only; may consume AI budget | 查询、受控类别/等级/课程/单词过滤、Top K。 | 真实检索结果、相关性状态、冲突、引用与失败状态。 | `learning:read` | No | Safe to repeat | 空/低召回明确不足；引用或 Provider 无效时不生成虚假依据。 |
| `create_quiz` | Creates a user-owned exercise but does not change mastery/review | 题型、数量、难度、指定词/知识类型、情境和客户端幂等键。 | 练习标识、题目、提示、个性化依据、引用、可提交状态；无答案键。 | `quiz:create` | Authorization to create is sufficient; no progress-write confirmation | Required | 无材料、无预算、取消或无效输出时不产生可提交练习。 |
| `submit_answer` | Writes attempt, mastery and review changes | 本人练习标识、答案映射和幂等键；确认事实来自服务端确认意图与协议重试上下文，不接受客户端自造确认布尔值或凭据。 | 批改、作答标识、`saved|replayed|not_saved`、具体学习变化和 Trace ID。 | `answer:submit` | Required immediately before matching write | Required | 校验失败零写入；同键同内容重放；状态未知可按幂等意图查询。 |
| `get_learning_report` | Read-only | 受控日期范围、摘要维度、结果上限；默认近期摘要。 | 进度、薄弱项、复习完成、近期表现、数据完整性和版本。 | `learning:read` | No | Safe to repeat | 数据不足合法返回；不得推测缺失表现。 |

- **FR-018**: 每个 Tool MUST 有版本化输入和输出 Schema，并声明只读/写入、幂等性、确认要求、scope、结果大小、超时、限流、费用预算、可重试性、降级方式和业务操作标识。
- **FR-019**: 所有 Tool 参数 MUST 限制字符串长度、数组数量、对象深度、分页大小、Top K、题量、日期范围和未知字段，并在进入业务 Service 或调用模型前拒绝无效值。
- **FR-020**: 所有 Tool 结果 MUST 再次通过结构、权限、内容大小和敏感字段投影；内部异常、原始模型输出和不受控 Service 结果不得直接透传。
- **FR-021**: `search_words` MUST 复用或补齐词典业务 Service；`get_due_words` MUST 复用复习调度 Service；`search_learning_materials` MUST 复用现有 RAG 与引用能力；`create_quiz` MUST 复用画像、目标选择和练习 Service；`submit_answer` MUST 复用归属批改、Attempt 原子保存与复习更新；`get_learning_report` MUST 复用现有画像/学习状态并在业务层补齐缺失的报告合同。
- **FR-022**: `create_quiz` 只允许创建当前用户拥有的练习实例，不得更新掌握度、复习时间或完成统计；它的 Tool 描述必须明确这一效果。
- **FR-023**: `submit_answer` MUST 在业务边界重新验证主体、练习归属、答案与练习版本、状态、幂等键、确认凭据、批改结果及允许的状态转换，不得接受客户端提供的任意分数、掌握度或复习时间。
- **FR-024**: `submit_answer` MUST 使用 URL mode elicitation 指向 en-learning-plus 自有 HTTPS 确认页。服务端 MUST 在首次调用时创建不产生学习写入的确认意图，将其绑定认证主体、客户端、`answer:submit` scope、练习标识与版本、答案摘要、操作摘要及五分钟有效期；URL 不得包含敏感数据或预认证能力。确认页 MUST 重新验证当前 Web 用户与 MCP 主体一致并展示数据变化；用户确认后，原调用仅可在重试时一次性消费完全匹配的确认意图。用户拒绝、取消、超时、重复消费或任一绑定值变化均不得写入。未声明 URL mode elicitation 的客户端不得发现或调用 `submit_answer`。
- **FR-025**: `submit_answer` 的作答、掌握度、复习计划和业务审计 MUST 全部成功或全部失败；同一幂等键同内容返回首次结果，同键不同内容拒绝冲突，失败重试不得重复收费或写入。
- **FR-026**: 第一阶段 MUST NOT 提供删除账户、批量删除、任意数据修改、原始发音录音处理、数据库、文件系统、命令执行或通用联网 Tool。

#### Prompts

- **FR-027**: 第一阶段 MUST 提供 `english_interview`、`business_english` 和 `vocabulary_review` 三个可发现 Prompt：

| Prompt | Parameters and defaults | Required behavior |
|--------|-------------------------|-------------------|
| `english_interview` | 职位方向；可选用户等级；难度默认与画像匹配；轮数/时长采用受限默认；逐题反馈默认开启。 | 引导面试、按选择提供反馈，并只建议在 scope 内调用必要只读工具。 |
| `business_english` | 场景为会议/邮件/汇报/谈判；可选等级、目标表达；难度默认与画像匹配。 | 建立明确商务情境与练习目标，不声称不存在的用户经历。 |
| `vocabulary_review` | 范围默认今日到期词；可选题型、难度；题量采用受限默认。 | 先读取允许的复习信息，再建议创建练习；提交答案必须另行确认。 |

- **FR-028**: Prompt 参数 MUST 通过受限 Schema 校验；默认值、允许枚举、最大长度和数量 MUST 在发现结果中清晰可见。
- **FR-029**: Prompt MUST 把用户输入和 Resource 内容作为不可信数据隔离，不得直接拼接到系统或高权限指令区域，也不得暴露系统 Prompt、密钥、内部实现或隐藏评分规则。
- **FR-030**: Prompt MUST NOT 扩大客户端 scope、改变认证主体、授予未发现工具或代表用户暗中确认写操作；任何写操作均需独立工具调用与对应确认。

#### Authentication, Authorization, and Consent

- **FR-031**: 未认证客户端 MAY 仅访问协议和授权发现所必需的公开元数据；不得读取用户私有 Resource、调用用户 Tool 或获得含私有上下文的 Prompt。
- **FR-032**: 远程 MCP 授权边界 MUST 符合实现时批准的官方 Authorization 规范，包括受保护资源发现、授权服务器发现、客户端注册、访问令牌受众绑定、每请求 Bearer 校验、过期/撤销处理和不足 scope 错误。
- **FR-033**: 第一阶段 MUST 接入经安全批准、符合所需 OAuth 2.1/OIDC 能力的授权服务器。English Learning MCP Server MUST 仅作为资源服务器，直接验证由该授权服务器签发、受众限定为本 MCP 资源的访问令牌，并把不可变 `sub` 一对一映射到现有用户；不得自研授权服务器，不得把现有普通 Web JWT 假定为 MCP 令牌，也不得透传或交换其他资源的令牌。客户端注册 MUST 优先使用受支持的 Client ID Metadata Documents，其次为已批准的预注册；Dynamic Client Registration 仅在授权服务器明确支持且安全评审通过时作为兼容回退。
- **FR-034**: 每个令牌 MUST 映射到唯一用户、唯一目标 MCP 资源受众、明确客户端和明确 scope；至少区分 `learning:read`、`quiz:create` 和 `answer:submit`。
- **FR-035**: 客户端只能发现和调用授权范围内的能力；不足 scope、令牌无效或资源无权访问时 MUST 使用标准状态和安全错误，且不泄露资源是否存在。
- **FR-036**: 用户身份 MUST 只来自验证后的服务端授权上下文；Tool 输入、URI、Prompt、模型输出、缓存、Trace 或客户端声明中的 `userId` 必须忽略或拒绝。
- **FR-037**: 用户授权界面 MUST 说明客户端身份、请求 scope、可读取数据、可能创建的练习、答案提交会产生的变化、撤销方式和第三方客户端对已接收数据的处理边界；外部客户端获得的数据不得默认用于模型训练。
- **FR-038**: 撤销授权后新请求 MUST 立即失效；不同用户、客户端和会话不得共享私有缓存、确认凭据或下游执行上下文。

#### Input, Output, and Content Safety

- **FR-039**: 所有 Tool、Resource、Prompt 参数和结构化结果 MUST 由版本化 Zod 或 JSON Schema 合同校验；未知或不支持的合同版本必须拒绝或安全降级。
- **FR-040**: RAG 文档、Resource 内容、用户输入、客户端描述和 Tool 结果均 MUST 视为不可信内容，不能覆盖系统规则、主体、scope、工具权限、确认门禁或输出合同。
- **FR-041**: 服务 MUST 拒绝可解释为 SQL、文件路径、网络地址、内部 Service 名称或任意执行指令的非预期参数，不允许模型控制数据库字段或业务状态。
- **FR-042**: 错误和结果 MUST NOT 包含内部堆栈、数据库详情、JWT、API Key、系统 Prompt、原始 Provider 响应、未脱敏 Trace 或无必要的用户学习原文。
- **FR-043**: 服务 MUST 对结果数量、单项长度、对象深度、总字节数、模型 Token 和重复调用设置边界；超限请求必须在资源大量消耗前被拒绝或截断并明确标注。

#### Governance, Reliability, and Audit

- **FR-044**: MCP 连接和能力调用 MUST 执行用户级、客户端级和适用的网络来源级限流与并发控制，并复用现有 AI 预算门禁。
- **FR-045**: 每项能力 MUST 有独立的最大执行时间和总请求期限；检索、模型和可取消业务操作必须接收取消信号，自动重试次数有界。
- **FR-046**: 只读操作 MAY 在确认未产生副作用时受限重试；写操作仅可依赖幂等保护安全重放，失败重试不得造成重复业务写入或重复费用。
- **FR-047**: Provider 或模型不可用时 MUST 返回结构化错误或受控降级，不能伪造检索、引用、批改、学习报告或已保存状态。
- **FR-048**: 每次 MCP 操作 MUST 记录 Trace ID、请求标识、客户端标识、脱敏用户标识、协议版本/时代、能力类型与名称、scope、Schema 校验、耗时、业务 Service 结果、模型/Prompt/Schema 版本、Token/费用、确认/取消/重试/超时/限流、写入资源标识和最终状态。
- **FR-049**: Trace MUST 将 MCP 协议入口、能力 Handler、业务 Service、检索/模型调用和业务结果串联；日志不得保存完整令牌、密钥、原始敏感数据或无必要的学习内容。
- **FR-050**: MCP 客户端标识与授权记录必须有明确保存期限；写操作审计可按安全合规需要保留最小事实；账户删除必须触发授权撤销并进入可验证的删除或去标识流程。
- **FR-051**: 服务会话和下游资源 MUST 在断开、取消、超时或期限到达后及时清理；第一阶段不得形成无限期会话状态。

#### Evaluation and Release Gates

- **FR-052**: 项目 MUST 在现有 Coach 和 RAG 评测体系中增加版本化 MCP 专项评测集，覆盖发现、工具选择、参数生成、Schema、Resource URI、Prompt 参数、主体绑定、跨用户攻击、无效/过期令牌、scope、只读/写入边界、确认、幂等、引用、注入、恶意资源、超限、限流、超时、取消、断开、协议不兼容、依赖异常和客户端互操作。
- **FR-053**: 每个评测样本 MUST 记录输入、模拟主体/令牌/客户端、可访问数据、期望能力、期望参数、期望结果或错误、预期副作用、版本与阻断级别；私有数据测试必须使用隔离测试数据。
- **FR-054**: 确定性协议与安全测试 MUST 与模型参与的意图到工具选择、参数生成和 Prompt 行为评测分开报告，模型评分不得替代身份、Schema、幂等或权限断言。
- **FR-055**: 评测 MUST 报告工具选择准确率、参数 Schema 通过率、无效参数拦截率、Resource 读取正确率、用户隔离通过率、未确认写入拦截率、重复写入率、注入防护率、Tool 成功率、P50/P95 延迟、单次 AI Tool Token/成本、取消终止率、协议兼容率和既有业务回归率。
- **FR-056**: 协议、客户端、Tool/Resource/Prompt Schema、Prompt、模型、权限或业务 Service 版本变化后 MUST 重跑适用回归并与批准基线比较。
- **FR-057**: 尚无可靠数值基线的质量、延迟、成本和终止率指标 MUST 先在固定版本和环境测量并经批准后设定目标及回退范围，不得在 Specify 阶段编造生产表现。
- **FR-058**: 跨用户泄露、身份伪造、未确认写入、重复写入、令牌泄露、未授权能力发现或调用 MUST 是零容忍发布阻断项。
- **FR-059**: 批准客户端矩阵 MUST 使用官方或兼容 Inspector 完成协议级验证；矩阵中每个客户端必须分别记录版本、授权方式、协议时代、Resources/Tools/Prompts 支持和限制。
- **FR-060**: 现有 Web、Coach、RAG、发音评测、课程、单词、复习和练习核心流程 MUST 保持可用；MCP 关闭或不可用不得触发隐式外部调用或改变既有学习状态。

### Key Entities *(include if feature involves data)*

- **MCP Client Authorization**: 用户授予一个客户端访问 MCP Server 的授权关系；包含客户端标识、主体、scope、状态、授予/撤销时间和最小审计信息，不包含明文令牌。
- **MCP Request Context**: 一次请求的可信执行上下文；包含协议时代/版本、客户端、脱敏主体、scope、请求标识、期限、取消状态和 Trace 关联，不能由 Tool 参数覆盖。
- **MCP Capability Definition**: 可发现 Resource、Tool 或 Prompt 的版本化公共契约；包含名称、描述、输入/输出或内容语义、权限、效果、限制和兼容信息。
- **Learning Resource Descriptor**: 可列出/读取的学习内容描述；包含稳定 URI、可见范围、MIME 类型、版本、更新时间、大小与分页信息。
- **Tool Invocation**: 一次受控工具调用事实；包含 Tool 版本、验证结果、业务操作标识、效果分类、耗时、预算、重试、终态和安全投影结果。
- **Write Confirmation**: 与用户、客户端、操作摘要、目标资源、答案/练习版本和短有效期绑定的服务端可验证确认事实；只能消费于匹配写操作。
- **Idempotency Intent**: 将一次逻辑写入与客户端重试关联的用户范围标识和内容指纹；保证同内容重放、不同内容冲突。
- **Learning Attempt**: 现有学习闭环中的权威作答事实；用户描述中的 ExerciseAttempt 对应此业务概念，不新建平行事实来源。
- **MCP Trace**: 串联协议入口、身份、能力、业务 Service、模型/Prompt、检索、确认、费用与最终结果的隐私安全审计记录。
- **MCP Evaluation Case**: 版本化测试样本；包含隔离数据、模拟客户端/令牌、期望能力与副作用、指标和阻断级别。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 批准客户端矩阵中的 100% 客户端能够完成其声明协议时代的连接/发现，并准确发现授权范围内的 Resources、Tools 和三个 Prompts；越权能力出现在发现结果中的数量为 0。
- **SC-002**: 100% 未认证、过期、撤销、受众不匹配和 scope 不足测试在业务数据读取或模型调用前被拒绝，且资源存在性和敏感字段泄露数量为 0。
- **SC-003**: 跨用户攻击集中，通过参数、URI、Prompt、令牌、游标、缓存或确认凭据读取/修改其他用户数据的成功次数为 0。
- **SC-004**: 所有六个 Tool 的发现结果均包含完整且与运行时一致的输入/输出语义、效果、权限、确认、幂等、限制和错误信息；无效参数进入业务 Service 的比例为 0。
- **SC-005**: `search_words`、`get_due_words`、`search_learning_materials` 和 `get_learning_report` 的验收样本读取正确率为 100%，且调用前后核心学习状态变化数量为 0。
- **SC-006**: 100% RAG 成功结果的引用来自当前请求真实、有效且有权访问的检索结果；伪造、失效或越权引用到达客户端的数量为 0。
- **SC-007**: `create_quiz` 的有效样本 100% 返回可提交、结构合法、不含答案键且绑定当前用户的练习；由该调用直接产生的掌握度或复习变化数量为 0。
- **SC-008**: 未确认、确认过期、摘要不匹配、主体/客户端不匹配的 `submit_answer` 写入成功次数为 0；有效确认提交的业务变化 100% 全成或全败。
- **SC-009**: 同一逻辑提交因重试、重连或并发产生的重复作答、重复掌握度更新、重复复习事件和重复费用数量均为 0。
- **SC-010**: 三个 Prompt 的合法参数和边界参数样本 100% 生成结构有效结果；Prompt 或恶意 Resource 扩大 scope、改变身份、泄露内部指令或暗中执行写入的次数为 0。
- **SC-011**: 100% MCP 操作可通过一个 Trace 关联协议、客户端、脱敏主体、scope、Schema、业务调用、版本、延迟、费用、确认/取消/重试和终态；禁止敏感内容扫描命中数量为 0。
- **SC-012**: 客户端取消或断开测试中，越过取消点后新启动的下游操作数量为 0；可取消操作终止率形成版本化基线，无法取消或已提交操作均返回确定状态。
- **SC-013**: MCP 专项评测对 FR-052 所有类别均至少有一个正向和一个适用的失败/攻击样本，并输出 FR-055 全部指标的版本化报告；任何零容忍阻断项失败时发布通过率为 0。
- **SC-014**: Tool 成功率、工具选择准确率、参数通过率、P50/P95 延迟、Token、成本、取消终止率和客户端兼容率在首个候选环境形成经批准基线；后续版本 100% 与批准回退范围比较，未批准前不宣称达标。
- **SC-015**: MCP 启用、禁用或依赖失败时，现有 Web、Coach、RAG、发音评测和学习闭环核心回归场景通过率为 100%，未经 MCP 请求触发的业务行为变化数量为 0。
- **SC-016**: 在用户可用性验证中，至少 90% 参与者能够在执行 `submit_answer` 前正确理解会保存作答并更新掌握度/复习计划，且能找到撤销客户端授权的入口。

## Dependencies and Release Gates

| ID | Dependency or release gate | Resolved boundary | Impact |
|----|-----------------------|------------------|--------|
| DEP-001 | 远程 MCP 授权服务器与用户同意边界。 | 接入经批准的标准 OAuth 2.1/OIDC 授权服务器；MCP 端仅作为资源服务器并将受众限定令牌的 `sub` 一对一映射到现有用户。不得自研授权服务器或直接复用普通 Web JWT。 | 不阻塞 Plan；具体供应方与生产配置获批前使用隔离测试适配器并保持远程私有能力关闭。 |
| DEP-002 | 写操作服务端可验证确认机制。 | 已决定采用自有确认页、URL mode elicitation 和五分钟单次确认意图；当前尚未实现。 | 实现并通过身份绑定、重放和过期安全测试前，`submit_answer` 必须保持关闭。 |
| DEP-003 | 协议时代和客户端兼容矩阵。 | 已选定 `2026-07-28` 与 `2025-11-25`；客户端产品版本快速变化。 | Plan 必须设计双时代路径；发布证据固定当时实际客户端版本，不承诺未经验证版本。 |
| DEP-004 | 词典与课程内容的来源权利。 | 第一阶段采用逐字段、逐来源白名单；只有现有 RAG 来源权利记录明确允许展示的内容可被 MCP 暴露，其余字段返回不可用且不以模型内容替代。 | 不阻塞 Plan；真实语料范围可缩小，但未经授权内容进入有效结果仍是发布阻断项。 |
| DEP-005 | 学习报告业务合同。 | 在共享 LearningModule 增加面向应用层的只读学习报告合同，组合现有画像、复习和作答能力；MCP Handler 只调用该合同，不直接聚合数据库。 | 不新建平行学习事实来源；合同与现有 Service 的具体组合在 Plan 中设计。 |
| DEP-006 | 生产预算、延迟和专项基线。 | 先以固定隔离数据和模拟依赖建立确定性基线，再在明确批准的限额内测量真实客户端与 Provider；所有 MCP/AI 能力采用默认关闭的发布门禁。 | 不阻塞 Plan 或本地实现；没有批准基线、预算和生产配置时不得生产启用或宣称 SLO。 |

## Out of Scope

- 匿名访问用户学习数据。
- MCP Registry、应用市场或目录发布。
- ChatGPT Apps SDK 自定义 UI 或其他 MCP Apps 交互界面。
- MCP 客户端自身的开发、通用客户端适配器或 IDE 插件开发。
- 多 Agent 编排、跨 Agent 状态或自主长期任务。
- 任意 SQL、数据库表、文件系统、命令执行、任意网络请求或内部 Service 调用能力。
- 删除账户、批量删除学习记录或任意修改业务数据的高风险 Tool。
- 直接暴露系统 Prompt、完整 Trace、服务端日志、答案键或数据库结构。
- 通过 MCP 上传、保存或处理原始发音录音。
- 重写或复制 Coach、RAG、发音评测、练习、批改、复习或报告业务逻辑。
- 无限制长期会话状态、跨用户共享缓存或与英语学习无关的通用 Agent 工具。
- 本 Specify 阶段的技术方案、代码、任务拆分、依赖安装、数据库迁移、服务启动、部署、提交或推送。

## Assumptions

- 目标仓库继续以现有经过验证的主体上下文作为所有业务 Service 的用户身份来源；MCP 资源服务器将批准授权服务器的不可变 `sub` 映射为该主体，现有普通 Web JWT 不直接作为 MCP 访问令牌。
- 第一阶段只提供 Streamable HTTP；本地 stdio 传输不在范围内，Claude Desktop 等客户端若访问本功能需具备远程 HTTP MCP 支持。
- 第一阶段公开能力以当前已实现且可安全复用的学习 Service 为依据；缺失业务合同必须在业务层补齐，不能在 MCP Handler 中复制逻辑。
- `LearningAttempt` 是权威学习作答实体；用户描述中的 ExerciseAttempt 视为同一业务概念，不要求创建同名平行实体。
- `create_quiz` 创建用户拥有的练习实例但不改变学习进度；`submit_answer` 是第一阶段唯一改变掌握度和复习计划的 MCP Tool。
- 未声明 URL mode elicitation 的兼容客户端仍可使用其 scope 允许的 Resources、Prompts、只读 Tools 和 `create_quiz`，但不得发现或调用 `submit_answer`。
- 公共词典与课程材料仍受 RAG 规格中的来源权利和课程访问边界约束；未获确认的字段或内容保持不可用。
- Prompt 默认值必须有界并优先使用当前画像；画像缺失时显式降级，不假定不存在的 CEFR、弱项或历史表现。
- MCP 相关客户端标识、授权记录、确认和 Trace 只保存完成安全、撤销、审计和删除所需的最小数据；除已确定的五分钟确认意图外，其余具体期限由 Plan 明确并接受治理批准。
- 当前官方协议事实以 2026-09-11 可访问的 2026-07-28 MCP Specification 和官方 TypeScript SDK 主分支文档为准；实施时若规范更新，必须先回到 Specify 更新兼容要求。
