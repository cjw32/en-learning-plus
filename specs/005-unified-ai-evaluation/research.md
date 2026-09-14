# Plan Research and Decisions

**Feature**: [统一 AI 评测与质量门禁](./spec.md)  
**Date**: 2026-09-14  
**Method**: 复用 Specify 盘点与 001–004 既有方案，只研究影响统一入口的新增设计问题。没有运行真实评测、安装依赖或修改配置。

## R-001 — 选择现有工具链承载编排

**Decision**: 在现有评测目录增加 TypeScript CLI，tsx 只执行协调器；Nest 业务 worker 使用已有 ts-node/tsconfig-paths，规则套件走 Jest/ts-jest。Node 内置文件、加密、进程与参数处理足以实现编排，无需新评测框架、数据库或队列。

**Evidence**: [server/package.json](../../server/package.json) 已有 tsx、ts-node、tsconfig-paths、Jest、ts-jest、Supertest；[tsconfig.json](../../server/tsconfig.json) 开启装饰器元数据及路径别名；[AI E2E config](../../server/apps/ai/test/jest-e2e.json) 已处理业务路径。[旧 run.ts](../../server/apps/ai/test/evals/run.ts) 是现有入口先例。Zod 从 [公共包](../../packages/common/package.json) 复用，不向 server 新增重复声明。

**Alternatives**: 外部评测平台增加依赖、远端数据流和不同执行口径；把所有业务载入 CLI 会引入服务启动副作用；直接以 tsx 加载所有 Nest 组合不能保证装饰器元数据。这些均不选。

## R-002 — 真实业务与旧自测分层

**Decision**: 旧案例/量表/指标保留原身份；新增映射元数据和实际执行适配器。已有假结果生成器只用于调度/汇总自测。现有业务入口继续成为行为来源，旧 report.allowed/READY 等状态只作历史信息，重新依照逐案观测和可信规则归并四态。

**Evidence**: [Coach/RAG runner](../../server/apps/ai/test/evals/run.ts) 构造 expected 路径/召回；[发音 runner 测试](../../server/apps/ai/test/evals/pronunciation/pronunciation-evaluation.runner.spec.ts) 返回案例 annotation；[MCP pipeline 测试](../../server/apps/ai/test/evals/mcp/mcp-evaluation-pipeline.spec.ts) 用固定分数。实际业务和历史证据已在 [Evidence Inventory](./evidence-inventory.md) 逐项列出。

**Alternatives**: 直接归并各旧 PASS 会把模拟观测升级为质量证据；重新写四套业务则扩大回归面。两者均违背 FR-005–FR-007。

## R-003 — 环境隔离必须先于业务 import

**Decision**: 单协调器、有界子进程、白名单环境、无 `.env` 的 cwd、专用资源身份探测；测试组合按需复用业务类和测试能力，不直接启动整个生产应用。测试资源验证使用精确标识、专用低权凭证及有效期，不能只靠字符串 test 或 localhost。

**Evidence**: [SharedModule](../../server/libs/shared/src/shared.module.ts) 自动读取 `.env`，还注册邮件/支付/Redis；[RAG 环境助手](../../server/apps/ai/test/setup/rag-test-environment.ts) 对 URL 的有限识别适用于原测试，不能成为统一系统的唯一安全证据。[数据库测试](../../server/apps/ai/test/integration/mcp-persistence-schema.integration.spec.ts) 依赖显式专用 URL 且可被跳过，需逐项捕获。

**Alternatives**: 共享进程切换 process.env 会在不同候选/主体间串用配置；容器编排平台能提供更强隔离但不是当前新增依赖范围，只有用户已有批准隔离设施时复用。进程隔离不是抵御恶意候选代码的安全沙箱；不可信代码只在无秘密的受限 CI 环境执行。

## R-004 — 发音真实能力复用，但不掩盖默认不可用

**Decision**: 评测专用组合注入已有 Azure、音频 inspector、私有 MinIO 实现；不修改生产模块默认绑定。真实评测包含完整合法音频路径与实际评分，缺工具链/授权音频/私有存储等条件即 INCOMPLETE。

**Evidence**: [PronunciationModule](../../server/apps/ai/src/pronunciation/pronunciation.module.ts) 默认绑定三个 Unavailable 端口；[ffmpeg inspector](../../server/apps/ai/src/pronunciation/audio/ffmpeg-pronunciation-audio-inspector.ts)、[MinIO storage](../../server/apps/ai/src/pronunciation/storage/minio-pronunciation-audio.storage.ts)、[Azure adapter](../../server/apps/ai/src/pronunciation/provider/azure-pronunciation.provider.ts) 已存在。复用 [003 Plan](../003-pronunciation-assessment/plan.md) 的原始依赖/权利/费用边界。

**Limit**: `networkDisabled: true` 等请求元数据不等于操作系统已强制禁网/限内存；真实不可信音频验收需要已批准的实际资源限制证据。当前不安装 ffmpeg/ffprobe 或增加沙箱工具，不将此运行依赖误称为新代码架构未定。

## R-005 — 真正可比较的双版本执行

**Decision**: 当前可信控制版本负责两侧执行/评分，候选通过 checkout + 非敏感配置快照指定；基线可复用匹配的批准 bundle，或用明确提供的第二个 checkout 重测。数据、金标和评分语义不变；模型/Prompt/Provider 等有意变量允许不同。无法适配旧业务合同或无法验证基线内容即 INCOMPLETE。

**Evidence**: 旧 [release-gate.ts](../../server/apps/ai/test/evals/release-gate.ts) 简单比对 modelVersion，不满足模型更换场景；[RAG versions](../../server/libs/learning/src/knowledge/domain/knowledge-versions.ts) 有切分/索引/Schema 独立版本，适合分别比较。Coach Prompt 已有 [内容哈希](../../server/apps/ai/src/coach/prompts/coach-prompt.manifest.ts)。

