# Plan Traceability and Design Review

**Feature**: [spec.md](./spec.md)  
**Plan**: [plan.md](./plan.md)  
**Validation guide**: [quickstart.md](./quickstart.md)  
**Status**: 设计覆盖检查；不是开发任务清单或实现/评测完成声明。

## Requirements → design → validation

A1–A7 为 plan 中架构章节；E1–E9 为 data-model 中实体；R-001–R-010 为 research 中决策；V-001–V-008 为 quickstart 中后续验证场景。

| Requirement range | 设计落点 | 验证与期望 |
| --- | --- | --- |
| FR-001–FR-004 | A1/A2/A4；E2/E4/E5；CLI options；R-001/R-003/R-006 | V-001/V-006：四模块同入口、精确筛选、检查目的与覆盖分离、有界预算/并发/重复。 |
| FR-005–FR-008 | A2；E1/E4；Report modes/reasonCodes；R-002/R-004/R-007 | V-002/V-005：执行真实业务并标替身模式，旧 expected 不作 actual；能力缺失不伪装 N/A。 |
| FR-009–FR-011 | A5/A7；E1；R-008/R-010 | V-001/V-007：稳定 ID/原文件/授权/风险/验收元数据完整；开发与验证划分、关键场景覆盖。 |
| FR-012–FR-015 | A2/A3/A5；E1/E3/E9；Report metrics；R-002/R-004/R-007 | V-002/V-004/V-005：Coach 意图/工具与等级、RAG 语义 gold、授权音频/口音、实际 MCP 客户端。 |
| FR-016–FR-020 | A2/A5；E6/E7；Report status；R-002/R-008 | V-002/V-003/V-005：实际权限和事务，评分器注入/非法输出、人工校准及不可覆盖的复核记录。 |
| FR-021–FR-023 | A1/A5；E3；CLI baseline；R-005 | V-004/V-007：候选/基线代码与运行指纹，对有意版本差异和数据/评分不兼容分别处理。 |
| FR-024–FR-027 | A5；E1/E3/E7；Report metrics；R-005/R-008 | V-004/V-007：总体/分组、分母、独立 N、所有重复、统计不确定性和普通运行基线不变。 |
| FR-028–FR-032 | A6；E4/E7；CLI exit / Report invariants | V-001/V-002/V-008：FAIL>INCOMPLETE>REVIEW>PASS；安全失败不能平均掉；漏测/故障/非法评分不通过。 |
| FR-033–FR-034 | A4；E4/E5；CLI recover；R-006 | V-006：在途预留、裁判开销、取消/超时/崩溃的部分结果和首次失败保留。 |
| FR-035–FR-039 | A4/A6；E4/E7/E8；Report contract | V-006/V-007：JSON/Markdown 同源、逐项对账、真实 Trace、费用 unknown/estimate 与复现条件。 |
| FR-040–FR-043 | A1/A6；E2；CI contract；R-009 | V-008：可信控制、无秘密 PR、四态机器结果、缺 job/报告不能通过、远程配置边界。 |
| FR-044–FR-045 | A7；CLI/Report consumer rules | V-007：后续 Skill 与直接调用一致，引用实际报告并关联 SDD，不自动改源码/规则/基线。 |
| FR-046–FR-049 | A2/A7；E1/E8/E9；CLI cleanup/purge；R-003/R-010 | V-003/V-007：合成优先、授权/脱敏/人工入集、隔离资源、角色访问和副本删除。 |
| FR-050–FR-052 | A2/A4/A6；E4/E7/E9；Report consumer rules | V-002/V-003/V-006/V-007/V-008：已知好坏业务参照、实际越权/写入事实、预算竞态和原有业务回归。 |

## Success criteria → observable evidence

