# Specify Evidence Inventory: 统一 AI 评测与质量门禁

**Date**: 2026-09-14  
**Feature**: [spec.md](./spec.md)  
**Target**: https://github.com/cjw32/en-learning-plus.git  
**Inspected revision**: `b9bad65167091662a34056626e8c621e466f08d5`，当前分支 `codex/english-learning-mcp`。

本文件是 Specify 的事实盘点与需求依据，不是实现计划、开发任务或新评测报告。本轮仅做源码、配置、样本及历史证据检查；没有运行模型、语音或其他付费评测，也没有重新执行历史测试。下列样本数由本轮读取数据文件统计，历史通过数只属于原文记录的环境与版本。

开始时工作区存在未跟踪的 `.agents/`、`.specify/` 和 `apps/web/stats.html`；本轮保留它们，仅按 Specify 约定更新活动规格指针并新增 005 规格文件。未创建或切换 Git 分支。

## Project conventions and SDD

- 仓库 remote 与目标一致；[CLAUDE.md](../../CLAUDE.md) 是部署备忘，说明环境凭证不可入库。没有把其中部署命令当成本次任务。
- 已读取 [develop-ai-learning-feature](../../.agents/skills/develop-ai-learning-feature/SKILL.md)、[项目边界](../../.agents/skills/develop-ai-learning-feature/references/project-context.md)、[SDD 规则](../../.agents/skills/develop-ai-learning-feature/references/sdd-development-rules.md) 和 [speckit-specify](../../.agents/skills/speckit-specify/SKILL.md)。本轮按明确用户指令将前一 Skill 的边界与 AI 约束用于规格工作，不启动实现。
- [constitution.md](../../.specify/memory/constitution.md) 全部为未填占位符及示例，不构成已批准宪章。仓库文件扫描未发现适用的 `AGENTS.md`。
- [init-options.json](../../.specify/init-options.json) 指定顺序编号；现有目录 001–004，故使用 005。已通过 [resolve-template.sh](../../.specify/scripts/bash/resolve-template.sh) 解析活动模板，命中现有 [spec-template.md](../../.specify/templates/spec-template.md)，保持必需章节顺序。
- `.specify/extensions.yml` 不存在，before_specify / after_specify 均无钩子可执行。
- 已核对 [GitHub Spec Kit 官方说明](https://github.com/github/spec-kit) 中 Specify 先定义需求、随后 Plan 的流程；本仓库四阶段约定和本次用户范围为执行边界，不安装或更新工具。
- 已阅读 001–004 的规格、相关验收和追溯/实现证据。早期规格中的“当前未实现”描述不能替代当前源码事实；历史 Implement 完成也不能替代尚未执行的真实评测。

## Existing capabilities and evidence boundaries

| ID / 模块 | 已存在且可复用的能力 | 可追溯证据及限制 | 本功能关联 |
| --- | --- | --- | --- |
| INV-001 Coach 业务 | 受控意图路由、画像读取、材料检索、练习/批改、结果校验与写入门禁；真实结构化模型调用及用量记录已有实现。 | [coach.graph.ts](../../server/apps/ai/src/coach/workflow/coach.graph.ts)、[真实模型适配](../../server/apps/ai/src/coach/workflow/coach-structured-model.provider.ts)。工具顺序部分由业务控制，不能统称为自主模型选工具。 | FR-005、FR-012、FR-016 |
| INV-002 Coach 评测 | 60 条 JSONL 样本、严格样本校验、工具路径/安全断言、六类质量量表、运行器、报告、基线门禁和 Trace 关联。 | [样本](../../server/apps/ai/test/evals/fixtures/cases.jsonl)、[断言及 Schema](../../server/apps/ai/test/evals/deterministic-assertions.ts)、[run.ts](../../server/apps/ai/test/evals/run.ts)、[report.ts](../../server/apps/ai/test/evals/report.ts)、[release-gate.ts](../../server/apps/ai/test/evals/release-gate.ts)、[trace-linker.ts](../../server/apps/ai/test/evals/trace-linker.ts)。runMockEvaluation 用 expected.toolOrder 构造路径，并使用固定计算值生成时延/用量，qualityState 为 unscored；不是业务实际运行。runLiveEvaluation 是接受执行回调的函数，不等于已接通且获准的真实评测入口。 | FR-005–FR-007、FR-009–FR-012、FR-035 |
| INV-003 Coach 执行报告 | 有构建、规则/集成、浏览器和隔离数据库的历史证据；主观逐案量表有可复用锚点。 | [implementation-evidence.md](../001-personalized-learning-coach/implementation-evidence.md)、[release-readiness.md](../001-personalized-learning-coach/release-readiness.md)、[correction 量表](../../server/apps/ai/test/evals/rubrics/correction.json)。[coach-v1-approved.json](../../server/apps/ai/test/evals/baselines/coach-v1-approved.json) 实际是 pending_measurement / approved=false；命名不代表批准。没有据此证明真实质量或可生产写入。 | FR-017–FR-018、FR-023、FR-030 |
| INV-004 RAG 业务 | 实际 Embedding 边界、权限约束的向量检索、排序/去重、冲突检查、引用签发和受控上下文，Coach 结果已支持引用合同 v2。 | [检索服务](../../server/apps/ai/src/knowledge/retrieval/rag-learning-material-search.service.ts)、[向量仓储](../../server/libs/learning/src/knowledge/retrieval/vector.repository.ts)、[Embedding 实现](../../server/apps/ai/src/knowledge/embedding/http-embedding.gateway.ts)。这是向量 RAG 能力，不是普通联网搜索；真实 Provider/语料授权仍受配置门禁约束。 | FR-005、FR-013、FR-021 |
| INV-005 RAG 评测 | 主集 20 条、降级 9 条、生命周期 6 条、个性化 7 条；已有严格样本格式、相关性/引用/忠实度指标与量表、报告及安全门禁。 | [主集](../../server/apps/ai/test/evals/fixtures/rag-cases.jsonl)、[降级集](../../server/apps/ai/test/evals/fixtures/rag-degradation.cases.jsonl)、[生命周期集](../../server/apps/ai/test/evals/fixtures/rag-lifecycle.cases.jsonl)、[个性化集](../../server/apps/ai/test/evals/fixtures/rag-personalization.cases.jsonl)、[指标](../../server/apps/ai/test/evals/rag-metrics.ts)、[量表](../../server/apps/ai/test/evals/rag-rubric.ts)。run.ts 的 deterministicRagExecution 从 expected.relevantChunkIds、expected.citationIds 构造命中及正确标记；输出最终标 mode=mock。可以验证报告/计算，不证明真实召回或忠实度。 | FR-005–FR-007、FR-013、FR-025、FR-050 |
| INV-006 RAG 实验和基线 | 已记录隔离数据库实际检索、数据生命周期、工具集成、引用和浏览器回归。 | [implementation-evidence.md](../002-rag-source-citations/implementation-evidence.md) T111–T119；[exact-search-baseline.md](../002-rag-source-citations/exact-search-baseline.md) 使用 5,000 条合成数据及 8 维假向量，有 30 次查询耗时记录，仅是局部查询/性能实验；[rag-v1-pending.json](../../server/apps/ai/test/evals/baselines/rag-v1-pending.json) 仍未批准。临时目录中的原报告路径不是本轮可用证据保证。 | FR-022–FR-023、FR-030、FR-039 |
| INV-007 发音业务 | 目标与身份校验、音频处理边界、Azure Provider 适配、结构化结果/逐词对齐、置信度/支持维度、幂等学习写入、取消重试与成本 Trace。 | [应用服务](../../server/apps/ai/src/pronunciation/application/pronunciation-assessment.service.ts)、[Azure 适配](../../server/apps/ai/src/pronunciation/provider/azure-pronunciation.provider.ts)、[Provider 执行器](../../server/apps/ai/src/pronunciation/provider/pronunciation-provider.executor.ts)。Azure 配置区分模型身份可核验性及语调可用性；不能补造未支持评分维度或以转写准确率代表发音准确度。 | FR-014、FR-016、FR-021、FR-033 |
| INV-008 发音评测 | 3 条合成描述、严格来源/标注/版本格式、WER、错误识别、时间戳/人工分数差异、重复与口音指标、Runner、独立门禁、费用及可观测报告。 | [manifest](../../server/apps/ai/test/evals/pronunciation/fixtures/manifest.jsonl)、[样本说明](../../server/apps/ai/test/evals/pronunciation/fixtures/README.md)、[Runner](../../server/apps/ai/test/evals/pronunciation/pronunciation-evaluation.runner.ts)、[Runner 自测](../../server/apps/ai/test/evals/pronunciation/pronunciation-evaluation.runner.spec.ts)、[指标](../../server/apps/ai/test/evals/pronunciation/pronunciation-metrics.ts)、[门禁](../../server/apps/ai/test/evals/pronunciation/pronunciation-release-gates.ts)。自测 Provider 返回案例中的 annotation/runtime；没有授权人工音频。Runner 仅校验 live 前置批准与正预算，不能据此假定已有完整运行中的统一预算/取消/部分结果保护。 | FR-014、FR-018、FR-025–FR-026、FR-033 |
| INV-009 发音报告 | 有服务端、Web、Chromium、Provider 替身、数据库与自测证据；自测明确 synthetic only。 | [implementation-evidence.md](../003-pronunciation-assessment/implementation-evidence.md) T096–T105 与 Final gated status：合成 Provider 成功 2/3，未达到已有 99% 门槛；人工公平性/真实 Provider 未验证。历史浏览器设备矩阵存在未完成项，不把所有业务/发布验收说成完成。 | FR-008、FR-030、FR-052 |
| INV-010 MCP 业务 | 初始化/双协议路径、Resources、六个 Tool、三个 Prompt、scope/授权、写入确认、幂等/取消、业务服务及 Trace 已有代码和测试。 | [工具注册](../../server/apps/ai/src/mcp/tools/mcp-tool.registry.ts)、[Prompt 注册](../../server/apps/ai/src/mcp/prompts/mcp-prompt.registry.ts)、[请求流程](../../server/apps/ai/src/mcp/transport/mcp-request-pipeline.ts)、[traceability.md](../004-english-learning-mcp/traceability.md)。既有读取、建题和提交写操作边界继续适用，评测不扩展 Tool 能力。 | FR-005、FR-015–FR-016 |
| INV-011 MCP 评测 | 主集 18 条（9 类正反样本）、另有 create-quiz/prompts 案例；确定性评估器、评分模型边界、指标/费用/Trace 报告与发布门禁。 | [主集](../../server/apps/ai/test/evals/mcp/fixtures/mcp-eval-cases.v1.json)、[确定性评估器](../../server/apps/ai/test/evals/mcp/mcp-deterministic-evaluator.ts)、[AI 评估器](../../server/apps/ai/test/evals/mcp/mcp-ai-evaluator.ts)、[pipeline 自测](../../server/apps/ai/test/evals/mcp/mcp-evaluation-pipeline.spec.ts)、[发布门禁](../../server/apps/ai/test/evals/mcp/mcp-release-gate.ts)。AI 自测使用固定 0.8 的替身评分；端口已有分数/用量和 Prompt/量表版本，但完整理由、实际评分模型身份及人工校准仍需补齐。 | FR-015、FR-017–FR-020、FR-028 |
| INV-012 MCP 实际证据 | 2026-09-11 有本地规则/协议/合成验证及机器报告。 | [final-verification.md](../004-english-learning-mcp/evidence/final-verification.md)、[synthetic-report.json](../004-english-learning-mcp/evidence/evals/synthetic-report.json) 记录 local-fake-provider、18 条规则通过、真实质量 sampleCount=0、客户端 0/4；[approved-baselines.md](../004-english-learning-mcp/evidence/evals/approved-baselines.md) 和 [release-decision.json](../004-english-learning-mcp/evidence/evals/release-decision.json) 明确 NOT_READY。不能将协议或自测视为真实客户端模型选工具成功。 | FR-015、FR-023、FR-031、FR-039 |

## Version and Trace inventory

| 范围 | 现有管理方式及证据 | 统一评测尚需证明的部分 |
| --- | --- | --- |
| Coach Prompt / 模型 / Schema | [Prompt manifest](../../server/apps/ai/src/coach/prompts/coach-prompt.manifest.ts) 对工作流 Prompt 计算内容哈希；[registry](../../server/apps/ai/src/coach/prompts/coach-prompt.registry.ts) 按名称/版本解析并计算哈希；模型配置与 [Trace](../../server/apps/ai/src/coach/observability/coach-trace.service.ts) 记录模型/Prompt/hash/结果 Schema/预算。 | 汇总完整的实际 Prompt 配置与代码改动指纹；不能因有版本字符串就认定 Provider 模型可固定或历史条件可复现。 |
| RAG 内容 / Embedding / 索引 | [knowledge-versions.ts](../../server/libs/learning/src/knowledge/domain/knowledge-versions.ts) 分别列内容策略、权利快照、切分、Embedding、索引、检索、Schema、评测/量表/价格；[检索](../../server/apps/ai/src/knowledge/retrieval/rag-learning-material-search.service.ts) 使用请求实际版本与权限。 | 多个常量明确 pending/unapproved；需要运行时真实快照及 Chunk 变化后金标语义映射，不能仅复制静态常量。 |
| 发音 Provider / 规则 / 标注 | [versions.ts](../../packages/common/pronunciation/versions.ts) 区分 Provider 适配、契约、能力、规范化、对齐、评分、置信度、学习映射、预算与价格；[Trace](../../server/apps/ai/src/pronunciation/observability/pronunciation-trace.service.ts) 关联调用、重试、版本、费用和结果。 | 将音频身份、人工金标、实际 Provider/模型可得身份及跨 Provider 量尺可比性绑定到评测运行。 |
| MCP 协议 / 工具 / Prompt | [protocol-versions.ts](../../packages/common/mcp/protocol-versions.ts)、[能力合同](../004-english-learning-mcp/contracts/mcp-capabilities.schema.json)、[Trace](../../server/apps/ai/src/mcp/observability/mcp-trace.service.ts) 记录协议、能力、Prompt、主体与调用阶段。 | 加入实际客户端与模型组合、完整 Tool/Prompt 合同快照和实际工具选择记录；未运行的矩阵不能从静态合同推导通过。 |
| 统一运行身份 | 各模块已有脱敏 Trace、schemaVersion/reportVersion、成本版本及报告局部上下文。 | 尚未发现四模块共同的完整运行快照，涵盖代码未提交改动、执行模式、案例筛选、基线可比性、并发/缓存、所有尝试和分组结论。 |

## Existing execution entry points and CI

以下为已经存在的入口或历史文档中的调用方式，仅用于证明复用来源；不是本功能未来接口设计，也未在本轮执行。

- [根 package.json](../../package.json) 只有应用启动和 `test:e2e`，没有四模块统一评测命令。[server/package.json](../../server/package.json) 提供通用测试命令；发音和 MCP 评测可通过对应测试套件运行，但不能等同独立真实 Provider 入口。
- Coach/RAG 的 [run.ts](../../server/apps/ai/test/evals/run.ts) 已有命令入口：Coach `--mode mock`；RAG 默认/`--mode deterministic` 输出 mock 报告。其命令入口对 `--mode live` 明确抛错；当前其它未知 mode 也未统一严格拒绝，支持 FR-002 的配置错误要求。
- RAG 历史执行文档记录 `pnpm --filter @en/server exec tsx apps/ai/test/evals/run.ts --mode deterministic --dataset rag-eval.synthetic.v1 --output /private/tmp/en-learning-plus-rag-eval-report.json`，只能支持其明确的模拟报告检查。
- MCP [final-verification.md](../004-english-learning-mcp/evidence/final-verification.md) 记录 `pnpm --filter @en/server test -- --runInBand apps/ai/test/evals/mcp`；真实客户端及 Provider 门禁仍未完成。
- 已检查包含隐藏文件的项目文件清单，排除依赖、构建和 Git 内部数据；未发现 `.github/workflows`、GitLab CI、Jenkins、CircleCI 或 Azure Pipelines 配置。远程后台 CI、分支保护和部署配置不在本轮检查范围，不能由本地缺少文件断言远程完全没有 CI。
- [playwright.config.ts](../../playwright.config.ts)、服务端普通/独立 E2E 测试配置及各模块 contract/security/integration/evals 测试是可复用资产。历史报告中存在不同执行入口与依赖跳过；单一通用测试成功不能覆盖所有必需评测。

## Repeated concerns and gaps

这里的“重复”指分散维护的相同职责，不判定既有模块业务实现冗余，也不预选如何重构。

| ID | 已观察重复或缺口 | 要求与验收关联 |
| --- | --- | --- |
| GAP-001 | Coach/RAG、发音、MCP 各有 Runner/报告/门禁，状态分别为 mode mock/live、synthetic/live、allowed/releaseEligible/READY/NOT_READY 等，缺少四态公共口径。 | FR-001、FR-006、FR-028、FR-035–FR-036；SC-001、SC-004、SC-015 |
| GAP-002 | 模块分别计算百分位、用量、费用、Trace 完整度和安全结果；部分空样本值为 0，部分为 null，部分除以样本总数。 | FR-024–FR-025、FR-035–FR-039；SC-009 |
| GAP-003 | 旧 Coach 样本要求 result v1，而 RAG/当前 Coach 已存在 v2；样本 provenance/授权、风险、评估器版本和 SDD 关联在各模块完整度不同；未发现统一独立验证划分与污染控制。 | FR-005、FR-009–FR-011、FR-021–FR-022；SC-002、SC-003 |
| GAP-004 | 若干评测器用期望值、合成 annotation 或手填观测验证报告，并非执行真实业务；真实命令接通、人工/模型校准、授权音频与客户端模型证据不齐。 | FR-007、FR-012–FR-020、FR-050；SC-004、SC-006、SC-017 |
| GAP-005 | 批准基线缺失；未见共同的成对候选/基线运行、变更范围、代码脏状态指纹、缓存/并发条件、分组回退及随机性判断。旧门禁中简单 modelVersion 相等约束也不能直接用于“更换模型”的成对比较。 | FR-021–FR-030；SC-003、SC-008–SC-010 |
| GAP-006 | 各运行器有不同程度的预算批准/事后累计检查，未见跨模块与评分器共享预算、在途上界、统一超时/取消及中断保留部分结果的完整入口。 | FR-004、FR-033–FR-034；SC-011 |
| GAP-007 | 已有对规则、错误指标、安全门禁的局部自测，可复用；尚需端到端证明真实执行→逐案证据→分组/汇总→四态→CI 的一致性，以及零案例/漏测/重试洗白均不能通过。 | FR-036、FR-039–FR-042、FR-050–FR-052；SC-005–SC-009、SC-015 |
| GAP-008 | 项目级 run-ai-evaluation Skill 尚未发现；develop-ai-learning-feature 是 AI 开发流程规范，不是统一评测操作 Skill。 | FR-044–FR-045；SC-013、SC-014 |
| GAP-009 | 模块有既有隐私/删除规则；统一报告、录制回放、CI 产物和人工复核资料的访问与期限仍需明确定义并继承更严格来源限制。 | FR-046–FR-049；SC-012、SC-018 |

所有待测量值与外部批准均已列入 spec 的 Dependencies and Open Evidence；没有由此声称原模块未编码，也没有把它们的发布证据缺口隐藏为本功能已通过。
