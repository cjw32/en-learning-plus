# AI 评测运行指南

当前可用的是完整合成检查流程：Coach、RAG、发音评测和 MCP 的业务规则、安全边界与失败路径。所有合成运行不使用真实服务凭证。结果通过表示所选检查通过，不代表真实模型达到上线质量。

## 日常运行

在项目根目录运行四模块的全部离线业务测试：

```sh
pnpm eval:ai:synthetic --concurrency 4
```

若还需要检查全部既有案例的数据格式：

```sh
pnpm eval:ai run --profile synthetic --concurrency 4
```

结果会显示 `runDir`。打开该目录中的 `report.md` 阅读报告；`report.json` 是同源机器报告。默认结果目录在系统临时目录的 `en-ai-evaluation` 中，单次目录权限 0700，文件 0600，不写入源码。系统可能清理临时目录；需要长期留存时，用 `--output` 指向**已存在、仓库外的私有目录**。

支持按模块、案例、标签选择，例如：

```sh
pnpm eval:ai run --profile synthetic --modules coach,rag --tag business-regression --concurrency 2
```

- `quick`：较小的既有检查目录。
- `synthetic`：quick 加本轮新增的全量离线业务、安全测试。
- `full`：保留真实数据库/模型/人工校准等要求；当前未完成真实质量服务接线与前提，不会被合成通过结果替代。
- `qualification`：要求正式质量证据；即使 profile 为 synthetic，也会因缺少真实证据返回未完成。

## 读懂结果

| 结果 | 含义 | 直接 Node 入口退出码 |
| --- | --- | --- |
| PASS | 所选检查全部通过 | 0 |
| FAIL | 已证实存在失败；优先于缺测 | 1 |
| INCOMPLETE | 缺少结果、条件不满足、超时/取消或恢复尚未完成 | 2 |
| REVIEW | 有待复核的结果 | 3 |

报告分开列出数据格式有效率与业务检查通过率，按模块、模式和已有分组统计分母、缺测和独立测试组。重复运行不增加独立样本数。这些指标不是模型纠错准确率、学习效果或人工评分一致性。

## 复核、比较与恢复

将下面的 `/private/tmp/your-run` 替换成实际输出的运行目录。

```sh
pnpm eval:ai verify --run-dir /private/tmp/your-run
pnpm eval:ai run --profile synthetic --tag business-regression --baseline /private/tmp/your-run
pnpm eval:ai recover --run-dir /private/tmp/your-run
```

比较两次运行须使用相同案例范围。比较会检查数据、金标引用、评分器、运行条件、模式和重复次数；不兼容时为未完成，不能静默丢掉缺失案例。历史报告只作为开发对照，不会自动成为批准基线，也不会被覆盖。

`verify` 不调用业务服务；它重算统计、对照逐项观测、尝试历史和冻结计划，核对 JSON/Markdown 与文件 hash。报告仅有本地完整性保证，不能替代外部可信签名或 CI 身份。

`recover` 在旁边创建独立恢复快照，保留原报告与已核实结果；未完成项仍需新开一轮。它不自动恢复模型调用、释放费用预留、清理数据库或宣称远端操作已回滚。恢复快照本身不会升级为 PASS。

可用 `--repeat 2` 保留重复执行，`--retry-limit 1` 对离线执行故障进行有限重试。失败断言不自动重试；先前错误不会因后续成功而隐藏。`--case-timeout-ms` 和 `--run-timeout-ms` 控制期限，停止后不再派发新工作。

## CI 使用范围

可将上述无凭证命令接入已有可信 CI；若需要精确保留四态退出码，直接使用：

```sh
node server/tools/run-ai-evaluation.cjs run --profile synthetic --tag business-regression
```

独立汇总入口为 `summarize --expected <JSON文件>`，其 JSON 数组每项包含 `checkId/runDir/candidateTreeHash/controlHash/scopeClaim`。期望清单须由可信调用方提供。缺少报告、版本/范围不匹配或校验失败不能通过；已证实失败不能被另一项缺测覆盖。

本轮没有配置远程 GitHub 工作流或分支保护，不能声称远程合并已被阻止。

## 后续真实质量评测

仍待实现/验收：完整真实 Provider worker、配置档案和逐调用费用接线；人工/模型裁判校准、成对统计和批准基线；真实音频与实际 MCP 客户端矩阵；受限资料的授权、保留和删除治理。不能只填密钥就宣称完整质量验收完成。

独立人工样本、音频标注、实际客户端和费用预算均未在本轮提供。当前保留 `POLICY_PENDING/CALIBRATION_MISSING/ISOLATION_UNVERIFIED/BASELINE_UNAPPROVED/REQUIRED_LIVE_NOT_EXECUTED`，不伪造金标、评分、实际费用或批准。
