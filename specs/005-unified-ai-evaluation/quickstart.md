# Quickstart Validation Guide

**Feature**: [spec.md](./spec.md)  
**Contracts**: [CLI](./contracts/cli.md)、[Report](./contracts/report.md)、[CI](./contracts/ci.md)

当前已交付离线入口原型、四模块目录和受控回归测试，完成 T001–T029；整体规格尚未实现。V-001/V-002 的基础入口与参照样本已有执行证据，见 [实现检查点](evidence/us1-quick-run.md) 和 [PR 前审查](evidence/code-review.md)。下文的双版本比较、裁判、真实资源、恢复、客户端证据和数据治理步骤仍是后续验收目标，不能当作当前可用能力。

## Prerequisites

- 使用 en-learning-plus 的已审核 checkout 和已声明依赖；确认现有 Node/pnpm、锁文件。本文不包含新增依赖、安装系统工具、生产配置、推送或部署步骤。
- 离线 quick 只使用合成资产，不加载项目 `.env`，不使用真实模型/语音。与业务资源有关的完整测试需经批准的隔离实例和最小凭证，先 inspect 验证，不能直接把生产 DATABASE_URL 交给测试。
- 真实运行准备：固定的候选与基线、授权数据/人工音频、批准价格和预算、独立验证/校准、可信政策、实际客户端矩阵、可验证测试资源与清理/保存政策。任何缺项应看到 INCOMPLETE，而非修改门禁使其通过。
- 所有命令在仓库根目录执行，输出放到单独目录；示例临时变量用于当前终端，不包含秘密。配置路径由维护者提供，只含引用与非敏感设置。

## V-001 — 统一入口与严格筛选

当前可运行以下无付费检查（输出必须位于代码目录之外）：

```bash
EVAL_OUTPUT_ROOT=$(mktemp -d /private/tmp/en-ai-evaluation.XXXXXX)
pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts inspect --modules all --profile quick --output "$EVAL_OUTPUT_ROOT"
pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts run --modules all --profile quick --purpose check --output "$EVAL_OUTPUT_ROOT"
```

Linux 可用 `/tmp` 代替 `/private/tmp`。inspect 返回预检状态而非评测结论；quick 输出四模块的真实命中集合、actual modes、skip/缺证据及限定 scope。全部必需快速检查齐备且正确才能 exit 0；真实质量资格仍不能由该结果推断。

分别把 modules 改成 coach/rag/pronunciation/mcp 并复核命中；使用目录中的有效 case、tag、risk 及 changed-since 验证 AND/OR 与变更扩展。再执行：

```bash
pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts run --modules coach --case definitely-unknown-case --profile quick --output "$EVAL_OUTPUT_ROOT"
```

预期 exit 2、INVALID_FILTER 或未知案例诊断、无 Provider 调用；未知标签、零命中、重复 ID、required 文件缺失也都不能返回 0。qualification + quick 应保留缺失真实必需项并 exit 2。

## V-002 — 已知正确、错误及模式可信性

当前 assurance fixtures 包含 `ue-coach-known-good`、`ue-coach-schema-regression`、`ue-rag-fabricated-citation`、`ue-mcp-wrong-tool`；它们通过测试组合向实际业务校验边界注入受控输入/响应，不能仅往 report 填 failed=true。

```bash
pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts run --modules coach --case ue-coach-known-good --profile quick --output "$EVAL_OUTPUT_ROOT"
pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts run --modules coach --case ue-coach-schema-regression --profile quick --output "$EVAL_OUTPUT_ROOT"
```

前者在完整快速前提下 PASS/0；后者的故意违规候选 FAIL/1，报告指出实际结构错误。虚假引用、选错工具按实际观测定位。可运行当前自测套件验证上述边界、模式、快照与报告完整性；完整 judge/Prompt 注入验收仍属于后续任务：

```bash
pnpm --filter @en/server exec jest --runInBand apps/ai/test/evals/unified/tests
```

