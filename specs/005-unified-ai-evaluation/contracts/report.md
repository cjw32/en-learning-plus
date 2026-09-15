# Result and Report Contract v1

**Feature**: [spec.md](../spec.md)  
**Data model**: [data-model.md](../data-model.md)  
**Status**: 规范性数据契约；运行时 Zod Schema 和实现留到 Implement。本版本不新增业务 HTTP API。

## Bundle

每轮目录包含 manifest.json（冻结输入/清单）、events.jsonl（安全增量事件）、results.jsonl（逐执行项/尝试引用）、report.json、report.md、evidence/index.json（权限/期限/内容引用）和必要的 redacted evidence。preflight 失败时至少写 manifest/诊断 summary；写失败时 stderr 输出安全错误和 operation/run 标识，不输出秘密。

所有文件 schemaVersion、runId 和内容 hash 一致；manifest 内的 expectedArtifactKinds 决定完整性。机器/可读报告均由同一校验对象生成，不各写一套统计。消费者不能只根据 Markdown 中“PASS”或某个旧布尔 allowed 判定成功。

## report.json mandatory fields

| Field | 约束 |
| --- | --- |
| schemaVersion | `ai-evaluation-report.v1`；未知版本拒绝，不尝试按 v1 猜读。 |
| run | id、parentRunId（可空）、createdAt/startedAt/endedAt、state、purpose、profile、executionCompleteness、recovery/修订关联。 |
| control | controlCommit/hash、adapter/catalog/policy hashes、trust 标识、实际执行版本。 |
| scope | 请求、扩展、最终清单及 hash；required modes/groups/items；筛选排除/不适用/缺失及原因；scopeClaim。 |
| versions | candidate、baseline（可空）完整 VersionSnapshot；unknown/N/A 字段给原因。 |
| comparison | comparable/incomparable/review_required、双方 ID、intentionalDifferences、条件差异、有效成对案例和缺失。无需比较时 null + reason。 |
| counts | planned、completed、passed、failed、review、skipped、error、notRun、uniqueCases、attempts、repetitions；每侧及模块分组。 |
| cases | 每项 itemId/caseId/module/side/client、required、declaredMode/actual step modes、terminalState、expected/actual/evaluator/evidence 引用、allAttempts、reasonCodes、原 SDD IDs。大证据使用 runRoot 内受控引用。 |
| metrics | 每个指标 value/unit/direction、数值计算基础、分母/有效/独立 N、排除理由、mode/group、重复波动、不确定性、基线/候选/delta、阈值来源及适用性。 |
| usage | 分 stage/provider/side/call 的 Token/音频/Embedding 用量，已知、估算、未知/潜在费用，币种/价格版本及计算依据，预算总额/预留/结算。 |
| gate | status、exitCode、policyHash、scopeClaim、所有 blocking/missing/review reasons 及相应案例/需求，不能仅布尔 passed。 |
| artifacts | hash、路径/安全引用、类别、访问/保存政策、到期/删除状态、可用证据范围。 |
| reproduction | 无凭证的命令参数、目录/配置身份、前提、版本、过滤、重复/seed/cache；不可复现限制和需重新授权项。 |

机器结果不得嵌入原始音频、访问令牌、Provider key、完整私有会话或系统 Prompt。对用户敏感原文仅允许受批准的 evidenceRef；公开 report.md 展示必要短摘要及安全定位。实际结果缺失时写 actual=null + reason，不用 expected 填充。

## Status and count invariants

- planned = passed + failed + review + skipped + error + notRun；completed = passed + failed + review。
- 去重案例数与执行项数不同；一个案例两个 side/模式/客户端有多个 item。repeat/retry 是 item 的子尝试，不增加 independentN。
- 实际命中集合要与 scope.expected 集合对应，Jest 的 skipped/todo/pending 不能计为 passed。缺输出/崩溃/重复映射/零测试输出均触发完整性问题。
- 逐案有效错误经适用规则证实即 FAIL；必需执行/评分/报告缺失为 INCOMPLETE；合法未裁决评分为 REVIEW；无上述问题且必需条件全部满足才 PASS。
- 高风险失败、低等级组失败等不能被总体均值抵消；optional 身份不能在运行后更改，已证实的零容忍违规无论 optional 与否均 FAIL。
- 失败和未完成可并存：主 gate FAIL，executionCompleteness=incomplete，完整列出原因。保存修订不能覆盖首次结果。

## Stable reason categories

