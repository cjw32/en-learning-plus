# Tasks: 英语学习知识库 RAG 与来源引用

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`  
**Scope guard**: 本清单仅描述后续实现工作；当前阶段不编码。后续执行时不得新增依赖、修改生产配置、推送或部署，除非获得单独明确授权。  
**Path convention**: 所有路径均相对仓库根目录 `/Users/woofeel/Downloads/en-learning-plus`。  
**Task format**: 每项任务都包含稳定 ID、可并行标记、用户故事标记（仅故事阶段）、明确路径、需求关联和验证方式。

## Phase 1: Setup（共享测试与版本骨架）

**Purpose**: 建立后续测试、版本追踪和证据记录所需的最小共享骨架，不触碰生产配置。

- [X] T001 [P] 建立只含合成/明确授权内容的 RAG 语料夹具和稳定 ID 生成器于 `server/apps/ai/test/fixtures/rag-synthetic-corpus.ts`；关联：FR-002、FR-067、FR-077、FR-078；验证：`pnpm --filter @en/server test -- --runInBand rag-fixtures` 能重复生成相同文档、Chunk、来源及版本标识，且敏感数据扫描为 0。
- [X] T002 [P] 建立 User A/User B、课程授权、私有错题与摘要的隔离夹具于 `server/apps/ai/test/fixtures/rag-access-fixtures.ts`；关联：FR-009、FR-060、FR-061、FR-067、SC-009；验证：夹具断言两个主体、课程和私有 canary 完全不同，并可由 `rag-access` 测试复用。
- [X] T003 [P] 定义内容、切分、Embedding、检索、索引、Schema、评测集及价格版本常量于 `server/libs/learning/src/knowledge/domain/knowledge-versions.ts`；关联：FR-014、FR-025、FR-078、FR-084；验证：`pnpm --filter @en/server build` 通过，且不存在运行时自动推断或空版本。
- [X] T004 [P] 建立 RAG 测试环境构造器于 `server/apps/ai/test/setup/rag-test-environment.ts`，仅允许显式测试数据库、fake embedding 和关闭态开关；关联：FR-010、FR-011、FR-082；验证：无测试数据库标识或 Provider 未批准时构造器 fail closed，且不会读取/改写生产配置。
- [X] T005 创建逐任务验证证据模板于 `specs/002-rag-source-citations/implementation-evidence.md`，记录命令、环境、版本、结果、失败和批准人占位；关联：FR-073、FR-082、FR-084、SC-016；验证：`rg -n 'Task ID|Command|Environment|Version|Result|Approval' specs/002-rag-source-citations/implementation-evidence.md` 均有匹配。

---

## Phase 2: Foundational（所有用户故事的阻塞基础）

**Purpose**: 建立数据模型、来源权利、内容校验、Embedding 边界、向量仓储、可靠 outbox 和模块门禁。此阶段完成前不得开始故事实现。

### Tests first

- [X] T006 [P] 为 RAG 开关、Provider 审批、维度/版本和 test-only 预算编写 fail-closed 测试于 `server/apps/ai/test/governance/rag-config.spec.ts`；关联：FR-025、FR-028、FR-066、FR-082；验证：`pnpm --filter @en/server test -- --runInBand rag-config` 覆盖缺失、未知和不一致配置并全部安全拒绝。
- [X] T007 [P] 为 pgvector 扩展、关系约束、无 typmod `vector`、维度检查、部分唯一索引和默认非 ACTIVE 状态编写数据库测试于 `server/apps/ai/test/integration/rag-schema.e2e-spec.ts`；关联：FR-011～FR-015、FR-022、FR-026；验证：在 disposable PostgreSQL 上运行 `pnpm --filter @en/server test:e2e -- --runInBand rag-schema`，逐项断言通过。
- [X] T008 [P] 为来源台账、字段白名单、授权到期/撤销和禁止品牌字段推断编写单元测试于 `server/apps/ai/test/security/rag-source-rights.spec.ts`；关联：FR-003～FR-006、FR-064、SC-001；验证：`pnpm --filter @en/server test -- --runInBand rag-source-rights` 对缺来源、无用途、过期和未列字段全部拒绝。
- [X] T009 [P] 为内容结构、长度、重复、恶意指令和敏感字段校验编写测试于 `server/apps/ai/test/security/rag-content-validator.spec.ts`；关联：FR-021、FR-064、FR-065；验证：`pnpm --filter @en/server test -- --runInBand rag-content-validator` 覆盖空白、纯链接、模板、超长、PII 和 Prompt Injection。
- [X] T010 [P] 为 Embedding 最小载荷、超时/限流、非有限值、零向量、错误数量/维度/版本编写契约测试于 `server/apps/ai/test/integration/rag-embedding-gateway.spec.ts`；关联：FR-025、FR-026、FR-066；验证：`pnpm --filter @en/server test -- --runInBand rag-embedding-gateway` 证明失败向量永不激活或覆盖旧版本。
- [X] T011 [P] 为数据库 outbox 的原子写入、重复投递、租约重试和最小作业载荷编写测试于 `server/apps/ai/test/integration/rag-outbox.spec.ts`；关联：FR-022、FR-024、FR-026、FR-067；验证：`pnpm --filter @en/server test -- --runInBand rag-outbox` 证明重复消息只有一个有效效果且载荷不含私有正文。

### Core implementation

- [X] T012 在 `server/prisma/schema.prisma` 增加 KnowledgeSource、KnowledgeSourceFieldPolicy、KnowledgeRelease、KnowledgeDocument、KnowledgeChunk、KnowledgeEmbedding、KnowledgeIngestionJob、PrivateLearningSummary、KnowledgeCitation 及枚举/关系；关联：FR-011～FR-015、FR-022～FR-026；验证：`pnpm --filter @en/server exec prisma validate` 与 `prisma generate` 通过，模型字段符合 `data-model.md`。
- [X] T013 在 `server/prisma/migrations/20260908000000_rag_knowledge/migration.sql` 编写 additive pgvector 迁移、约束、索引和回滚注释，不更改既有业务字段语义；关联：FR-011～FR-015、FR-022、FR-026；验证：T007 通过，重复部署无意外 ACTIVE 数据，且迁移只作用于 disposable 数据库。
- [X] T014 定义知识域实体、访问范围、状态机、检索值对象和稳定错误码于 `server/libs/learning/src/knowledge/domain/knowledge.types.ts`；关联：FR-012～FR-015、FR-023～FR-026、FR-034；验证：`pnpm --filter @en/server build` 通过，非法状态迁移在单元测试中被拒绝。
- [X] T015 实现来源与字段权利仓储/策略服务于 `server/libs/learning/src/knowledge/ingestion/source-rights.service.ts`；关联：FR-003～FR-006、FR-064、FR-070、SC-001；验证：T008 通过，且所有发布路径都需要 ACTIVE 来源、有效期和用途白名单。
- [X] T016 实现 fail-closed 内容校验器于 `server/libs/learning/src/knowledge/ingestion/content-validator.ts`；关联：FR-021、FR-064、FR-065、FR-066；验证：T009 通过，校验结果只输出允许字段和稳定拒绝原因。
- [X] T017 定义批量 EmbeddingGateway、版本、维度、使用量和可重试错误端口于 `server/libs/learning/src/knowledge/ingestion/embedding.gateway.ts`；关联：FR-025、FR-026、FR-066、FR-082；验证：T010 的所有 adapter contract cases 可由同一端口执行。
- [X] T018 使用 Node 原生 `fetch` 实现经审批才启用的 Provider adapter 于 `server/apps/ai/src/knowledge/embedding/http-embedding.gateway.ts`；关联：FR-025、FR-026、FR-066；验证：T010 通过，`git diff -- package.json server/package.json pnpm-lock.yaml` 无新增依赖，私有内容资格未批准时拒绝发送。
- [X] T019 [P] 实现确定性 fake embedding 于 `server/apps/ai/src/knowledge/embedding/fake-embedding.gateway.ts`；关联：FR-077、FR-078、FR-082；验证：相同输入/版本产生相同有限维向量，不同 fixture 可稳定区分，测试不访问网络。
- [X] T020 实现参数化 raw SQL 向量仓储基础层于 `server/libs/learning/src/knowledge/retrieval/vector.repository.ts`；关联：FR-011、FR-025、FR-029、FR-032；验证：T007/T010 通过，`rg -n '\$queryRawUnsafe|\$executeRawUnsafe' server/libs/learning/src/knowledge` 无匹配。
- [X] T021 实现同事务写入与可租约领取的 ingestion outbox 仓储于 `server/libs/learning/src/knowledge/ingestion/knowledge-outbox.repository.ts`；关联：FR-022、FR-024、FR-026；验证：T011 通过，崩溃/重试场景不会丢事件或重复激活。
- [X] T022 把知识域 providers/exports 接入 `server/libs/learning/src/learning.module.ts` 与 `server/libs/learning/src/index.ts`；关联：FR-001、FR-010、FR-048；验证：`pnpm --filter @en/server build` 和 `coach-module-wiring` 通过，依赖方向保持 AI adapter → Learning domain → Prisma。
- [X] T023 把 RAG 开关、Embedding adapter 和队列边界接入 `server/apps/ai/src/ai.module.ts` 与 `server/apps/ai/src/coach/governance/coach-config.schema.ts`；关联：FR-001、FR-025、FR-048、FR-082；验证：T006 与 `coach-module-wiring` 通过，默认 `RAG_ENABLED/RAG_SHADOW_ENABLED/RAG_INGESTION_ENABLED/RAG_PRIVATE_CONTENT_ENABLED/RAG_EMBEDDING_PROVIDER_APPROVED` 均为 false。

**Checkpoint**: 数据库、来源权利、内容安全、Embedding、向量访问和 outbox 基础均可独立测试；尚未对用户启用 RAG。

---

## Phase 3: User Story 1 — 获得有依据的词汇与语法讲解（P1）🎯 MVP

**Goal**: 将现有 `search_learning_materials` 升级为受控语义检索，并生成可验证、与声明关联的引用。

**Independent Test**: 用合成且获授权的单词/语法样本提出事实问题；验证语义召回、CEFR 差异、上下文预算、真实引用和最终 Schema，且不存在的语料返回 unavailable/insufficient。

### Tests first

- [X] T024 [P] [US1] 为 `coach.tool.v2` 请求/响应、Top K≤20、相关性 [0,1]、状态不变量、顺序 rank 和禁止 `userId` 编写契约测试于 `server/apps/ai/test/contract/rag-search-learning-materials.contract.spec.ts`；关联：FR-027、FR-028、FR-041～FR-048、SC-005、SC-011；验证：`pnpm --filter @en/server test -- --runInBand rag-search-learning-materials.contract` 通过全部正反例。
- [X] T025 [P] [US1] 为单词义项/用法与语法规则/例外切分、真实字段关联和无语料状态编写测试于 `server/libs/learning/src/knowledge/ingestion/public-content.chunkers.spec.ts`；关联：FR-002、FR-006、FR-016、FR-018、FR-021、SC-004；验证：`pnpm --filter @en/server test -- --runInBand public-content.chunkers` 不合并无关词条、不制造例句/语法内容。
- [X] T026 [P] [US1] 为来源权利校验→切分→向量化→STAGED→ACTIVE 的公共内容流程编写集成测试于 `server/apps/ai/test/integration/knowledge-ingestion.e2e-spec.ts`；关联：FR-003～FR-006、FR-012、FR-021、FR-026、SC-001、SC-004；验证：`pnpm --filter @en/server test:e2e -- --runInBand knowledge-ingestion` 证明只有完整发布可检索。
- [X] T027 [P] [US1] 为 exact cosine、CEFR/单词/分类/来源过滤、门槛、版本兼容、去重和 Top K 编写检索测试于 `server/apps/ai/test/integration/rag-retrieval.e2e-spec.ts`；关联：FR-027～FR-032、FR-035、FR-038、SC-005、SC-006；验证：`pnpm --filter @en/server test:e2e -- --runInBand rag-retrieval` 返回稳定排名且所有 SQL 前置过滤生效。
- [X] T028 [P] [US1] 为 Token 裁剪、不可信数据边界、服务端 citationId、声明支持、伪造/过期引用修复和模型生成例句区分编写安全测试于 `server/apps/ai/test/security/rag-context-citations.spec.ts`；关联：FR-036、FR-037、FR-045、FR-049～FR-054、FR-065、SC-007、SC-010、SC-013；验证：`pnpm --filter @en/server test -- --runInBand rag-context-citations` 对注入与虚假引用零放行。

### Implementation

- [X] T029 [P] [US1] 在 `packages/common/coach/tool.schemas.ts` 定义版本化检索请求、AppliedFilters、RetrievalResult、Citation 和 success/insufficient/failed 判别联合；关联：FR-027、FR-028、FR-041～FR-048；验证：T024 通过且公开/工具 Schema 不含 `userId`。
- [X] T030 [US1] 扩展 `packages/common/coach/generate-contracts.ts` 生成/校验 v1/v2 契约产物并与 `specs/002-rag-source-citations/contracts/search-learning-materials.schema.json` 对比；关联：FR-041、FR-048、SC-011；验证：生成两次无 diff，`jq empty` 通过，旧 v1 合同测试仍绿。
- [X] T031 [P] [US1] 实现仅使用权利白名单字段的 WordBook 来源适配器于 `server/libs/learning/src/knowledge/ingestion/sources/word-book.source.ts`；关联：FR-002～FR-006、FR-014、FR-016；验证：T008/T025 通过，Oxford/Collins/BNC/FRQ 字段名本身不会放行内容。
- [X] T032 [P] [US1] 实现语法/例句/搭配来源可用性适配器于 `server/libs/learning/src/knowledge/ingestion/sources/grammar.source.ts`；关联：FR-002、FR-005、FR-006、FR-018、SC-004；验证：无真实获权内容时只产生 unavailable/insufficient，不创建伪文档。
- [X] T033 [P] [US1] 实现确定性单词与语法切分器于 `server/libs/learning/src/knowledge/ingestion/chunkers/public-learning.chunker.ts`；关联：FR-013、FR-016、FR-018、FR-021；验证：T025 通过，相同输入/策略产生相同边界、hash 和 contentVersion。
- [X] T034 [US1] 实现权利校验、内容校验、切分、批量 embedding 和 staging 的摄取管线于 `server/libs/learning/src/knowledge/ingestion/knowledge-ingestion.service.ts`；关联：FR-003～FR-006、FR-012、FR-021、FR-026；验证：T026 通过，部分失败不会生成 ACTIVE release。
- [X] T035 [P] [US1] 实现自然语言规范化和受限过滤器构造于 `server/libs/learning/src/knowledge/retrieval/retrieval-request.factory.ts`；关联：FR-027～FR-030、FR-039；验证：T024/T027 通过，缺 CEFR 明确记为未应用，无效过滤器不能扩大范围。
- [X] T036 [US1] 在 `server/libs/learning/src/knowledge/retrieval/vector.repository.ts` 实现 exact cosine 查询、状态/权利/版本/维度/门槛 SQL 前置过滤和标准化分数；关联：FR-027～FR-032、FR-038、FR-039；验证：T027 通过并在合成数据上保存 `EXPLAIN (ANALYZE, BUFFERS)` 基线，不创建 ANN 索引。
- [X] T037 [US1] 实现权限范围内的结果去重、最终 rank 重排和证据多样性规则于 `server/libs/learning/src/knowledge/retrieval/retrieval-ranking.service.ts`；关联：FR-031、FR-035、FR-043、FR-044；验证：T027 证明重复 Chunk/等价片段不重复占用 Top K，独立来源不被错误合并。
- [X] T038 [US1] 实现复用现有模型 token count 的预算端口与保守 fallback 上下文构建器于 `server/libs/learning/src/knowledge/retrieval/rag-context.builder.ts`；关联：FR-035～FR-037、FR-045、SC-006、SC-013；验证：`rag-context-citations` 覆盖边界/超预算样本，fallback 模式不能作为生产启用依据。
- [X] T039 [US1] 实现服务端随机 citationId 签发、结果绑定和摘录长度/敏感信息校验于 `server/libs/learning/src/knowledge/citations/citation-issuer.service.ts`；关联：FR-045、FR-049、FR-050、FR-052～FR-054、SC-007；验证：T028 通过，模型/用户输入无法指定、替换或复活 ID。
- [X] T040 [US1] 将 v2 检索实现接入现有 `server/libs/learning/src/materials/learning-material.service.ts` 并保留 flags-off legacy 路径；关联：FR-001、FR-034、FR-048、SC-017；验证：`learning-material.service.spec` 与 T027 通过，RAG 关闭时输出与现有行为兼容。
- [X] T041 [US1] 升级现有 `server/apps/ai/src/coach/tools/search-learning-materials.tool.ts`，只接受受限 v2 schema 并从 `CoachExecutionContext.subjectId` 取主体；关联：FR-001、FR-029、FR-041～FR-048、FR-060；验证：T024 和 `coach-tool-boundary` 通过，工具载荷不存在身份覆盖入口。
- [X] T042 [US1] 在 `server/apps/ai/src/coach/workflow/coach-runtime.workflow.ts` 接入检索请求、受控上下文和 flags-off/shadow/enabled 路由，保留取消/重试/预算语义；关联：FR-001、FR-035～FR-037、FR-048、FR-057；验证：`coach-runtime` 与 T028 通过，shadow 结果不影响用户答案。
- [X] T043 [US1] 更新 `server/apps/ai/src/coach/prompts/answer.prompt.ts` 与 `server/apps/ai/src/coach/workflow/final-result.validator.ts`，要求事实声明关联本次 citationId 并一次修复后安全降级；关联：FR-037、FR-050～FR-055、FR-065、SC-007、SC-010、SC-011；验证：T028 与 `pnpm --filter @en/server test -- --runInBand coach-prompts` 通过，生成例句不会伪装成来源原文。

**Checkpoint**: 在合成/授权词汇与语法数据上，US1 可独立演示和验收；无真实语料的类别诚实返回 unavailable/insufficient。

---

## Phase 4: User Story 2 — 按课程与学习状态获得个性化材料（P1）

**Goal**: 在服务端身份和现有课程授权边界内加入课程、本人错题和最小学习摘要，不允许跨用户传播。

**Independent Test**: 对上下文不同的 User A/User B 执行相同查询；验证课程/私有结果、Prompt、引用、Trace 和任何现有缓存均严格隔离，删除后立即不可见。

### Tests first

- [X] T044 [P] [US2] 为共享课程 Chunk 的 `OWNED_COURSE` entitlement、私有 owner SQL 过滤、越权/不存在不可区分行为编写集成测试于 `server/apps/ai/test/security/rag-access.e2e-spec.ts`；关联：FR-009、FR-029、FR-060～FR-063、FR-067、SC-005、SC-009；验证：`pnpm --filter @en/server test:e2e -- --runInBand rag-access` 的跨用户泄露计数为 0。
- [X] T045 [P] [US2] 为已验证错题投影、确定性学习摘要、缺失信号和 Provider 最小载荷编写单元测试于 `server/libs/learning/src/knowledge/summaries/private-learning-projection.spec.ts`；关联：FR-007、FR-008、FR-019、FR-020、FR-057、FR-066；验证：测试拒绝技术遥测、草稿、完整对话、无依据薄弱项和第三方 PII。
- [X] T046 [P] [US2] 为错题/摘要/账户删除后的立即隐藏、24 小时物理清除和其他用户不受影响编写集成测试于 `server/apps/ai/test/integration/rag-private-deletion.e2e-spec.ts`；关联：FR-024、FR-069、FR-072、SC-003、SC-009；验证：`pnpm --filter @en/server test:e2e -- --runInBand rag-private-deletion` 覆盖检索、引用、Trace 和 replay 清理。

### Implementation

- [X] T047 [P] [US2] 实现按真实课程章节/课时/知识点切分且默认 `OWNED_COURSE` 的来源适配器于 `server/libs/learning/src/knowledge/ingestion/sources/course.source.ts`；关联：FR-002、FR-006、FR-009、FR-017、FR-061；验证：无课程正文时 unavailable，跨权限/版本内容从不拼接，T044 通过。
- [X] T048 [P] [US2] 从已保存练习、提交和批改事实构建最小错题文档于 `server/libs/learning/src/knowledge/summaries/wrong-answer.projector.ts`；关联：FR-007、FR-019、FR-064、FR-067；验证：T045 通过，隐藏评分密钥、其他会话及其他用户数据均不进入 Chunk。
- [X] T049 [P] [US2] 构建按用户/主题/时间版本化的确定性学习摘要于 `server/libs/learning/src/knowledge/summaries/private-learning-summary.service.ts`；关联：FR-008、FR-020、FR-067、FR-069；验证：T045 通过，摘要只来自保存事实且可按 source/version 删除。
- [X] T050 [US2] 在 `server/libs/learning/src/attempts/attempt.service.ts` 的已验证保存事务中写入最小 outbox 事件，触发错题/摘要重建；关联：FR-007、FR-022、FR-024；验证：`coach-attempt.e2e-spec` 与 T011 通过，未提交或批改失败不产生可摄取事件。
- [X] T051 [US2] 扩展 `server/libs/learning/src/knowledge/retrieval/vector.repository.ts`，在向量 SQL 内强制 PUBLIC、OWNED_COURSE entitlement 和 PRIVATE_OWNER owner 过滤；关联：FR-009、FR-029、FR-060～FR-063；验证：T044 通过，数据库返回前已排除无权限 rows，补充查询遵循同一规则。
- [X] T052 [US2] 在 `server/apps/ai/src/coach/workflow/coach-runtime.workflow.ts` 仅用已验证 CEFR、当前课程、目标、薄弱项和到期复习事实构造个性化过滤器；关联：FR-030、FR-057；验证：T044/T045 通过，信号缺失/过期时记录未应用而非推测。
- [X] T053 [US2] 在 `server/apps/ai/src/knowledge/embedding/http-embedding.gateway.ts` 实施 private-content eligibility 和正文最小化投影；关联：FR-066、FR-067；验证：Provider mock 捕获载荷不含 JWT、userId、联系方式、答案密钥或无关元数据，未批准时 fail closed。
- [X] T054 [US2] 扩展 `server/libs/learning/src/privacy/learning-data-deletion.service.ts`，同事务隐藏私有 release/citation 并写入可靠物理删除 outbox；关联：FR-024、FR-069、FR-072；验证：T046 通过，删除 User A 不影响 User B 或公共数据。
- [X] T055 [P] [US2] 在 `server/apps/ai/test/evals/fixtures/rag-personalization.cases.jsonl` 增加等级、课程、错题、摘要、信号缺失和跨用户攻击样本；关联：FR-077、FR-078、SC-004、SC-009、SC-015；验证：fixture schema 校验通过且每例都含 allowed/forbidden source IDs 与版本。
- [X] T056 [US2] 在 `server/apps/ai/test/evals/rag-personalization.eval.spec.ts` 实现 US2 独立确定性评测；关联：FR-077～FR-083、SC-005、SC-009、SC-015；验证：`pnpm --filter @en/server test -- --runInBand rag-personalization.eval` 对两用户比较、缺失信号和删除场景全部通过。

**Checkpoint**: US2 可在不依赖 Citation UI 的情况下通过 API/Trace 独立验证课程和私有个性化隔离。

---

## Phase 5: User Story 3 — 在依据不足时得到诚实降级（P1）

**Goal**: 对空召回、低相关性、冲突、失效、超时和异常做稳定分类，不伪造证据且不破坏 Coach 基础能力。

**Independent Test**: 注入每类不足/失败及迟到结果，验证 `insufficient`/`failed` 分类、无虚假引用、无事实型练习续跑，并保持会话、取消、重试和非材料问答。

### Tests first

- [X] T057 [P] [US3] 为 success/insufficient/failed、空召回、低门槛、失效来源和不可用类别编写状态测试于 `server/apps/ai/test/workflow/rag-degradation.workflow.spec.ts`；关联：FR-006、FR-034、FR-046、FR-047、FR-055、FR-056、SC-008；验证：`pnpm --filter @en/server test -- --runInBand rag-degradation.workflow` 状态分类 100% 正确。
- [X] T058 [P] [US3] 为 structured factKey 冲突、非冲突多来源和作用域内去重编写测试于 `server/libs/learning/src/knowledge/retrieval/conflict-detector.spec.ts`；关联：FR-031、FR-033、FR-047、SC-006、SC-008；验证：无法消解冲突只保留 conflict_context 引用且不进入事实上下文。
- [X] T059 [P] [US3] 为超时、限流、异常、JWT 过期、取消和账户删除后的迟到结果编写集成测试于 `server/apps/ai/test/integration/rag-failure-cancellation.e2e-spec.ts`；关联：FR-034、FR-056、FR-060、FR-069、SC-008、SC-017；验证：`pnpm --filter @en/server test:e2e -- --runInBand rag-failure-cancellation` 无迟到 Prompt/Trace 内容或学习写入。
- [X] T060 [P] [US3] 为知识文档 Prompt Injection、身份/预算/工具覆盖和伪造 citationId 编写零容忍安全测试于 `server/apps/ai/test/security/rag-injection-citation.spec.ts`；关联：FR-037、FR-054、FR-065、FR-081、SC-007、SC-010；验证：`pnpm --filter @en/server test -- --runInBand rag-injection-citation` 通过率 100%。

### Implementation

- [X] T061 [US3] 实现基于 factKey、来源状态/版本/权威级别的冲突检测和可审计决策于 `server/libs/learning/src/knowledge/retrieval/conflict-detector.ts`；关联：FR-033、FR-047；验证：T058 通过，不能安全消解时不静默选择事实。
- [X] T062 [US3] 实现稳定检索结果分类和安全错误码映射于 `server/libs/learning/src/knowledge/retrieval/retrieval-outcome.service.ts`；关联：FR-034、FR-046、FR-047、FR-055、FR-056；验证：T057 通过，诊断只进入 Trace 且不伪装为回答证据。
- [X] T063 [US3] 在 `server/apps/ai/src/knowledge/embedding/http-embedding.gateway.ts` 与检索调用边界增加批准的超时、有限重试和可重试分类；关联：FR-026、FR-034、FR-056；验证：T010/T059 通过，重试不越过 Coach 总预算或取消信号。
- [X] T064 [US3] 在 `server/apps/ai/src/coach/workflow/fallback.builder.ts` 和 `server/apps/ai/src/coach/workflow/coach-runtime.workflow.ts` 实现不足/失败文案与非知识库能力降级；关联：FR-055、FR-056、SC-008、SC-017；验证：T057/T059 与现有 `pnpm --filter @en/server test -- --runInBand coach-control-plane` 通过，不生成依赖失败材料的练习或批改。
- [X] T065 [US3] 在 Prompt 组装前于 `server/apps/ai/src/coach/governance/coach-cancellation.service.ts` 复核取消、JWT 主体有效性、账户和权限状态并丢弃迟到结果；关联：FR-060～FR-063、FR-069；验证：T059 通过，迟到结果不进入 Prompt、内容 Trace 或 SSE。
- [X] T066 [US3] 在 `server/apps/ai/test/evals/fixtures/rag-degradation.cases.jsonl` 增加空、低相关、冲突、撤权、超时、异常、注入、伪造引用和非材料问答样本；关联：FR-077、FR-078、FR-081、SC-008、SC-010、SC-017；验证：样本覆盖表无缺项，确定性 runner 对所有预期状态断言通过。

**Checkpoint**: P1 安全闭环完成；即使 RAG 不可用，现有 Coach 仍合法工作且不会制造知识证据。

---

## Phase 6: User Story 4 — 查看并打开来源引用卡片（P2）

**Goal**: v2 结果只持久化安全标识，读取时重新鉴权并动态投影可用/失效 Citation，Vue 展示去重卡片与声明关联。

**Independent Test**: 混合返回公共、课程和本人私有引用，随后变更权限/版本/删除数据；验证卡片关联、一次点击打开、失效通用状态及零缓存摘录泄露。

### Tests first

- [X] T067 [P] [US4] 为 `coach.result.v2` active/unavailable Citation union、groundedClaims 路径、去重和 v1 兼容编写契约测试于 `server/apps/ai/test/contract/coach-result-v2.contract.spec.ts`；关联：FR-049～FR-054、FR-058、FR-059、SC-007、SC-011；验证：`pnpm --filter @en/server test -- --runInBand coach-result-v2.contract` 通过且无效路径/citationId 被拒绝。
- [X] T068 [P] [US4] 为 citation resolver 的主体、课程 entitlement、私有 owner、枚举防护和越权/不存在不可区分编写 E2E 测试于 `server/apps/ai/test/security/rag-citation-resolver.e2e-spec.ts`；关联：FR-058～FR-063、SC-009、SC-014；验证：`pnpm --filter @en/server test:e2e -- --runInBand rag-citation-resolver` 不泄露来源存在性、locator 或 excerpt。
- [X] T069 [P] [US4] 为历史结果在更新、撤权和删除后的动态失效投影编写测试于 `server/apps/ai/test/integration/rag-citation-history.e2e-spec.ts`；关联：FR-023、FR-024、FR-054、FR-059、FR-069、SC-003；验证：`pnpm --filter @en/server test:e2e -- --runInBand rag-citation-history` 证明旧 ID 不绑定新来源且失效卡片无旧摘录。
- [X] T070 [P] [US4] 为卡片去重、声明关联、private 最小显示、通用失效态和受控打开动作编写 Vue 测试于 `apps/web/src/views/Coach/__tests__/coach-citations.spec.ts`；关联：FR-051～FR-053、FR-058、FR-059、SC-014；验证：`pnpm --filter @en/web test:unit -- coach-citations` 通过，任意外链/内部标识不被渲染。

### Implementation

- [X] T071 [P] [US4] 在 `packages/common/coach/result.schemas.ts` 定义 v2 StoredCoachResult、PublicCoachResult、groundedClaims 和 Citation active/unavailable 判别联合；关联：FR-049～FR-054、FR-058、FR-059；验证：T067 通过，持久化结构只保存 citation IDs/claims 而不保存动态 excerpt/locator。
- [X] T072 [US4] 扩展 `packages/common/coach/generate-contracts.ts` 生成 v2 result/OpenAPI artifacts 并校验 `specs/002-rag-source-citations/contracts/coach-result-v2.schema.json` 与 `specs/002-rag-source-citations/contracts/coach-rag.openapi.yaml`；关联：FR-048、FR-049、FR-058、SC-011；验证：生成幂等、JSON/YAML 可解析且公开合同无 `userId`。
- [X] T073 [US4] 实现 Citation 持久化、版本绑定和当前状态查询仓储于 `server/libs/learning/src/knowledge/citations/citation.repository.ts`；关联：FR-023、FR-024、FR-049、FR-050、FR-059；验证：T067/T069 通过，citationId 唯一绑定一个 chunk/contentVersion。
- [X] T074 [US4] 实现读取时重新鉴权、摘录再校验和 unavailable 通用投影于 `server/libs/learning/src/knowledge/citations/citation-projection.service.ts`；关联：FR-045、FR-054、FR-058～FR-063；验证：T068/T069 通过，禁止从历史 JSON 直接回放受限内容。
- [X] T075 [US4] 将 v2 持久化限制为 IDs/groundedClaims 于 `server/apps/ai/src/coach/api/coach-request.repository.ts`；关联：FR-051、FR-059、FR-067、FR-069；验证：数据库快照和 `coach-request-state` 测试证明无 excerpt、locator 或私有正文持久化。
- [X] T076 [US4] 在 `server/apps/ai/src/coach/api/coach-api.service.ts` 与 `server/apps/ai/src/coach/api/coach.controller.ts` 增加经过同主体鉴权的 Citation 详情解析接口；关联：FR-058～FR-063；验证：T068 与 `pnpm --filter @en/server test -- --runInBand rag-openapi-contract` 通过，未知/越权统一返回安全 unavailable。
- [X] T077 [US4] 在 `server/apps/ai/src/coach/streaming/coach-event-stream.service.ts` 统一 SSE 重连与 durable read 的 v2 动态投影；关联：FR-059、FR-062、FR-067、SC-014；验证：`coach-stream-recovery.e2e-spec` 与 T069 通过，历史 stream 不含失效摘录。
- [X] T078 [P] [US4] 在 `apps/web/src/apis/coach/contracts.ts` 与 `apps/web/src/apis/coach/index.ts` 加入 v1/v2 parser 和受控 Citation detail API；关联：FR-048、FR-058、FR-059；验证：`pnpm --filter @en/web test:unit -- coach-api` 通过，未知版本安全失败且不跟随外部 URL。
- [X] T079 [US4] 在 `apps/web/src/stores/coach.ts` 实现按 citationId 去重、claims 关联、按需解析和权限变化失效刷新；关联：FR-051、FR-053、FR-058、FR-059；验证：`coach-stream.spec` 与 T070 通过，distinct source 支持不被错误合并。
- [X] T080 [US4] 新建 `apps/web/src/views/Coach/components/CitationCard.vue` 并更新 `apps/web/src/views/Coach/components/CoachMessage.vue` 展示来源、标题、分类、安全摘录、关联声明和通用失效状态；关联：FR-051～FR-053、FR-058、FR-059、SC-014；验证：T070 及 `pnpm exec playwright test coach-streaming` 通过，可打开动作只使用代码拥有的路由映射。

**Checkpoint**: US4 可独立验证实时与历史引用；权限变化后不会通过前端或历史流泄露缓存内容。

---

## Phase 7: User Story 5 — 可靠维护知识内容生命周期（P2）

**Goal**: 通过可靠 outbox、BullMQ、幂等摄取和原子 release 管理新增、更新、重处理、失效、撤权及删除。

**Independent Test**: 对同一来源执行首次/重复摄取、内容更新、切分/Embedding 版本变更、部分失败、删除和撤权；验证无重复、无混合发布、旧结果立即退出且私有数据按时清除。

### Tests first

- [X] T081 [P] [US5] 为摄取状态机、部分 embedding 失败、原子激活和旧版保留编写 E2E 测试于 `server/apps/ai/test/integration/knowledge-release.e2e-spec.ts`；关联：FR-022、FR-023、FR-025、FR-026、SC-002、SC-003；验证：`pnpm --filter @en/server test:e2e -- --runInBand knowledge-release` 不出现混合或部分 ACTIVE release。
- [X] T082 [P] [US5] 为重复 outbox/job、内容 hash、chunk hash 和 embedding 唯一键编写幂等测试于 `server/apps/ai/test/integration/knowledge-idempotency.e2e-spec.ts`；关联：FR-022、SC-002；验证：任意重复次数后有效 Document/Chunk/Embedding 计数不增加。
- [X] T083 [P] [US5] 为内容/切分/Embedding/维度版本变化、普通更新失败和重新向量化切换编写测试于 `server/apps/ai/test/integration/knowledge-reembedding.e2e-spec.ts`；关联：FR-023、FR-025、FR-026、SC-003；验证：旧版在新完整版本激活前可用，激活后不再召回，不兼容版本不混用。
- [X] T084 [P] [US5] 为来源撤权、原始删除、私有删除、Citation 清空、Redis replay 清除和到期 purge 编写生命周期测试于 `server/apps/ai/test/integration/knowledge-retention.e2e-spec.ts`；关联：FR-024、FR-059、FR-069～FR-073、SC-003；验证：立即隐藏和模拟 24 小时/7 天/180 天期限均满足且无受限内容残留。

### Implementation

- [X] T085 [P] [US5] 实现 outbox dispatcher 的租约、批量、退避和幂等投递于 `server/apps/ai/src/knowledge/queue/knowledge-outbox.dispatcher.ts`；关联：FR-022、FR-024、FR-026；验证：T011/T082 通过，dispatcher 崩溃恢复不丢消息。
- [X] T086 [US5] 实现复用现有 BullMQ 的知识摄取 processor 于 `server/apps/ai/src/knowledge/queue/knowledge-ingestion.processor.ts`；关联：FR-022、FR-026、FR-067；验证：`rag-outbox` 与 `coach-queue` 测试通过，job payload 仅含 ID/operation/version。
- [X] T087 [US5] 在 `server/libs/learning/src/knowledge/ingestion/knowledge-ingestion.service.ts` 完成状态机、完整性计数、失败分类和幂等恢复；关联：FR-021～FR-026；验证：T081～T083 通过，失败集合永不对外宣称可用。
- [X] T088 [US5] 实现 READY→ACTIVE 原子切换、旧版 supersede 和普通更新回滚规则于 `server/libs/learning/src/knowledge/ingestion/knowledge-release.service.ts`；关联：FR-023、FR-025、FR-026；验证：T081/T083 通过，撤权/删除数据不可作为回滚版本复活。
- [X] T089 [US5] 实现来源到期/撤权/删除与用户删除的同步检索失效协调器于 `server/libs/learning/src/knowledge/ingestion/knowledge-invalidation.service.ts`；关联：FR-024、FR-059、FR-069、FR-070；验证：T084/T069 通过，事务提交后新查询立即不可见。
- [X] T090 [P] [US5] 将 WordBook、Course、Attempt、Summary 的创建/更新/删除转换为 outbox 操作于 `server/libs/learning/src/knowledge/ingestion/source-change.service.ts`；关联：FR-022～FR-025；验证：集成测试覆盖 UPSERT/DELETE/REEMBED，事件不携带正文且重复安全。
- [X] T091 [US5] 编写只处理合成/获批来源、支持 dry-run/checkpoint/幂等的回填脚本于 `server/prisma/backfills/knowledge-index.ts`；关联：FR-003～FR-006、FR-022、FR-025；验证：在 disposable 数据库 dry-run 后两次执行，第二次变更计数为 0，未授权来源计数为 0。
- [X] T092 [US5] 扩展 `server/apps/ai/src/coach/observability/coach-retention.service.ts` 与 `server/apps/ai/src/coach/observability/coach-retention.processor.ts` 处理私有 RAG、诊断 7 天和 Trace 180 天保留；关联：FR-069、FR-071～FR-073；验证：T084 与现有 `server/apps/ai/test/integration/coach-retention.e2e-spec.ts` 通过，审计仅保留允许的 ID/hash/status。
- [X] T093 [US5] 在 `server/apps/ai/src/coach/streaming/coach-event-stream.service.ts` 增加按 citation/request 失效清理受影响 Redis replay 的能力；关联：FR-024、FR-059、FR-067、FR-069；验证：T084/T069 证明旧 stream 无 excerpt 且不影响无关请求。
- [X] T094 [US5] 在 `server/apps/ai/test/evals/fixtures/rag-lifecycle.cases.jsonl` 增加重复摄取、更新、删除、撤权、重新向量化和部分失败回归样本；关联：FR-077、FR-078、FR-083、SC-002、SC-003、SC-015；验证：确定性评测能复现每个生命周期状态且禁止旧 source/chunk ID 不被召回。

**Checkpoint**: US5 在 disposable 环境中可证明长期维护安全；尚不包含生产迁移、配置变更或部署授权。

---

## Phase 8: User Story 6 — 追踪和评估 RAG 质量（P2）

**Goal**: 在现有 Coach Trace 与评测框架中加入可复现的检索、回答、引用、安全、延迟、Token 和成本证据，并以零容忍安全项门禁发布。

**Independent Test**: 运行确定性 RAG 专项集并抽查 Trace/报告；验证每次请求可关联过滤、排名、版本、上下文、引用和反馈，禁止敏感字段为 0，严重安全失败必定关闭发布门禁。

### Tests first

- [X] T095 [P] [US6] 为 success/insufficient/failed Trace 的阶段计数、版本、排名、时延、Token、引用和反馈关联编写 E2E 测试于 `server/apps/ai/test/integration/rag-observability.e2e-spec.ts`；关联：FR-074～FR-076、SC-012；验证：`pnpm --filter @en/server test:e2e -- --runInBand rag-observability` 对每请求用一个现有 Coach traceId 完整关联。
- [X] T096 [P] [US6] 为 JWT/API key/数据库 URL/系统 Prompt/内部推理/私有正文/原始 userId/canary/答案密钥/堆栈编写敏感扫描测试于 `server/apps/ai/test/security/rag-redaction.spec.ts`；关联：FR-067、FR-068、FR-071、SC-009、SC-010、SC-012；验证：`pnpm --filter @en/server test -- --runInBand rag-redaction` 禁止内容命中数为 0。
- [X] T097 [P] [US6] 为 Recall@K、Precision@K、MRR、Citation accuracy/coverage、faithfulness、unsourced rate、Schema/safety 和 P50/P95 编写指标测试于 `server/apps/ai/test/evals/rag-metrics.spec.ts`；关联：FR-079、FR-080、FR-082、SC-015；验证：固定输入得到文档化的精确指标，空分母/争议样本处理稳定。
- [X] T098 [P] [US6] 为 embedding/model token、版本化单价、未知价格、预算上限和估算/实测模式编写成本测试于 `server/apps/ai/test/governance/rag-cost.spec.ts`；关联：FR-074、FR-079、FR-082、FR-084、SC-015、SC-016；验证：`pnpm --filter @en/server test -- --runInBand rag-cost` 对未知/未批准价格 fail closed 且不伪造零成本。

### Implementation

- [X] T099 [P] [US6] 定义 allowlisted RetrievalTraceMetadata、阶段计数、版本和安全失败码于 `server/apps/ai/src/coach/observability/rag-trace.types.ts`；关联：FR-074～FR-076；验证：T095 编译通过，类型不允许原始 identity、完整 query/document 或秘密字段。
- [X] T100 [US6] 扩展 `server/apps/ai/src/coach/observability/coach-trace.service.ts` 与 `server/apps/ai/src/coach/observability/coach-trace-query.service.ts` 写入/查询 RAG metadata 并关联最终引用和反馈；关联：FR-074～FR-076、FR-071、SC-012；验证：T095 通过，unused results 与 used citation IDs 可区分。
- [X] T101 [US6] 扩展 `server/apps/ai/src/coach/observability/coach-redaction.ts` 的 RAG allowlist、hash 和诊断默认关闭策略；关联：FR-067、FR-068、FR-071；验证：T096 和现有 `coach-redaction.spec` 通过，脱敏规则不会记录原始系统 Prompt 或私有文档。
- [X] T102 [P] [US6] 定义版本化 RAG eval case/expected-result schema 于 `server/apps/ai/test/evals/rag-case.schema.ts`；关联：FR-077、FR-078、FR-080、FR-083、FR-084；验证：所有 US1/US2/US3/US5 JSONL fixtures 通过 schema，缺版本/allowed/forbidden/判定方式时失败。
- [X] T103 [US6] 汇总覆盖 FR-077 全部类别的主评测集于 `server/apps/ai/test/evals/fixtures/rag-cases.jsonl`；关联：FR-072、FR-077、FR-078、SC-015；验证：覆盖脚本证明单词、音标/词形、例句/搭配、语法、课程、等级、私有数据、失败、安全、生命周期、延迟、Token、成本无缺项。
- [X] T104 [P] [US6] 固化相关性、引用支持、忠实度、冲突和争议复核量表于 `server/apps/ai/test/evals/rubrics/rag-quality.json`；关联：FR-079、FR-080；验证：rubric 有版本、评分边界和 reviewer privacy 规则，runner 启动后不可动态改量表。
- [X] T105 [US6] 实现 RAG 指标和分位数计算于 `server/apps/ai/test/evals/rag-metrics.ts`；关联：FR-079、FR-082、SC-015；验证：T097 通过，所有指标定义和单位随报告版本输出。
- [X] T106 [US6] 扩展 `server/apps/ai/test/evals/report.ts` 输出来源权利、Prompt、Embedding、Chunk、索引、检索、Schema、数据集、价格版本及质量/安全/延迟/Token/成本；关联：FR-079、FR-082、FR-084、SC-015、SC-016；验证：缺任一版本时报告标为 incomplete 并保持门禁关闭。
- [X] T107 [US6] 扩展 `server/apps/ai/test/evals/release-gate.ts`，把跨用户、注入、身份覆盖、虚假/无来源/失效引用和 Schema 绕过设为零容忍阻断；关联：FR-081～FR-084、SC-016；验证：为每个安全失败注入单例后 gate 均 FAIL，平均质量分不能抵消。
- [X] T108 [US6] 扩展 `server/apps/ai/src/coach/governance/coach-cost-meter.ts` 与 `server/apps/ai/src/coach/governance/model-price.catalog.ts` 记录 embedding/model 用量、价格版本、估算/实测和单请求预算；关联：FR-074、FR-079、FR-082、FR-084；验证：T098 通过，未批准 Provider/价格/预算时 live 评测和 enabled 模式拒绝运行。
- [X] T109 [US6] 扩展 `server/apps/ai/test/evals/run.ts` 支持 deterministic fake 和经明确批准的 test-only live 模式、预算、数据集版本及原子输出；关联：FR-077～FR-084；验证：deterministic 命令离线可复现；live 无凭据/审批/预算时 fail closed 且不发网络请求。
- [X] T110 [US6] 扩展 `server/apps/ai/test/evals/trace-linker.ts` 关联 eval case→Coach Trace→retrieval→claims/citations→feedback，并建立 `server/apps/ai/test/evals/baselines/rag-v1-pending.json` 的 `pending_measurement` 基线；关联：FR-074～FR-076、FR-082～FR-084、SC-012、SC-016；验证：每例可追踪且在明确批准基线前 release gate 始终关闭。

**Checkpoint**: US6 生成可复现报告；“有报告”不等于获准上线，任何生产开关或部署仍需用户另行授权。

---

## Phase 9: Polish & Cross-Cutting Validation

**Purpose**: 做跨故事回归、迁移/回滚演练、性能基线、需求追踪和范围守卫，不执行生产动作。

- [X] T111 [P] 运行共享合同生成与静态检查，并把无 diff 证据记录到 `specs/002-rag-source-citations/implementation-evidence.md`；关联：FR-041～FR-050、FR-084、SC-011；验证：`jq empty` 两个 JSON、OpenAPI 解析、`pnpm --filter @en/server build`、`pnpm --filter @en/web type-check`、二次生成无 diff。
- [X] T112 [P] 运行 AI/Learning 全量单元、契约、集成和 E2E 回归并记录到 `specs/002-rag-source-citations/implementation-evidence.md`；关联：FR-001、FR-048、FR-056、SC-017、SC-018；验证：quickstart 第 6～12 节命令全绿，既有 Coach 认证、会话、取消、重试、练习、批改和学习写入无回归。
- [X] T113 [P] 运行 Vue 单测与现有 Playwright Coach/环境回归并记录到 `specs/002-rag-source-citations/implementation-evidence.md`；关联：FR-058、FR-059、SC-014、SC-018；验证：`pnpm --filter @en/web test:unit -- coach`、`pnpm exec playwright test coach-streaming`、`coach-environment` 全绿且非 AI 页面无阻断缺陷。
- [X] T114 在 disposable PostgreSQL 完成 additive migration、重复回填、备份恢复和 flags-off 应用回滚演练，并记录于 `specs/002-rag-source-citations/rollback-report.md`；关联：FR-011、FR-022～FR-026、FR-070、SC-002、SC-003、SC-017；验证：按 quickstart 第 4/14 节通过，旧 Coach 可恢复且不复活撤权/删除数据；不执行破坏性生产回滚。
- [X] T115 在合成固定数据集记录 exact cosine 的 `EXPLAIN (ANALYZE, BUFFERS)`、P50/P95、规模和过滤后结果，并形成 `specs/002-rag-source-citations/exact-search-baseline.md`；关联：FR-039、FR-082、FR-084、SC-015、SC-016；验证：未有 exact-vs-ANN recall/latency 证据前结论保持“不引入 HNSW”，不修改合同或新增依赖。
- [X] T116 对 FR-001～FR-084、SC-001～SC-018、数据权利、访问边界、无 retrieval cache、无互联网抓取/后台/多 Agent/MCP/独立向量库做追踪审计于 `specs/002-rag-source-citations/requirements-traceability.md`；关联：FR-001～FR-084、SC-001～SC-018；验证：每项需求至少映射一个测试和一个实现/证据任务，无 orphan requirement 或未解释偏差。
- [X] T117 更新 `specs/002-rag-source-citations/quickstart.md` 的最终可复现命令/已知门禁，并完成依赖与生产配置 diff 守卫；关联：FR-005、FR-010、FR-040、FR-073、FR-082～FR-084、SC-016、SC-018；验证：`git diff -- package.json server/package.json apps/web/package.json pnpm-lock.yaml .env .env.production ecosystem.config.js` 无本功能未授权变化，且文档明确“未推送、未部署、生产开关未改”。

---

## Dependencies & Execution Order

### Phase dependencies

```text
Phase 1 Setup
  └─> Phase 2 Foundational
        ├─> US1 (P1: grounded public retrieval)
        ├─> US2 (P1: course/private personalization)
        ├─> US3 (P1: honest degradation)
        ├─> US4 (P2: citation cards; consumes US1 citation IDs and US3 states)
        ├─> US5 (P2: lifecycle; completes source adapters from US1/US2)
        └─> US6 (P2: instrumentation can start early; final gate waits US1–US5)
              └─> Phase 9 Polish & Cross-Cutting Validation
