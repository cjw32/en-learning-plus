# CLI Contract v1

**Feature**: [spec.md](../spec.md)  
**Status**: 拟实现接口；以下新命令当前尚不存在。本文件只定义契约，不提供实现。

## Entry and common rules

统一入口：`pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts <command> [options]`，从仓库根目录执行。复用已声明的执行器，不要求增加 package script 或全局 CLI。

使用 Node 严格参数解析；未知命令/选项、缺值、重复的单值选项、无效枚举/范围、不存在的 ID/标签、零筛选、重复案例/坏文件均报可定位错误。动态路径和 Git ref 用参数数组传给子进程，禁止 shell 拼接。候选路径只读，不创建分支/切换版本/拉取远程。所有引用均经 realpath 与允许根目录校验；禁止加载用户提供的执行脚本、评估器代码路径或任意业务 Tool。

凭证仅通过受控环境引用解析，不接受 `--api-key`、明文连接串或在配置文件内嵌秘密。stdout 是简明安全摘要及最后一行机器 summary，诊断写清洗后的 stderr；报告不抓取原始环境变量。

## Commands

| Command | 输入 | 行为/写入边界 |
| --- | --- | --- |
| inspect | 与 run 相同的选择/配置选项 | 解析身份、范围、案例、模式、能力、授权、预算、baseline 可比性及预检；只读探测专用资源，写 preflight 报告，不执行模型或业务写入。预检通过不是评测通过。 |
| run | 以下运行选项 | 冻结 scope、执行、评分、归并、写报告及已授权测试资源清理；普通运行不改源案例/规则/基线。 |
| verify | `--run-dir PATH`，可选 `--control-root PATH` | 校验 Schema、hash、计数、逐案汇总与门禁，返回原有效门禁状态；不触发外部调用。旧报告缺必要证据不能升级为 PASS。 |
| recover | `--run-dir PATH --config PATH` | 读取崩溃 journal，核对专用资源终态并生成关联恢复记录/报告；不自动重跑或释放受理不明费用，原轮保持未完成事实。 |
| attach-client-evidence | `--run-dir PATH --evidence PATH` | 校验当轮等待 session 的 challenge、候选/案例/客户端/时间和 Trace/转录绑定，将证据安全入队给协调器；重复相同 hash 幂等，冲突拒绝。不代表写入确认或质量通过。 |
| cleanup | `--run-dir PATH --config PATH` | 对账并清理由本轮 lease 登记的测试资源；拒绝任意资源标识、生产目标及越过 lease 权限的删除。原质量结论不被清理成功改写。 |
| purge | `--artifact-root PATH --config PATH --policy PATH` | 作为明确治理任务/已授权期限调度，仅删除到期或已撤权且位于清单中的副本，留下最小删除证据；不重建已删除的样本。 |

不提供 `approve-baseline`、`update-threshold`、`auto-fix`、`ignore-failure` 等选项。基线批准、数据集更新、量表修改用对应明确维护任务与审查记录处理。

## run / inspect options