**Alternatives**: 自动 checkout/覆盖工作区不必要；直接重放历史报告无法保证数据/规则一致；把 changed Chunk ID 当召回失败不能支持切分对比。选择提供双 checkout 或批准历史 bundle，且用语义证据映射处理 Chunk 变动。

## R-006 — 停止、预算和崩溃后的证据

**Decision**: 单协调器预留全轮额度，durable event journal 在派发前记 reservation 与计划项，终态按事件重算。停止发新调用、向已有调用传递取消、限时等待与强制结束子进程，受理不明保留潜在费用；recover 仅恢复事实，不自动重发。

**Evidence**: 旧 RAG/发音/MCP runner 的门禁与预算边界不同，缺统一在途预算及完整中断保存。Node 提供不经 shell 的进程参数、timeout/AbortSignal 等控制；发送终止信号本身不能证明进程或远端操作已终止。[Node child_process](https://nodejs.org/api/child_process.html)

**Alternatives**: 全部 Promise 完成后一次写报告会丢失中断证据；事后累加 cost 会允许并发超预算；分布式协调对当前规模过重。此处只设计一个运行内的事务式预留，不创建新的生产计费账本。

## R-007 — 客户端模型证据不能由 SDK 模拟替代

**Decision**: SDK 协议自动检查 + 同轮有界人工客户端会话。统一入口发 challenge 并收集客户端转录及服务端 Trace；操作者执行现有客户端，不实现客户端。费用上界无法约束的组合不启动新的付费任务，保留未完成。

**Evidence**: [MCP_CLIENT_MATRIX](../../server/apps/ai/test/compatibility/mcp-client-matrix.ts) 与 [矩阵模板](../004-english-learning-mcp/evidence/client-matrix-template.md) 要求四客户端独立执行；[FakeMcpClient](../../server/apps/ai/test/mcp/fixtures/mcp-test-environment.ts) 即使内部含 SDK Client，也仍为合成测试环境。既有 validateClientMatrix 要求所有状态相同，不适合实际混合完成状态；统一模型按每行独立归并，不直接沿用该限制。

**Alternatives**: 自动操作所有客户端需要额外 UI 驱动/安装和平台假设；把一个 SDK 用不同产品名运行属于伪证据。本方案在同一清单管理人工步骤及成本，不缩减客户端范围。

## R-008 — 独立验证、校准和随机性

**Decision**: 旧案例全部作为开发可见资产；新 holdout 按同源/近重复组隔离并记录暴露。评分模型需独立人工校准；先每案例汇总再分组/成对比较，统计推断使用版本化 paired cluster bootstrap，参数来自批准政策。质量数值继续依照 spec，不创造阈值。

**Evidence**: [correction rubric](../../server/apps/ai/test/evals/rubrics/correction.json)、[RAG rubric](../../server/apps/ai/test/evals/rag-rubric.ts) 已有固定量表/分歧规则；[发音 metrics](../../server/apps/ai/test/evals/pronunciation/pronunciation-metrics.ts) 有可复用人工一致性/口音残差指标。现有语料没有提供足够独立验证和真实人工校准事实。

**Alternatives**: 给模型输出一个模糊“总体质量分”、用多次重跑当更多独立样本，或者未经样本量判断比较小差异，均不能支持该规格验收。新统计逻辑只需小范围公式实现和手算/参照验证，不引入统计依赖。

## R-009 — CI 的可信控制面和有限权限

**Decision**: GitHub Actions 采用 pull_request/push 快速运行 + 维护者 workflow_dispatch 的可信真实运行；固定控制代码和政策，凭证仅供批准候选与专用环境。最终 job 检查缺失/失败/未执行项目并保存状态；普通快速成功不代表 qualification 成功。

**Evidence**: 本地无 CI 工作流。GitHub 官方建议避免通过高权限触发执行不可信 PR 代码，并限制工作流权限、注入和秘密暴露；本计划采取更简单的分离策略，不依赖某个事件默认权限保证安全。[Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)

**Alternatives**: pull_request_target 检出 fork 后跑真实模型、相信 PR 里的 passed JSON 或复用不可信缓存到特权 job 都不选。Actions 平台现有能力可承载；不引入第三方 CI SaaS。具体受信任 runner/environment、Actions 完整提交固定值属于后续工作流配置审核，当前不添加依赖声明、工作流或后台权限。

## R-010 — 运行记录与内容治理

**Decision**: 本地文件目录作为主记录；CI 只保存允许公开的合成摘要，受限内容保留在已有批准私有测试存储。保留策略、撤权与清理通过 manifest 定位副本；不新建评测运营数据库。默认运行不更新数据/规则/基线；入集、批准和删除作为明确维护任务。

**Evidence**: [001 spec](../001-personalized-learning-coach/spec.md) FR-060、[002 spec](../002-rag-source-citations/spec.md) FR-071–FR-073、[003 spec](../003-pronunciation-assessment/spec.md) 数据生命周期、[004 未批准保留证据](../004-english-learning-mcp/evidence/evals/approved-baselines.md)。新产物没有批准政策就不收集受限内容；历史证据删除后保留非敏感 tombstone 及复现限制。

## Resolved versus pending

R-001–R-010 已形成具体设计决定，无 material design clarification 未解决。Provider/授权音频/预算/质量基线/客户端实际版本/新产物保留期限没有被研究文档虚构为“已批准”；它们通过前置清单与 INCOMPLETE 状态管理，见 spec DEP-001–DEP-007。后续不得通过降低验收范围来解决这些依赖。
