# Data Model: Unified AI Evaluation

**Feature**: [spec.md](./spec.md)  
**Status**: 设计契约；本轮不生成数据库迁移或运行时 Schema 实现。

## Storage and ownership

评测记录是版本化文件与对象引用，不增加 Prisma 模型。业务写入仍使用现有 LearningAttempt、Coach/Knowledge/Pronunciation/MCP 实体；测试资源清单只记录该轮创建/使用的隔离资源。以下字段名构成待实现的严格校验契约；未知字段默认拒绝，扩展需升级 schemaVersion。

所有 ID 为非敏感稳定标识；时间为 UTC ISO-8601；内容哈希为 SHA-256。费用使用整数 micros + 币种，不用浮点金额。null 必须伴随 unavailableReason，不与 0 混用。审批和资源授权不能仅凭数据对象自称有效，必须核对可信控制上下文。

## E1. EvaluationCase and DatasetManifest

| 字段 | 类型/约束 | 作用 |
| --- | --- | --- |
| caseId / caseVersion | 非空字符串，全目录唯一 / 不可变版本 | 原 ID 保留；全局身份可用 module + 原 ID 命名。 |
| module | coach / rag / pronunciation / mcp | 仅四业务模块。 |
| legacyRef | 原相对路径、原 ID、原 Schema、原内容 hash，可空 | 不改原数据格式即可追溯复用；无法证明字段不能猜补。 |
| tags / risk | 去重标签；low / medium / high / critical | 包含场景、风险和故障类别；critical 包含零容忍安全场景。 |
| requirements | `{spec, ids[]}` 非空数组 | 关联当前 005 及来源 001–004 的 FR/SC。 |
| inputRef / contextRef / expectedRef | 内容引用 + hash | 与 gold/rubric 分离；实际执行不能将 expected 当作 actual。 |
| expectedSideEffects | 允许资源、允许操作、预期增量或不变条件 | 支持事务、确认及幂等实测。 |
| evaluators | evaluatorId/version/type、rubricRef、required、calibrationRef | type 为 rule/human/model；每维度单独指定。 |
| provenance | synthetic/hand_authored/authorized；来源、使用依据、授权引用、允许用途、到期/撤权/删除规则 | 不把真实音频改名为 synthetic。 |
| split / exposure | development / validation；groupId、近重复关联、暴露时间及事件 | 同源案例不跨 split；被用于调优后不能继续作为独立验证。 |
| groups | level、exerciseType、scenario、accentGroup、clientGroup 等可空 | 未知与不适用单独原因，不从音频推断敏感属性。 |
| capabilityRequirements | 需要的业务/Provider/客户端能力、允许不适用条件与来源验收 | 防止把缺环境伪装成不适用。 |
| datasetVersion | 非空版本，与 manifest 一致 | 任何实质样本/金标/授权变化形成新版本。 |

DatasetManifest 包含 datasetId/version、目录完整 hash、caseRefs、splitPolicyVersion、exposureRegistryHash、expectedCoverage、授权治理引用和 frozenAt。重复 ID、坏引用、错误 Schema 或目录缺项使预检失败。新增线上问题以独立任务经人工确认发布新 manifest；运行器不自动入集。

RAG expectedRef 记录 goldEvidenceId、sourceId/sourceVersion、语义证据片段及允许/禁止来源；两侧各自有 gold→actual chunk 映射与 mappingVersion。发音 expectedRef 记录音频内容指纹及受控引用、目标规范化、人工逐词/时间戳/维度分数、双人复核或仲裁版本；没有对应音频/金标的合成 annotation 只能测试评估器。

## E2. RunRequest, ScopeManifest and TrustedControl

RunRequest 字段：schemaVersion=`ai-eval-request.v1`、purpose、profile、modules、modes、filters、candidate、baseline（可空）、intentionalDifferences、datasetRef、controlRef、configRef、outputRoot、limits、parentRunId（可空）。CLI 与 Skill 输入都先转成该对象。