| Option | 类型/默认 | 语义 |
| --- | --- | --- |
| `--modules` | comma list；默认 all | coach/rag/pronunciation/mcp/all；all 不与其它项混用。 |
| `--profile` | quick/full；默认 quick | quick 不付费；full 包括所选目的的完整必需项，不获得隐式费用/资源授权。 |
| `--mode` | 可重复 deterministic/mock/replay/live；默认由 profile 和可信范围政策确定 | 显式筛选执行模式；quick 不允许 live。qualification 缺必需模式仍 INCOMPLETE，不能以筛选移除门禁要求。 |
| `--purpose` | check/qualification/measurement；默认 check | check 可局部检查；qualification 要完整必需证据；measurement 仅采集未批准候选测量，不宣称资格通过。 |
| `--case` | 可重复 stable ID | 同选项 OR，与其它类别筛选 AND。 |
| `--tag` / `--risk` | 可重复；risk=low/medium/high/critical | 精确匹配，未知值报错。 |
| `--changed-since` | 一个本地可解析 Git ref | 使用 merge-base 与当前候选的提交差异，加 staged/unstaged/纳入的 untracked 变更，保守扩展影响；不存在 ref 报错，不 fetch。 |
| `--candidate` | checkout path；默认当前仓库 | 必须是目标仓库可验证 checkout，读取快照。 |
| `--candidate-config` | 非敏感版本配置引用，可选 | 仅从可信控制目录解析批准的模型/Prompt/检索/Provider 配置；不允许任意脚本。 |
| `--baseline` | 已登记 baselineId 或批准 bundle 路径，可选 | 校验批准与版本匹配；仅可复用的历史基线。不能与 baseline-candidate 同时使用。 |
| `--baseline-candidate` | 第二 checkout path，可选 | 同轮重测基线；批准身份及比较政策仍来自可信注册，不因重跑自动批准。 |
| `--baseline-config` | 配置引用，可选 | 仅配 baseline-candidate；对应明确基线版本。 |
| `--intentional-difference` | 可重复枚举 | prompt/model/provider/chunking/embedding/index/retrieval-config/tool-schema；必须与实测差异对应，不豁免 dataset/gold/rubric 变化。 |
| `--dataset` | 目录 manifest 路径；默认控制目录中的统一目录 | 按 module/legacyRef 复用既有样本；缺 metadata 必须报告，不能默认全部授权。 |
| `--control-root` | 可信控制 checkout；本地默认当前仓库 | CI 不从候选获取可信阈值/范围/审批；此项不能让不可信代码自获特权。 |
| `--config` | 非敏感运行配置路径 | 包含 policy/approval/env profile 引用、输出/并发/预算等；禁止内嵌密钥。live/full 隔离及付费前提必须来自有效配置。 |
| `--output` | 可写运行根目录，必填 | 新建独立 runId 子目录，拒绝覆盖现有 run。不得位于 baseline/数据集/源码目录内。 |
| `--concurrency` | 正整数；quick 默认 1 | 全局任务并发，仍遵守原业务每主体限制；预算预留统一协调。 |
| `--case-timeout-ms` | 正整数；quick 默认 120000 | 单项全部步骤和重试的期限，原 Provider 更短期限仍生效。 |
| `--run-timeout-ms` | 正整数；quick 默认 900000 | 整轮期限，含人工客户端等待；full 必须由运行配置明确给出。 |
| `--repeat` | 正整数；quick 默认 1 | 采样重复数；不得用重跑成功替代先前失败或独立样本数。 |
| `--retry-limit` | 非负整数；默认 0 | 只有原业务规则允许的安全重试才执行；不自动重试写入不明状态。 |
| `--budget-micros` | 非负安全整数；quick 默认 0 | 全轮总预算含两侧与裁判。live 必须为正且不高于批准授权额度；不是本轮可随意提高的预算。 |
| `--currency` / `--max-tokens` | 币种 / 非负整数 | live 必需适用字段；语音依计时额度另从 config 获得上界。无 Token 指标时不适用，不造零。 |

配置优先级：显式 CLI > 指定非敏感 config > quick 技术默认值；任何上限仍受可信批准政策限制。上述 quick 超时/并发是本地防失控设置，不是新增质量阈值；full 不沿用猜测的费用、统计或环境批准。stopGraceMs 由配置给出，quick 默认 5000ms，宽限到期不能宣称远端已撤销。

quick 指定付费模式或正费用调用计划为配置冲突；需明确使用 full 及批准运行配置。qualification + quick 仍计算 full required coverage，缺失真实项返回 INCOMPLETE，不静默变成 check。

## Exit and completion contract

run / verify 的 gate 退出：0 PASS；1 FAIL；2 INCOMPLETE（配置/依赖/报告缺失/预算停止/取消/恢复未齐亦属此类）；3 REVIEW。信号被正常处理后仍写报告并返回相应状态，若已有证实失败则 1 优先；SIGKILL/主机崩溃没有正常退出码，调用者记录缺有效报告并使用 recover，不能推定 pass。

measurement 若只完成观测收集但未具备质量政策/校准/基线资格，executionCompleteness 可 complete，但 gate=INCOMPLETE、exit=2、reason=MEASUREMENT_ONLY，摘要必须为“测量采集完成，未完成质量验收”。已知违规仍 FAIL。该行为允许建立待批准基线而不制造通过。

inspect / attach / cleanup / purge 的 0 仅表示相应操作成功，机器字段 `operationStatus=OK`、`evaluationGate=null`；不得生成“评测通过”。操作校验错误为 2。inspect 明确缺必需前提时 2，不能把 inspect 成功作为 CI 评测成功。recover 产生关联恢复报告，原缺失执行仍 exit=2，发现违规可为 1。

## Client session evidence

run 在启动真实客户端项前输出受限会话说明，至少含 sessionId、challenge、deadline、caseId、任务文本、客户端/模型版本要求及测试入口安全别名。操作者在实际已授权客户端完成合成任务；调用原确认页处理提交，不从 attach 绕过确认。

证据输入必须含 schemaVersion、session/run/item IDs、challenge、候选和控制 hash、产品/OS/模型/协议/能力、操作人/时间、脱敏配置/转录 hash、服务端 Trace/request IDs、工具选择及参数观测、已知/未知费用和上界履行证据。字段 schema/hash 校验后还要核对服务端独立记录；缺配对、过期、篡改、其它产品代跑均拒绝/未完成。

会话只等待 runTimeout 内的操作，超过期限保留 not_run/error。结束后的补交必须发起有 parentRunId 的新运行并获得对应新 challenge；原轮证据不覆盖。客户端无法约束模型费用/Token/超时或获知必要用量时，不自动开展真实任务。
