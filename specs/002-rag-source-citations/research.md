# Phase 0 Research: 英语学习知识库 RAG 与来源引用

**Feature**: `002-rag-source-citations`  
**Date**: 2026-09-08  
**Purpose**: 在不新增依赖、不假定生产授权的前提下，解决存储、检索、权限、Embedding、生命周期、合同、引用和评测方面的技术不确定性。

## R-001 — 在现有 PostgreSQL 中使用 pgvector

**Decision**: 使用主 PostgreSQL 的 pgvector 扩展保存与查询向量，不建立独立向量数据库。未来迁移以 `CREATE EXTENSION IF NOT EXISTS vector` 启用扩展；扩展可用性、版本、权限、备份与恢复在非生产环境验证后才允许开启 RAG。

**Rationale**:

- 规格明确要求 PostgreSQL + pgvector，项目已使用 PostgreSQL/Prisma。
- pgvector 官方实现提供 exact/approximate nearest-neighbor、cosine distance、事务、JOIN 和 PostgreSQL 运维能力，允许权限过滤与向量计算保持在一次查询中。[pgvector official repository](https://github.com/pgvector/pgvector)
- PostgreSQL 扩展必须先安装在数据库服务器，再由具备权限的数据库用户执行 `CREATE EXTENSION`；不能把应用迁移可执行性当作基础设施已就绪。[PostgreSQL CREATE EXTENSION](https://www.postgresql.org/docs/17/sql-createextension.html)

**Alternatives considered**:

- 新建 Pinecone、Milvus、Elasticsearch 等服务：拒绝；增加依赖、同步与授权边界，并超出规格。
- 把向量存 AI checkpoint 数据库：拒绝；checkpoint 不是业务知识权威存储，也不具备现有学习数据删除关系。

## R-002 — Prisma 管关系，原始 SQL 管 vector

**Decision**: Prisma Schema 将向量表示为 `Unsupported("vector")`；普通实体和事务继续用 Prisma，向量插入/查询集中封装为参数化 `$executeRaw`/`$queryRaw`。不新增 pgvector Node 客户端。

**Rationale**:

- Prisma 官方文档对 pgvector 的当前路径是自定义迁移、`Unsupported` 类型与 raw SQL；这与现有 Prisma 7.6 和 `@prisma/adapter-pg` 可兼容。[Prisma PostgreSQL extensions](https://docs.prisma.io/docs/postgres/database/postgres-extensions)
- Prisma 官方要求查询自定义类型时转换为受支持类型；检索投影不返回原始 vector，避免反序列化问题。[Prisma raw queries](https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries)
- 将 raw SQL 限制在单一仓储，可集中审计参数化、权限谓词、维度校验和返回映射。

**Alternatives considered**:

- 等待 Prisma 原生 vector 支持：拒绝；无法满足当前规格，时间不确定。
- 从转移依赖中直接导入 pgvector 序列化器：拒绝；pnpm 下不稳定，也形成未声明依赖。

## R-003 — 首版以 exact cosine search 建立基线

**Decision**: v1 检索使用 pgvector 默认精确近邻和 cosine distance。先按状态、版本、来源权利、业务过滤和访问范围缩小候选，再计算距离、应用阈值和 Top K。ANN、关键词融合和 Reranker 均不在首版启用。

**Rationale**:

- pgvector 默认 exact search，具有完美召回，适合作为 Recall@K 和后续 ANN 对照基线。[pgvector exact and approximate search](https://github.com/pgvector/pgvector)
- 当前没有 corpus 规模、延迟或质量证据；提前选择 HNSW 参数会违反规格的 baseline-first 要求。
- 访问条件复杂且包含按用户课程/私有范围。官方说明 ANN 在过滤后可能少返回结果；exact 可先保证安全和可复现。

**Score normalization**: `cosineSimilarity = 1 - cosineDistance`；合同值为 `clamp((cosineSimilarity + 1) / 2, 0, 1)`，等价于 `clamp(1 - distance / 2, 0, 1)`。阈值只在相同 Embedding 和 retrieval config 内比较。

**Future gate**: 只有 exact P95/规模基线不满足批准目标时，才评估 HNSW；必须报告 exact-vs-ANN recall、过滤后结果完整性、索引大小/构建时间及 pgvector 版本。

## R-004 — 使用无 typmod vector 避免猜测未批准维度

**Decision**: `KnowledgeEmbedding.embedding` 使用 `vector`，并另存 `dimensions`、provider、model、`embeddingVersion`。写入和查询必须验证实际向量长度与当前批准配置一致；SQL 只比较相同维度和版本。

**Rationale**:

- Embedding Provider 尚未获批，不能在计划中虚构模型和固定维度。
- 首版 exact search 不需要绑定特定维度的 ANN operator class；未来确定 HNSW 时再为批准维度建立表达式或固定维度索引。
- `embeddingVersion` 包含 provider/model/dimensions/normalization/input-policy 的兼容性标识，避免不兼容向量混用。

**Alternatives considered**:

- 预设 1536：拒绝；没有 Provider 决策依据。
- 用 JSON/数组代替 pgvector：拒绝；不满足明确存储要求且失去向量操作符。

## R-005 — 不假定现有 DeepSeek 提供 Embedding

**Decision**: 定义 `EmbeddingGateway` 端口和使用 Node 原生 `fetch` 的 `ConfiguredHttpEmbeddingGateway`。具体 Provider、endpoint、model、dimensions、价格、留存和数据处理条款需明确批准；批准前 ingestion/read 均关闭。确定性测试使用进程内 fake，不访问外部网络。

**Rationale**:

- 当前项目只有 DeepSeek Chat 集成。DeepSeek 官方当前文档列出 Chat/Responses/Completions 模型，并没有足以据此采用的 Embeddings endpoint，因此不能复用 chat 配置作假设。[DeepSeek API documentation](https://api-docs.deepseek.com/)
- 原生 `fetch` 已由 Node 运行时提供，兼容简单 HTTP embedding 合同且无需 SDK。
- 接口隔离可以在后续批准 Provider 时更换适配器，不影响领域和检索合同。

**Payload policy**: 只发送规范化 Chunk/query 正文和批准模型名；不发送 JWT、API key 以外的凭据、原始 userId、课程授权、联系方式、来源权利详情、完整会话或 Trace。

## R-006 — 来源和字段授权采用数据库白名单

**Decision**: 使用 `KnowledgeSource` 管来源级权利，使用 `KnowledgeSourceFieldPolicy` 明确业务实体字段是否允许 Embedding、摘录展示和评测。摄取必须同时满足 ACTIVE source、当前 rights version、用途许可、有效期和字段白名单。

**Rationale**:

- 当前 `WordBook` 字段名无法证明来源或权利。
- 字段级策略允许 definition 可用而 Oxford/Collins 不可用等实际情况，避免“整表一开全开”。
- 数据库版本快照可随 release/eval 报告审计，而静态代码 allowlist 无法表达授权到期。

**Conservative resolution of open rights question**: 未提供授权证据的字段默认全部不发布。该决策解决技术行为，不宣称业务权利已经获得。

## R-007 — 课程使用共享 Chunk + 查询时 entitlement

**Decision**: 课程内容每个版本只保存一份共享 Chunk，标记 `visibility=public`、`accessScope=OWNED_COURSE`、`userId=null`、`courseId=<id>`。每次向量查询、引用解析和打开操作均要求当前主体存在 `CourseRecord(userId, courseId, isPurchased=true)`。

**Rationale**:

- 复用现有 `CourseMaterialProvider.searchOwnedCourses` 的实际权限语义。
- 按用户复制课程向量会造成重复、撤权困难和用户间版本漂移。
- 规格要求的 `visibility` 无法单独表示“共享存储但需 entitlement”，所以 `accessScope` 是额外且权威的授权维度。

**Conservative resolution of open course question**: 在业务明确公共子集前，所有课程知识都按 `OWNED_COURSE`。以后新增公共子集需要独立来源/内容策略，不能原地放宽现有 Chunk。

## R-008 — 私有知识只从已保存事实派生

**Decision**:

- 用户错题仅来自 `LearningAttempt → ExerciseSubmission(GRADED_VALID/SAVED) → ExerciseSubmissionItem`，以题目、本人答案、验证纠正、错误类型和必要解释生成最小 Chunk。
- `PrivateLearningSummary` 由已保存 attempt/review/item-state 的结构化聚合确定性生成，不复制完整 Coach 对话，也不使用模型臆测薄弱项。
- owner 只从权威关系读取；任何 ingestion 请求中的 owner 字段都被忽略。

**Rationale**: 复用已有学习闭环和删除级联，排除 `ErrorEntry`、未保存输出和其他用户数据。

## R-009 — 数据库 outbox + BullMQ 实现可靠摄取

**Decision**: 业务写入在同一主库事务中 upsert `KnowledgeIngestionJob`；AI 应用 dispatcher claim PENDING job 并以行 ID 作为 BullMQ `jobId`，processor 执行摄取。数据库唯一键是幂等权威，BullMQ 负责分发、退避与恢复。

**Rationale**:

- 项目已使用 BullMQ/Redis，可以复用执行基础设施。
- 仅在业务事务提交后直接 enqueue 存在提交成功但消息丢失窗口；outbox 消除该窗口。
- 当前没有通用领域事件总线；新增完整事件平台不符合范围。

**Retry policy**: Provider 超时/限流等可重试错误采用受限指数退避；维度错误、来源无权、结构/敏感校验失败为不可重试。具体尝试次数和时间在批准运行策略中配置，不硬编码生产猜测。

## R-010 — 原子 release，普通更新不打断旧版本

**Decision**: 每个权威业务对象内容版本生成一个 STAGED release，所有 Document/Chunk/Embedding 完整后在单事务中激活并 supersede 旧 release。普通更新失败时旧版本保持 ACTIVE；删除、到期或撤权则先立即失效，不能因新任务失败继续可用。

**Idempotency keys**:

- Document: `(sourceId, sourceRecordType, sourceRecordId, contentVersion)`
- Chunk: `(documentId, chunkingVersion, chunkKey, contentHash)`
- Embedding: `(chunkId, embeddingVersion, inputHash)`
- Job: `(operation, sourceRecordType, sourceRecordId, contentVersion, pipelineVersion)`

**Conservative stale-copy policy**: cutover 前保留旧 active 版本；cutover 后不默认保留 raw rollback copy。旧 Chunk/vector/excerpt 在 24 小时内清除，仅保留不含正文的版本、哈希、权利和删除审计元数据 180 天。未来只有明确权利政策才能延长 raw 保留。

## R-011 — 权限过滤必须位于向量 SQL 内

**Decision**: `PrismaKnowledgeVectorRepository.search(subjectId, query)` 接收主体作为独立参数，并在一个 SQL 中强制：

```text
active release
AND active source/right/use window
AND compatible embedding/chunk/retrieval versions
AND requested business filters
AND (
  PUBLIC
  OR OWNED_COURSE with EXISTS purchased CourseRecord for subject
  OR PRIVATE_OWNER with chunk.userId = subject
)
```

调用方过滤器只能与服务端条件做交集。无权 course/word/citation 与不存在返回同样结果。

**Rationale**: 先取全局向量再在 TypeScript 过滤会让其他用户数据进入内存、Trace 或排名，违反隔离要求。

**Alternative considered**: PostgreSQL RLS 暂不采用；当前项目没有请求级数据库 session identity，仓促加入会与 Prisma 连接池交互并建立第二套授权机制。集中仓储 + 单 SQL + 双用户 canary 测试更贴合现有架构。

## R-012 — 首版不使用 retrieval cache

**Decision**: 不缓存 query embeddings 或检索结果。BullMQ 和 Redis 只继续承担既有作业/事件用途。

**Rationale**:

- 当前没有性能证据需要 cache。
- 私有/课程结果的 key、失效、撤权和删除会显著增加风险。
- FR-040 只在缓存存在时约束；先不缓存是最简单安全方案。

**Future boundary**: 若后续基线证明需要，key 必须包含 HMAC subject、access scopes、filters、content release、embedding/retrieval versions 和 query hash，且失效流程可枚举并删除。

## R-013 — 模型仅选择 citationId，服务端拥有 Citation 内容

**Decision**:

- 检索服务以现有 `nanoid` 签发不可预测 `citationId`，持久化绑定 request/chunk/contentVersion。
- Prompt 中只暴露本次允许的 ID、来源摘录和相关性；模型输出 `groundedClaims` 的 ID 引用，不输出可权威修改的 source/title/excerpt。
- 服务端校验 ID 属于同一请求、仍可访问、版本一致，且 claim 文本存在于限定结果路径，再组装公开引用。

**Rationale**: 现有仅按 `sourceId` membership 校验，无法防止模型改写摘录或把一个来源用于不支持的声明。

**Claim location**: `resultPath` 使用受限 JSON Pointer（如 `/explanation`、`/examples/0`），`text` 必须为该路径中的精确子串；前端据此关联来源卡片，不依赖脆弱字符 offset。

## R-014 — v2 只存引用 ID，读取时动态投影

**Decision**: `coach.result.storage.v2` 只持久化引用 ID 和 grounded claims；公开 `coach.result.v2` 在首次 SSE、request API 和历史 API 返回前通过 `CoachResultProjectionService` 解析 Citation。`GET /coach/citations/{citationId}` 使用相同 resolver。

**Rationale**:

- 当前 JSON 字段若保存摘录，会在源删除后残留，难以保证历史不泄露。
- 绑定表允许 source invalidation 立即清空 excerpt，并在每次读取重新授权。
- v1 历史继续旧 parser；不批量改写已有结果。

**Invalidation**: 标记 Citation `UNAVAILABLE`、清空 excerpt、记录非内容 hash/原因，并清除受影响 request 的 Redis stream。公开历史卡片只返回 unavailable 状态。

## R-015 — Context budget 复用现有模型 token 能力

**Decision**: 引入 `CoachTokenCounter` 端口，由现有 LangChain ChatModel 的 token-count 方法适配；fake 在测试中确定性计数。Context builder 逐结果计算完整序列化后 Token，按 rank、来源多样性和 claim 需要裁剪。

**Fail-closed behavior**: token counter 不可用时只允许更保守 UTF-8 byte upper bound 的测试/disabled 模式；生产 RAG gate 不得批准，直到计数器与 Provider 报告 usage 在固定样本上校准。

**Rationale**: 复用现有依赖，避免新增 tokenizer；同时不把字符数静默冒充生产 Token。

## R-016 — 冲突检测使用结构化事实键

**Decision**: Source adapters 在能确定时生成 `factKey`、`factValueHash` 和 `authorityRank`。同一 key 的不同有效值形成 conflict group；当前版本和明确权威规则可确定性消解，否则从 factual context 排除并返回结构化 unresolved conflict。

**Rationale**:

- 模型自行选择冲突来源不可审计。
- 首版无证据引入 LLM conflict judge 或 Reranker。
- 结构化词典/语法/课程知识点可以稳定标注；不能标注的文本明确保持限制，不假装完整检测。

## R-017 — 扩展现有 Trace，而非新增可观测平台

**Decision**: 使用 `CoachStepTrace.redactedMetadata` 记录 RAG 元数据，扩展顶层 allowlist；不增加第三方 tracing 服务或默认正文日志。

**Recorded fields**: query HMAC、applied filters、source-rights/embedding/chunk/retrieval/index versions、阶段计数、rank/score/source category、conflict/dedup decision、latency、context token count/mode、selected/discarded counts、used citation IDs、status/failure code。

**Retention**: 元数据 180 天；查询/摘录诊断默认关闭，显式批准时最多 7 天；原始 userId 继续使用现有 HMAC subject mapping。

## R-018 — 复用现有评测框架并以安全门禁优先

**Decision**: 在 `server/apps/ai/test/evals` 增加 RAG fixtures、rubrics、deterministic assertions 和 report fields。exact retrieval 是 retrieval truth；live Provider/Coach 仅在候选发布评测运行。

**Deterministic zero-tolerance**: auth、cross-user、arbitrary userId、source rights、prompt injection authority、fabricated citation、stale citation、schema、context budget。

**Measured metrics**: Recall@K、Precision@K、MRR、citation accuracy/coverage、faithfulness、unsourced claim rate、schema first/final pass、P50/P95/max retrieval latency、context/total tokens、embedding/model cost。

**Decision rule**: 尚无批准基线的数值保持 `pending_measurement`；安全失败永远不能被平均质量抵消。

## R-019 — 分阶段开关，不修改生产配置

**Decision**: 后续实现定义但本阶段不写入配置的状态：

```text
RAG_ENABLED=false
RAG_SHADOW_ENABLED=false
RAG_INGESTION_ENABLED=false
RAG_PRIVATE_CONTENT_ENABLED=false
RAG_EMBEDDING_PROVIDER_APPROVED=false
```

并要求批准的 provider/model/dimensions、source-rights snapshot、chunking/retrieval/index/schema/eval/price versions、Top K、minimum relevance、context tokens、timeouts 和成本上限。

**Rollout**: off（保持旧行为）→ shadow（授权查询但不进 Prompt/前端）→ enabled（通过完整门禁后才影响回答）。这只是计划；生产配置变更、迁移、推送和部署均需用户另行授权。

## Resolved Technical Unknowns

| Topic | Resolution |
|-------|------------|
| Vector database | Existing PostgreSQL + pgvector |
| Prisma support | Custom migration + Unsupported vector + parameterized raw SQL |
| Initial search | Exact cosine; no ANN/hybrid/reranker |
| Vector dimensions | Runtime-approved, stored and validated; not guessed in plan |
| Embedding SDK | None; native-fetch gateway and deterministic fake |
| Course access | Shared storage + existing purchased-course entitlement |
| User isolation | Server subject in same vector SQL and resolver SQL |
| Cache | None in v1 |
| Citation authority | Server-generated IDs and server-hydrated metadata |
| Historical invalidation | ID-only stored result + dynamic resolver + excerpt purge |
| Lifecycle | Outbox/BullMQ, staged release, atomic cutover, immediate invalidation |
| Stale raw retention | No default rollback copy after cutover; purge within 24h |
| Token budget | Existing LangChain model counter port, calibrated before enablement |
| Conflict handling | Deterministic structured fact keys; unresolved excluded |
| Observability/evaluation | Extend existing Coach Trace and eval runner |
| New package dependency | None |

The remaining dictionary-rights, actual course corpus, pgvector infrastructure, Embedding Provider, production budgets, and evaluation targets are explicit rollout/data approvals. The architecture is resolved and fail-closed without pretending those approvals already exist.