负向评测运行返回非零是预期现象，自测套件需要断言对应状态，因此套件验证正确时自身可通过。报告须区分“业务受控失败已被识别”与“被评测业务已通过”。

## V-003 — 权限、幂等、隔离与清理

维护者提供非敏感配置 `$EVAL_ISOLATED_CONFIG`，其中只引用专用测试身份/资源。先 inspect，再在 full 的安全专项范围执行既有四模块的实际 auth/ownership/transaction 场景。保留至少两个隔离测试用户、重复提交/同键异内容、未确认写入、取消竞态和事务失败前后的数据库事实。

预期：正常授权只写一次；攻击被拒绝不写入；测试故意绕过保护造成真实违规时 gate FAIL，即使模型评分满分。既有数据库 suite 被跳过时是未完成，不能仅凭 Schema 文本存在证明事务正确。结束/中断后 cleanup 只清理由该 run 登记的资源，残留使资格未完成；生产资源连接被预检拒绝。

## V-004 — 双版本比较和分组波动

在相同非敏感候选 checkout 和可信 control 下，用已批准 `$EVAL_BASELINE_BUNDLE` 与 `$EVAL_RUN_CONFIG` 执行：

```bash
pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts inspect --modules coach --profile full --purpose qualification --baseline "$EVAL_BASELINE_BUNDLE" --intentional-difference prompt --config "$EVAL_RUN_CONFIG" --output "$EVAL_OUTPUT_ROOT"
```

该 inspect 不调用模型。后续已明确授权该费用/环境的执行任务才把 inspect 换成 run。需要重测基线时用 baseline-candidate + baseline-config，不能直接把不匹配历史数据重新标成兼容。

预期：Prompt 改动可作为 intentional difference；dataset/gold/rubric 改动不得直接比较。用受控分组回退案例验证“总体改善、某个必需组回退”仍 FAIL。用重复有波动的数据验证逐次结果保留、独立 N 不变；minN 缺失/不足 INCOMPLETE，有效但不确定比较 REVIEW。只允许与批准政策比较，不在命令中临时改阈值。

## V-005 — 四模块真实评测

仅在另行明确授权的执行任务中运行 full；本 Plan 不授权付费调用。

| 模块 | 场景与观察 | 不满足条件的预期 |
| --- | --- | --- |
| Coach | 同题不同等级/薄弱项、纠错、四种练习、批改/建议，实际模型 Prompt/usage、工具步骤与最终结果；主观评分对应人工校准。 | 模型或校准缺失不能被 Mock 替代，INCOMPLETE。 |
| RAG | 同问题与授权语料的真实 Embedding/检索，改变 chunking/Embedding/retrieval 时保留双方 gold 语义映射；空召回/冲突/私有/注入。 | 不一致金标、来源权利或真实索引缺失为 INCOMPLETE，伪造引用为 FAIL。 |
| 发音 | 同一授权音频与人工标注，覆盖转写/误漏读/逐词/支持维度/噪声/静音/口音/重复；实际上传后终态与费用。 | 无音频/人工金标/获准工具链/存储/Provider 则 INCOMPLETE；不把 WER 或 3 条描述当发音质量。 |
| MCP | 四真实客户端逐项执行 challenge，实际工具选择与调用参数、权限/确认/幂等、双协议支持。 | SDK harness 不算产品客户端；费用不可约束/未执行客户端不能通过。 |

MCP 同轮人工步骤在 run 输出会话说明后，由操作者完成已授权客户端操作并提交：

```bash
pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts attach-client-evidence --run-dir "$EVAL_RUN_DIR" --evidence "$EVAL_CLIENT_EVIDENCE"
```

预期客户端/模型/挑战/候选/服务端 Trace 均一致。复制他人/另一客户端/上一轮证据拒绝；Inspector 无模型仅工具选择 N/A。会话超时保留未完成，attach 操作成功不等于评测通过。