```

- Phase 1 → Phase 2 is mandatory.
- US1, US2 and US3 may start after Phase 2 with separate owners, but integration of US2/US3 must target the versioned contract from T029–T030.
- US4 requires T039 and the status semantics from T062 before its final integration.
- US5 requires the ingestion adapters from US1/US2; lifecycle test authoring can begin earlier.
- US6 trace/test scaffolding can run in parallel after Phase 2, but T106–T110 and release evidence require completed outputs from US1–US5.
- Phase 9 begins only after all selected release-scope stories are complete.

### User-story dependency summary

| Story | Hard prerequisite | Can be independently demonstrated by | Release note |
|---|---|---|---|
| US1 | Phase 2 | T024–T028 plus T040–T043 | Core value slice; public/authorized synthetic data only |
| US2 | Phase 2 and v2 filter contract | T044–T046 and T056 | Private mode stays off until provider/data approvals |
| US3 | Phase 2 and retrieval outcome contract | T057–T060 | Mandatory safety slice before any user exposure |
| US4 | US1 citation issuer + US3 status | T067–T070 | UI may remain separately flagged off |
| US5 | Phase 2 plus relevant source adapters | T081–T084 | Production migration/backfill requires separate approval |
| US6 | Phase 2; final report needs US1–US5 | T095–T098 and T103–T110 | Baseline begins as `pending_measurement` |

### Parallel opportunities

- Setup: T001–T004 can run in parallel because they touch distinct test/domain files.
- Foundation: T006–T011 can be authored in parallel; after T012–T014, T015/T016/T019 can proceed independently before module wiring.
- US1: T024–T028 are parallel test work; T031/T032/T033 can run in parallel; T037/T038/T039 can run after retrieval result shape stabilizes.
- US2: T044–T046 are parallel tests; T047/T048/T049/T055 touch independent source, summary and fixture paths.
- US3: T057–T060 are parallel; T061 and T063 are independent until T064 integrates outcomes.
- US4: T067–T070 are parallel; backend T073/T074 and frontend T078/T080 can proceed in parallel after T071–T072.
- US5: T081–T084 are parallel; T085 and T090 can proceed independently before T086/T087 integration.
- US6: T095–T098 are parallel; T102/T104 and T108 can proceed independently before runner/report/gate integration.
- Polish: T111–T113 are parallel after implementation; T114/T115 require disposable infrastructure but not production access.

---

## Requirement Coverage Map

| Requirement group | Primary task coverage | Principal verification |
|---|---|---|
| FR-001–FR-010: scope, sources, rights | T008, T015–T016, T022–T023, T025–T032, T040–T043, T116–T117 | Rights/security tests, legacy-path regression, scope diff audit |
| FR-011–FR-026: data model and lifecycle | T007, T011–T021, T026, T033–T034, T046, T081–T094, T114 | Disposable DB, ingestion/release/idempotency/retention E2E |
| FR-027–FR-040: retrieval/context | T024, T027, T035–T038, T044, T051–T052, T058, T061, T115–T117 | Exact retrieval/access/context tests and performance baseline |
| FR-041–FR-048: retrieval contract | T024, T029–T030, T040–T043, T067, T072, T111 | Contract generation, schema and compatibility tests |
| FR-049–FR-059: Citation and Coach/UI | T028, T039, T043, T057, T064, T067–T080, T089, T093 | Citation security/history/API/Vue/browser tests |
| FR-060–FR-073: identity, privacy, retention | T004, T009–T010, T044–T054, T059–T060, T065, T068–T077, T084, T089–T093, T096, T101, T116 | Cross-user, deletion, resolver, redaction and retention tests |
| FR-074–FR-084: observability, evaluation, cost | T001–T005, T055–T056, T066, T094–T110, T115–T117 | Trace/redaction/metric/cost tests and reproducible gated report |
| SC-001–SC-018 | T008, T024–T028, T044–T046, T057–T060, T067–T070, T081–T084, T095–T117 | Story checkpoints plus Phase 9 full regression/evidence |

---

## Implementation Strategy

### Suggested MVP

1. Complete Phase 1 and Phase 2.
2. Complete US1 to demonstrate grounded vocabulary/grammar retrieval with synthetic or explicitly authorized data.
3. Complete US3 before any user-facing enablement; honest degradation is a mandatory safety part of the MVP even though US1 is independently testable without it.
4. Keep all RAG flags off until rights, pgvector, Provider, baseline and rollout approvals are documented.
5. Add US2, US4, US5 and US6 incrementally; no step authorizes production configuration, migration, push or deployment.

### Completion rule for every task

- The referenced implementation/test/document path exists and contains only in-scope changes.
- The task's stated verification passes in the approved non-production environment.
- Evidence is appended under the same Task ID in `specs/002-rag-source-citations/implementation-evidence.md`.
- No new dependency, production configuration change, push or deployment is bundled without separate explicit authorization.