- purpose：check（限定检查）、qualification（选定模块正式验收）、measurement（采集未批准版本观测）。measurement 不替代 qualification，也不因无基线就造一个批准记录。
- profile：quick / full。profile 确定默认执行方式，purpose 决定需要证明的事实；full 不等于自动获得付费授权。
- filters：caseIds/tags/risks，以及变更基准 ref。不同类别 AND、同一类别 OR；未知值报错。变更分析无法映射则扩大到全部可能受影响模块，并在 scope 记录原因。
- limits：concurrency、caseTimeoutMs、runTimeoutMs、repeatCount、retryLimit、stopGraceMs、budgetMicros、currency、maxTokens。均为有限数；费用/Token 上界由批准价格和调用模型共同验证。
- TrustedControl：控制代码 commit/hash、目录/规则/评估器/影响映射 hash、可信 baseline/approval 注册、trust=local/maintainer/ci、主体/时间。候选文件不作为可信批准来源。
- ScopeManifest：requested、expanded、selectedItems、requiredItems、requiredGroups、requiredModes、excludedCases、notApplicable、missingRequirements、policyRef、selectionReason。预检后冻结，运行中不能把 required 改 optional。

qualification 必需集先由政策计算，再应用筛选并比较实际覆盖；不能用用户过滤结果重定义“全部必需”。check 允许限定范围，但声明边界与未覆盖要求必须显示。配置格式合法却无法覆盖资格要求的运行仍保留缺口并返回 INCOMPLETE。

## E3. VersionSnapshot and BaselineRegistration

VersionSnapshot 对每一 side 固定：

- code：commit、branchLabel、dirty、trackedDiffHash、includedUntrackedSourceHash、lockfileHash、candidateTreeHash；记录明确的输入文件清单与排除敏感项，不能写原始差异到报告。
- evaluation：controlCommit、adapterVersion、dataset/gold/split/exposure hash、evaluator/rubric/calibration hash、汇总方法版本。
- runtime：Node/pnpm/OS/arch、worker组合版本、并发、超时、重复数、seed、缓存 warm/cold/disabled 与隔离策略、环境指纹。
- ai：Provider、model name/requested version/returned version、版本可得性和供应方证据、采样配置、Prompt identity/hash、工具输入/输出 Schema hash。
- rag：source rights/content snapshot、chunking、Embedding name/version/dimension、index、retrieval config、gold mapping version。
- pronunciation：音频集/人工标签版本、Provider capability、adapter/rule/normalization/alignment/price/budget version。
- mcp：client product/version/OS、protocol/capabilities、auth mode、model identity（Inspector 等无模型时 N/A，需原因）。

BaselineRegistration：baselineId、runId、reportHash、snapshotRef、dataset/evaluator compatibility、approvalRef、approvedBy/At、reason、supersedes（可空）、status=`pending|approved|revoked|evidence_deleted`。记录只追加；撤权不删除审批事实中的非敏感信息。普通执行不得变更登记。

ComparisonRecord：双方身份、intentionalDifferences、matchedConditions、mismatches、comparability=`comparable|incomparable|review_required`、pairedCaseIds、缺配对项与原因。数据/规则变化必须重测对应 baseline；业务模型改变本身仅在声明的有意变量集合中允许。

## E4. Run, ExecutionItem and Attempt

- Run：runId、createdAt/startedAt/endedAt、purpose、scopeHash、双方快照、limits、state、executionCompleteness、gateDecision、报告与 journal 引用。
- ExecutionItem 唯一键：runId + side + caseId + executionMode + clientCombination（可空）；预先冻结 required 标记及 expectedRepeatCount。
- Attempt：attemptId、itemId、repeatIndex、retryIndex、parentAttemptId、stepResults、startedAt/endedAt、terminalState、原因、断言/评分与 evidenceRefs。重复采样和网络重试是不同维度，不修改原 attempt。
- StepObservation：stage（auth/retrieval/model/tool/audio/judge/write 等）、actualMode、dependencyKind、input/output hash、实际观测引用、trace/request/callId、版本、usage、sideEffectEvidence、错误类别、期望故障注入标记。