| 类别 | 示例 reasonCode | gate 默认影响 |
| --- | --- | --- |
| 业务/安全事实 | CROSS_USER_LEAK、UNAUTHORIZED_WRITE、DUPLICATE_LEARNING_WRITE、CREDENTIAL_LEAK、CONTRACT_BREAK、FABRICATED_CITATION | FAIL；必须有实际证据，预期攻击被正确拒绝不属于违规。 |
| 有效指标回退 | QUALITY_REGRESSION、GROUP_REGRESSION、LATENCY_LIMIT、COST_LIMIT | 满足样本/判定条件后 FAIL。 |
| 配置/覆盖 | INVALID_FILTER、ZERO_CASES、DUPLICATE_CASE_ID、REQUIRED_ITEM_MISSING、CASE_METADATA_MISSING、UNSUPPORTED_CASE_CONTRACT | INCOMPLETE；不得当作空成功。 |
| 模式/环境 | REQUIRED_LIVE_NOT_EXECUTED、DEPENDENCY_UNAVAILABLE、ISOLATION_UNVERIFIED、CAPABILITY_EVIDENCE_MISSING、CLIENT_EVIDENCE_MISSING | INCOMPLETE。原能力合法 N/A 另列非失败说明。 |
| 评分/比较 | JUDGE_FAILED、INVALID_SCORE、CALIBRATION_MISSING、BASELINE_UNAPPROVED、COMPARISON_MISMATCH、SAMPLE_INSUFFICIENT、POLICY_PENDING | INCOMPLETE；不得凭坏评分断言候选质量失败。 |
| 分歧 | SCORER_DISAGREEMENT、UNCERTAIN_COMPARISON、REVIEW_REQUIRED | REVIEW，前提是执行与基础证据齐备。 |
| 停止/证据 | BUDGET_STOPPED、TIMEOUT、CANCELLED、WORKER_CRASH、REPORT_WRITE_FAILED、TRACE_MISSING、AGGREGATE_MISMATCH、CLEANUP_PENDING | INCOMPLETE；若已有失败保留 FAIL 优先。 |
| 采集目的 | MEASUREMENT_ONLY | INCOMPLETE，不能宣称质量资格通过。 |

未知代码不能静默忽略；按当前 schema 的 unknown_reason 视为 INCOMPLETE，保留安全诊断供修订政策。

## Metrics semantics

1. Coach 质量分母是具备有效量表/校准结果的独立案例；按纠错、等级、题型、薄弱项、批改、建议分组。意图判断准确率与固定工具顺序断言是不同指标。
2. RAG Recall@K＝实际 topK 中命中的 gold 语义证据数 / 该查询可用 gold 证据数；每查询先去重，聚合方法随 metricVersion 固定。gold 为空则该指标 N/A，不返回 1；空召回处理另用行为案例验证。引用有效性、声明支持、忠实度分开；声明可来自同引用但总体不双重计数。
3. 发音 WER 可大于 1，不截断美化；错误 precision/recall/F1、时间戳误差、人工分数一致性、匹配口音残差、逐音频重复最大差异分别记录原分母。P95 上传后终态与 Provider 内耗时不能互换。所有音频质量结论需音频/人工证据，缺失不得靠合成 annotation 补齐。
4. MCP 协议、参数有效性、资源读取、授权/确认、幂等、实际客户端模型工具选择是不同指标；没有模型的 Inspector 不计算工具选择准确率，也不能贡献到有模型客户端分母。
5. 空分母值为 null + missingReason；未知 Token/费用值为 null，knownSubtotal 单独显示，total 在任一必需计量未知时不可标为精确总账。
6. 重复值先在案例或预定义 cluster 内汇总；配对比较使用 matched case/cluster。不确定性记录 methodVersion、seed、iterations、confidenceLevel、lower/upper、independentN、minimumN 与 criterionSource。实际运行不更改参数。

## Evidence integrity and consumer obligations

verify 校验 strict schema、计划/实际集合、序号链、文件 hash、逐案计数、指标分母、阈值来源、required completeness 和 gate/exitCode 一致。校验失败不能沿用 report 声称的 PASS。哈希只发现完整性变更，可信执行来源由 control/CI 审查上下文保证。

来源数据已删除、审批撤销或基线失效时，旧报告保留历史结果，但 gateReuseEligibility=false，写明确原因。后续运行不能只读旧 passed 字段继续放行。消费者如 CI/Skill 必须检查自身候选/控制版本和范围匹配，不能把另一个候选的合法报告当当前结果。

report.md 至少包含：本次范围及四态结论、执行模式分布、计划/完成/跳过/异常、双方版本及可比限制、总体/分组指标及 N、失败/未完成/待复核案例、用量/费用及未知、复现方式、证据访问/到期限制。任何“通过”标题必须带 scopeClaim，不能省略只是 quick/check 的事实。

### 2026-09-15 当前可执行范围

新增 synthetic 零付费全量离线检查；根目录入口、只读历史比较、verify/recover 与本地 CI 汇总的实际用法见 [使用指南](../../../docs/ai-evaluation.md)，执行证据见 [验收记录](../evidence/2026-09-15-synthetic-completion.md)。inspect 操作成功不代表评测通过；recover 无需凭证配置，仅生成不可覆盖的恢复快照，不执行业务、资源清理或预算释放。其余 full/真实质量/治理能力仍以待实现/待验收记录为准。