## V-006 — 预算、取消、异常与恢复

用 assurance fixture 的受控 Provider（不收费）验证两个并发调用竞争最后额度、评分模型预算、重试和基线费用；预算不足时调用前阻止，调用次数不能超过预留允许量。quick 本身禁止付费，预算逻辑的测试使用模拟成本，不把它作为实际账单。

运行慢响应参照场景，在本地取消；分别注入 Provider 受理不明、worker 退出、report 写失败和 journal 尾记录损坏。预期整轮保留部分结果、剩余 item 原因、在途保留额度，停止后无新增调用；已提交测试写入不能伪称撤销。

```bash
pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts recover --run-dir "$EVAL_RUN_DIR" --config "$EVAL_ISOLATED_CONFIG"
pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts cleanup --run-dir "$EVAL_RUN_DIR" --config "$EVAL_ISOLATED_CONFIG"
```

recover 不重发不明请求、不洗掉首次失败；cleanup 成功只证明清理完成。首次故意失败再重跑成功，两个 run 和所有 attempts 仍可查。测试不通过杀死用户生产服务来模拟故障。

## V-007 — 报告、数据治理和 Skill 一致性

```bash
pnpm --filter @en/server exec tsx apps/ai/test/evals/unified/cli.ts verify --run-dir "$EVAL_RUN_DIR"
```

校验通过的报告仍返回其真实 gate 退出码。手工修改一个计数、替换其它候选 report、删必需结果或篡改文件 hash 后，verify 不得沿用 PASS。缺 Token/费用写 unknown；估算附价格版本，不显示为精确账单。

用合成数据演练新增明确任务→人工确认→新目录版本→基线失配提示。未授权音频拒绝准入，案例暴露事件使其不再充当未见验证集。用模拟时钟和专用目录验证到期/撤权 purge、角色访问、副本删除和 baseline evidence_deleted；不得从生产抓数据验证这些路径。

后续创建 run-ai-evaluation Skill 后，分别经 Skill 与直接 CLI 执行同一 quick 配置。比较案例/模式/版本/指标/四态，Skill 必须引用实际 run/report/case/SDD IDs，不能改代码/政策或把旧报告当本轮。无报告时不得声称执行成功。

## V-008 — CI 和原有业务回归

按照 [CI contract](./contracts/ci.md) 在无秘密环境分别注入 PASS/FAIL/INCOMPLETE/REVIEW，检查机器状态/退出码、缺 job/缺报告、上传失败和不可信 PR；快速通过不得覆盖资格未执行。真实 CI 仅在独立环境配置获准后验证。

对现有 Coach/RAG/发音/MCP、登录/词典/课程/单词/作答/掌握度/复习及普通 AI 路径执行目录中登记的适用回归；复用原 Jest/E2E/Playwright 入口，不要求本轮执行。相同隔离版本下对比接入前后；历史跳过/未完成浏览器矩阵继续单列，不计作新功能验证完成。

## Evidence to keep

每个验证保留 runId、真实命令及退出状态、安全环境/版本快照、计划/实际项、报告 hash、失败证据、预算/清理和验收关联。上述示例中的 `$EVAL_RUN_DIR` 等变量由实际输出/维护者配置赋值，不能从文档示例猜造结果。本轮产物仅设计文档，暂无 V-001–V-008 执行结果。

### 2026-09-15 当前可执行范围

新增 synthetic 零付费全量离线检查；根目录入口、只读历史比较、verify/recover 与本地 CI 汇总的实际用法见 [使用指南](../../docs/ai-evaluation.md)，执行证据见 [验收记录](evidence/2026-09-15-synthetic-completion.md)。inspect 操作成功不代表评测通过；recover 无需凭证配置，仅生成不可覆盖的恢复快照，不执行业务、资源清理或预算释放。其余 full/真实质量/治理能力仍以待实现/待验收记录为准。