executionMode 为 deterministic / mock / replay / live。混合案例由 steps 精确标记；顶层 declaredMode 仅表示请求意图，不自动为实际 live。规则评估器 type 与 executionMode 分开。

**Run 状态**：CREATED → PREFLIGHT → RUNNING → FINALIZING → FINISHED。任一活动态可进入 STOPPING → FINALIZING → FINISHED；预检失败也尽可能终结为有报告的 FINISHED。FINISHED 不代表 PASS，另看 gateDecision。

**ExecutionItem 终态**：passed / failed / review / skipped / error / not_run。未结束的内部状态 pending/running 在生成最终结果时必须转换为有原因的 error/not_run，不得省略。required 模式/评分器/重复不足会使 item 不能 passed。

- actual 业务错误/已证实安全或阈值失败 → failed。
- 不能执行、评分器崩溃/非法输出、必要证据缺失 → error；未派发 → not_run；显式环境跳过 → skipped。
- 有效未决主观争议 → review。
- 期望注入的服务故障得到正确拒绝，可以通过这个 fault-handling 检查；不得当作 live 可用性成功。
- 首次 failed 不被重试 success 替换；首次非预期执行异常即便重试取回结果也保留该轮缺证据事实。修复验证通过新 run 关联旧 run，不消除历史失败。

**计数**：每个 ExecutionItem 只入一个终态桶；计划数＝passed+failed+review+skipped+error+not_run；完成数＝passed+failed+review。attempts/repetitions 单列，不增加计划项或独立案例 N。汇总另报 uniqueCaseCount、每侧/每模块计数及 overlap 标签说明。

## E5. BudgetReservation and CallLedger

字段：reservationId、run/item/attempt/callId、purpose（candidate/baseline/embedding/judge）、Provider/priceVersion、currency、upperBoundMicros、token/audio upper bounds、state、observedUsage、estimatedCost、actualCost、acceptedAt、settledAt、uncertainReason。

状态：RESERVED → DISPATCHED → SETTLED；确认未受理可 RELEASED；受理不明/取消未确认为 UNCERTAIN，仍占额度。同一 callId 的重复预留/结算必须幂等；结算不得把未知费用换成 0。

每次预留必须在同一协调器的同步状态变更中检查：settled + active reservations + requested upperBound ≤ run budget；另执行原业务单次/用户/系统预算。跨 worker 并发均通过此处。重启恢复保留未知占用，不自动释放或重新发送。实际超出合同上界须记录预算异常并停止派发，不能声称预留机制能阻止供应商违规计费。

## E6. Evaluator, Calibration and ReviewDecision

EvaluatorDefinition：id/version、type、rubricVersion、适用维度、输入/输出 Schema hash、rule/prompt hash、expectedEvidenceKinds、人工校准要求。

JudgeResult：评分模型 Provider/name/可得 version、Prompt/hash、分项 score/anchors、reason、evidencePointers、usage、validity。所有分数必须 finite 且在量表范围；引用必须对应本次允许观测；未知字段或注入导致非法评分记 error。

CalibrationRecord：id/version、适用 evaluator/model/prompt/rubric、独立数据集/授权/金标指纹、标注流程/资格、逐案人工与模型分数、差异、适用场景与分组、批准条件、批准者/时间。Calibration 不得用当前候选自评分与自身对齐来构造。

ReviewDecision：reviewId、targetAttempt/metric、priorDecisionHash、reviewer、time、原始评分、证据、决议与理由、版本；只追加。复核改变的是有争议的评估解释，不能把已证实越权/重复写入直接改为通过；业务修复应新轮执行。没有更新量表/阈值的隐式副作用。

## E7. Metric, GatePolicy and Decision