| Criterion | 验证场景 | 需保留证据 |
| --- | --- | --- |
| SC-001 | V-001 | 四模块及 all 的请求、scope、执行清单、模式与结果。 |
| SC-002 | V-001/V-002/V-005 | 旧案例 ID/源码/历史报告映射、缺口与新增覆盖事实；仅设计盘点不算已复用实现。 |
| SC-003 | V-004/V-007 | 双方快照、baseline 批准、intentionalDifferences、失配案例及报告 hash。 |
| SC-004 | V-002/V-005 | 每 step actualMode、依赖替身/实际 Provider 记录及伪造 live 的拒绝结果。 |
| SC-005 | V-001/V-002/V-008 | 缺凭证、skip、评分故障、空集合/错误过滤的非通过状态和原因。 |
| SC-006 | V-002 | 故意坏候选在 Schema/选工具/引用/评分器攻击边界的可追溯检测。 |
| SC-007 | V-003 | 权限/确认/跨用户与重复事务的实际请求、前后资源事实和阻断门禁。 |
| SC-008 | V-004/V-006/V-007 | 政策/基线/量表运行前后 hash、原始失败及后续尝试关联。 |
| SC-009 | V-004/V-007 | 按逐案重算的总体/分组值、分母、缺少样本与重叠标签处理。 |
| SC-010 | V-004 | 重复明细、cluster/independent N、固定统计参数和 uncertainty；微小波动不误判。 |
| SC-011 | V-006 | 全轮 reservation/调用账本、停止后计数、journal、恢复与 cleanup 对账。 |
| SC-012 | V-003/V-007 | 隔离环境/资源指纹、测试主体隔离、数据授权及零生产访问/写入事实。 |
| SC-013 | V-007 | 后续 Skill 实际调用与响应，引用的 run/report/case/SDD IDs。 |
| SC-014 | V-001/V-007 | Skill 和直接 CLI 的同配置确定性比较及真实调用条件复现说明。 |
| SC-015 | V-008 | 四态退出与 CI summary、缺报告/job 行为、不可信 PR 秘密隔离。 |
| SC-016 | V-008 | 接入前后同版本隔离业务回归结果及历史跳过/未完成清单。 |
| SC-017 | V-005/V-007 | 授权音频、人工金标/校准、模型分项理由、仲裁记录与缺证据状态。 |
| SC-018 | V-007 | 版本/暴露/撤权事件、角色访问、过期与副本删除、基线复现限制。 |

## Plan review findings and resolutions

| Finding | Resolution |
| --- | --- |
| setup-plan 的 BRANCH 与 Git 分支不同。 | plan 明确逻辑功能标识和真实 Git 分支，不切换分支或误报创建新分支。 |
| 直接载入 SharedModule 可能读取项目 `.env` 并启动无关依赖。 | 采用无 `.env` cwd、白名单配置、测试组合和业务 import 前隔离，详见 R-003。 |
| tsx 与 Nest 装饰器元数据不能假定兼容。 | CLI 保持无 Nest，业务 worker 复用 ts-node/tsconfig-paths 或 Jest/ts-jest，详见 R-001。 |
| 发音代码存在并不代表 Module 已配置真实 Provider/存储/音频 inspector。 | 测试组合显式接入已有实现，原默认绑定不变，依赖/授权缺失仍未完成，详见 R-004。 |
| 真实客户端可能无法自动化或约束模型费用。 | 同轮 challenge + 人工操作 + 服务端 Trace；无法确认费用上界则不启动付费任务，不删客户端范围，详见 R-007。 |
| 原 MCP 矩阵助手对所有客户端状态同值的限制不适合实际运行。 | 新评测记录逐客户端独立状态并归并，不照搬该限制。 |
| 预检/attach/清理成功可能被误当质量通过。 | 操作型命令独立 operationStatus；只有 run/verify 的有效 gate 能用作评测结论，measurement 未资格返回 2。 |
| 强制进程退出或 CI runner 丢失不能保证最终保存回调。 | 派发前写计划/预留及增量事件，recover 保留未完成，不能保证每次 always/finally 都执行。 |
| 原始人工录音与 CI 产物新增保留政策尚未批准。 | 用政策引用与副本索引管理，缺批准不收集受限内容；不创造保存期限授权。 |

## Phase completion check

- Phase 0 的 R-001–R-010 已解决技术选择；运行前提继续由 spec DEP-001–DEP-007 管理，不伪装已批准。
- Phase 1 提供 plan、research、data-model、CLI/Report/CI 契约、quickstart 与本追溯表；保留原 spec/checklist/evidence-inventory。
- 本计划未增加业务 API、数据库实体、生产配置或依赖；拟新增 CLI/Skill/工作流仅是设计。
- 文档检查已通过：52/52 FR、18/18 SC 均有映射，130 个本地链接有效，8 段命令仅通过语法检查而未执行；8 份 Plan 产物无未解决技术占位符。无实现测试或付费评测的通过声明。
- 未配置 before_plan/after_plan hook。设计门禁复核通过，可进入后续 Tasks；完整功能验收仍需实际证据。
