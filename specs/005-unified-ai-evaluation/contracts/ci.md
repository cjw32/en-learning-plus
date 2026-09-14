# CI Integration Contract v1

**Feature**: [spec.md](../spec.md)  
**CLI/result**: [cli.md](./cli.md)、[report.md](./report.md)  
**Status**: 后续 GitHub Actions 行为设计；本轮不创建工作流、不设置 secrets/environment/分支保护。

## Triggers and trust

拟在 `.github/workflows/ai-evaluation.yml` 交付以下检查，不引入第三方评测平台或应用依赖。

| 触发/检查名称 | 控制版本与候选 | 允许执行 | 凭证/结果边界 |
| --- | --- | --- | --- |
| pull_request / `ai-evaluation-quick` | 控制清单/政策来自可信目标版本；候选固定为该 PR 被检查提交及 tree hash | profile=quick、purpose=check；明确登记的确定性与 Mock/回放快速回归；变更映射决定额外覆盖 | 无 Provider key/私有样本/生产或共享测试资源凭证；最小只读仓库权限；记录未覆盖真实资格项。 |
| push 到维护者受控 ref / `ai-evaluation-quick` | 固定控制和候选提交 | 同上，不能因 push 自动启用付费 | 同样零付费；必要权限仍最小。 |
| 维护者 workflow_dispatch / `ai-evaluation-qualification` | 指定已经审查的精确候选提交、批准 baseline/control/policy/环境引用；不是任意 fork SHA | profile=full、purpose=qualification；运行所选模块全部必需项及同轮 MCP 人工会话 | 专用隔离服务/Provider 凭证和预算；原模块授权条件不齐则 INCOMPLETE。 |

不使用 pull_request_target 执行 PR 代码，不把 workflow_run 或 artifact 下载变成特权执行不可信脚本的跳板。控制代码变更本身需可信审查；候选 policy approved=true、伪造 result.json、不同候选合法报告都不能改变 required checks。

真实运行必须核对触发者权限、候选审查与允许 ref/commit、环境授权和预算，不能仅以“手动触发”认定安全。远程平台是否支持所需 environment 保护尚需独立核验；无可验证保护就保持真实入口关闭。审批不会自动安装依赖、创建生产资源或改变生产配置。

## Execution and aggregation

1. 固定 control/candidate/data/policy/baseline hashes；checkout 后不保留可写仓库凭证。构建和安装若需要，仅允许现有锁文件依赖；不可信候选的安装/构建不携带秘密，不能与特权 job 共享可写缓存/工作目录。
2. 由 control 计算 required manifest。模块拆分可在同一调度器执行，初版不跨 job 分散一个预算。并行 CI runs 使用不同资源 lease；真实运行对同一授权预算使用既有平台 concurrency/专用预算，避免多个各自“未超限”总计越过审批额度。
3. quick 调用统一入口，不使用 `--passWithNoTests`、忽略 skip 或 candidate 自报 required list。没有变更映射也至少执行已登记的基础自检，不制造零案例通过。
4. 每个执行命令记录真实退出码和 report 路径/hash；为了收集报告可以暂存非零状态，最终聚合必须按所存状态失败，禁止仅靠最后一个成功命令决定 job success。
5. 最终汇总步骤尽力在失败/取消后运行，核对 expected checks、report Schema/hash、候选/control 和 coverage。缺报告、执行 job skipped/cancelled 或超时至少记 INCOMPLETE；已证实 FAIL 优先。native CI 可以统一显示红色，但机器摘要保留 1/2/3 区别。
6. 工作流级强制取消/runner 丢失可能无法执行 finalizer；没有完整证据的 job 绝不视为通过，恢复后由 recover/新的资格运行补证，不能假装 always 步骤必然执行。

qualification 的检查范围和 quick 独立。quick=PASS 表示快速范围通过；若变更的正式必需项包含 live，则 readiness/qualification 仍为 INCOMPLETE，不能通过合并两个不同目的的 pass 掩盖未执行。

## Report retention and permissions

- JSON、Markdown 和安全失败摘要上传；artifact 名称包含 runId、candidate 短 hash、scope、schemaVersion，禁止写生产用户标识。
- 公开仓库可见产物只包含获准公开的合成数据/安全摘要；受限内容不上传到可能公开下载的 artifact。私有证据置于现有批准存储，CI 报告仅给安全 reference，按获授权维护者/审查者角色访问。
- retention-days 或私有存储 TTL 从已批准产物政策获取，不能默认选平台最大期限。平台无法满足更短保留/撤权删除时不上传该内容；运行前确认 purge 执行者能够删除所有登记副本。
- 增量关键事件先持久化；长运行按受控策略保存安全检查点，失败后仍尽可能保留部分证据。上传失败列为证据缺失，不能宣称资格通过。
- 使用平台自有/官方必要动作时固定已审核完整提交标识及最小权限；不将本设计视为新增第三方依赖授权。需要额外软件/Action/系统工具时作为明确配置变更提交审核，不自行安装。

## External configuration register

以下均为独立配置事项，本轮和普通评测命令不修改：

| 配置 | 生效证据 |
| --- | --- |
| required status checks / 分支保护 | 明确将所需 `ai-evaluation-quick` / qualification 结果绑定到对应候选与合并规则；没有该配置不能声称自动阻止远程合并。 |
| trusted ref / 触发者 / environment protection | 受控版本来源、维护者权限、批准候选集合与真实环境审批。 |
| dedicated test credentials / Provider budget | 专用低权凭证不能访问生产；运行总额度覆盖所有客户端/裁判。 |
| artifact ACL / retention / purge | 角色、可见性、TTL、撤权删除、所有副本索引与删除审计。 |
| approved runner and native tools | Node/pnpm、必要数据库/音频/客户端运行条件已存在且获准；没有工具不自动补装。 |

本地可用 CLI 和工作流设计不等于这些远程配置已存在。该边界保持 spec FR-043。