Metric：metricId/version、module、group dimensions、side、mode、unit、direction、value（可空）、numerator（适用时）、denominator/effectiveN/independentN、excludedCountsByReason、repetitionSummary、calculationBasis、uncertainty、thresholdRef、comparisonDelta。

GatePolicy：id/version/hash、purpose/modules、required scenarios/modes/groups、zeroToleranceCodes、metrics[]、quality/latency/cost absolute bound 或允许 delta、minimum independentN、适用排除规则、统计方法/seed/iterations/confidence/decision rule、sourceSpecCriteria、approvalRef。缺阈值不默认零/无限，标 pending_measurement；最小样本要求不能由本轮成绩推算。

GateDecision：status=`PASS|FAIL|INCOMPLETE|REVIEW`、exitCode、scopeClaim、reasons[]、blockingItems、missingRequirements、reviewItems、policyHash、comparisonRef、executionCompleteness。按已证实失败优先、其次缺必需证据、再主观争议、最后通过；所有低优先级原因仍保留。

校准缺失或 minN/规则未批准 → INCOMPLETE；有效样本/政策齐备但统计区间/人工判断存在未决解释 → REVIEW；在批准判据下证实回退 → FAIL。不把一次随机波动称为确定退化。

## E8. Artifact, Evidence and Retention

ArtifactDescriptor：artifactId、runId、kind、relativePath/objectRef、contentHash、size、sensitivity=`synthetic_public|restricted_metadata|restricted_content|audio`、accessPolicyRef、retentionPolicyRef、expiresAt、sourceAuthorizationRefs、replicas[]、deletionState、deletedAt（可空）。

- 本地文件引用只允许 runRoot 内相对路径，拒绝路径穿越、符号链接逃逸和任意 URL 下载；音频以获准私有资产 ID 表示，不在报告公开可下载地址。
- 稳定复现用内容/版本指纹；删除后保留非敏感 tombstone + 原 hash 仅在 hash 不暴露可猜测私人内容的前提下保留，否则删除相关 hash。个人主体用按环境隔离的不可逆别名。
- RetentionPolicy：policyId/version、artifact kinds、roles、ttl、revocationDeadline、deleteMechanism、replicaScopes、approval。有效期限取来源和产物政策中更严格者；新增受限类别缺政策不得收集。
- 原模块约束继续有效；治理任务按明确授权执行 `purge`，TTL 执行主体与周期须在环境预检可核验。仅有 expiresAt 无实际删除机制不合格。

## E9. TestResourceLease and ClientEvidenceSession

TestResourceLease：runId、环境指纹/允许资源清单、专用凭证引用（不含值）、主体别名、db/schema/Redis prefix/MinIO prefix 的安全别名、createdResourceIds、expiresAt、cleanupMethod、cleanupState、reconciliationEvidence。

ClientEvidenceSession：sessionId、runId/itemId、challenge、candidateHash、client product/version/model/protocol、caseIds、operator、deadline、budgetReservation、serverTraceIds、redactedTranscriptRef、evidenceHashes、state=`pending|attached|verified|rejected|expired`。同一 session 不能用于其他候选/案例；验证通过只表示证据格式/绑定齐备，最终质量还需正常评分和门禁。人工确认写入必须走 MCP 原确认页和主体绑定；attach 不构成业务写入确认。

## Compatibility and recovery

旧样本/报告导入保留原 schema/version 与声明模式，缺字段记 provenance_missing 等原因，不追加虚构值。数据格式升级应提供显式、纯数据的版本转换说明和测试；执行器不运行用户提供的转换脚本。

事件记录带递增 sequence、prevEventHash、payloadHash 与 runId；校验用于发现截断/混入，不能防止拥有全部本地写权限的人重写记录。CI 可把报告 hash 与受信任 job/commit 关联，机器门禁只接受匹配控制版本的结果。FINISHED 后恢复/复核/迟到对账使用独立 append-only 关联记录及新报告修订，不覆盖原报告或伪装成原轮已及时完成。
