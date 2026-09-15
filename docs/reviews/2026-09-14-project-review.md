# 全项目代码审查与功能接通检查

修复进展：本次优先五组问题已处理，详见 [修复与验证记录](./2026-09-14-priority-fixes.md)。下文保留修复前的审查快照，不能作为当前构建和已修复问题的状态。

审查日期：2026-09-14。范围：`apps/web`、`apps/tracker`、`server/apps/server`、`server/apps/ai`、共享学习服务与契约、Prisma 模型/迁移、部署脚本和现有测试。审查针对当前工作区源码，不代表线上服务状态。未修改业务代码，未连接生产数据库、执行迁移、调用付费模型或发送邮件。

**结论：当前版本不能视为完整可运行。前端可以构建，业务服务类型检查通过，但 AI 服务构建失败，且存在独立于类型错误的模块启动问题。发音、MCP、RAG 摄取存在明确的生产接线缺口。旧支付和聊天链路有需要优先修复的安全问题。**

P1 表示应优先处理的启动阻断、越权或敏感数据问题；P2 表示功能正确性、接通或验证问题。默认关闭功能本身不是缺陷；下文单独指出“打开开关后仍不可用”的原因。

## 实际验证结果

| 检查 | 本次结果 | 说明 |
| --- | --- | --- |
| 前端单元测试 | 24 个文件、135 项通过 | `pnpm --filter @en/web test:unit` |
| 前端类型检查 | 通过 | `pnpm --filter @en/web type-check` |
| 前端生产打包 | 通过 | 输出到临时目录；原有 `stats.html` 已还原 |
| 业务服务类型检查 | 通过 | `tsc --noEmit -p apps/server/tsconfig.app.json` |
| AI 类型检查及正式 Nest 构建 | **失败，23 处错误，分布于 11 个文件** | `tsc --noEmit` 和 `nest build ai` 均验证失败 |
| 后端默认 Jest 测试 | 223 个套件通过，1 个跳过；1,354 项通过，5 项跳过 | 首次沙箱禁止监听端口，允许本机测试监听后完成重跑 |
| AI 独立集成测试 | 24 个套件通过，6 个跳过；105 项通过，14 项跳过 | `jest --config apps/ai/test/jest-e2e.json --runInBand`；缺少专用环境的路径没有验证 |
| 默认 Chromium E2E 入口 | **收集阶段失败** | 错误收集后端 Jest 文件，出现 `describe/beforeEach/jest is not defined` |
| 指定前端 E2E 目录 | 首轮 3 项通过、7 项失败 | 包含 Vite 依赖优化造成的 504 模块加载失败及旧回归夹具错误 |
| Coach 浏览器流程单线程重跑 | **7 项全部通过** | 模拟 API 下的页面与流式交互，不能证明真实后端接通 |
| Tracker 打包 | 产物生成，但声明检查打印 **9 处类型错误** | 构建仍以成功状态退出，不能算类型检查通过 |
| 模块依赖最小复现 | **至少 3 处依赖注入失败** | 用 Nest TestingModule 和假依赖，不连接外部服务 |
| 支付及业务响应最小复现 | 确认未签名/未付款通知被接受、业务错误被标记 `success: true` | 仅内存假数据库，不产生实际订单或课程 |

临时验证日志：[后端测试](/tmp/en-review-server-tests-full.log)、[AI 集成测试](/tmp/en-review-ai-integration.log)、[AI 类型错误](/tmp/en-review-ai-types.log)、[AI 构建](/tmp/en-review-nest-ai-build.log)、[前端测试](/tmp/en-review-web-tests.log)、[默认 E2E](/tmp/en-review-e2e.log)、[Coach E2E 重跑](/tmp/en-review-coach-e2e-repeat.log)、[Tracker 构建](/tmp/en-review-tracker-build.log)。这些临时文件可能被系统清理，核心结论已保存在本文。

## 优先修复的问题

### R01 · P1：AI 服务无法通过正式构建

23 处错误包括 Coach/RAG v1/v2 契约联合类型没有收窄、MCP 出题与作答参数类型混用、发音返回值可空性和只读数组不匹配、缺少导出的类型等。不是只影响测试：部署脚本的 `nest build ai` 会在这里退出，无法部署当前版本。

尤其是 [mcp-idempotency.repository.ts:3](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/mcp/persistence/mcp-idempotency.repository.ts:3) 把 `Prisma` 作为纯类型导入，却在 [第 286 行](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/mcp/persistence/mcp-idempotency.repository.ts:286) 读取 `Prisma.DbNull`。绕过类型检查也会让该作答保存分支在运行时出错。

建议先让业务服务和 AI 服务分别构建通过，再继续做真实集成验证；不能仅依据 Jest 通过判断发布状态。错误明细见上方日志。

### R02 · P1：AI 模块有独立的依赖注入错误，关闭功能也无法规避

至少以下三处已通过最小复现确认：

- [knowledge-outbox.dispatcher.ts:47](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/knowledge/queue/knowledge-outbox.dispatcher.ts:47)：`now` 函数参数有默认值，但没有可选注入或工厂，Nest 仍尝试解析 `Function`。
- [pronunciation-upload.guard.ts:37](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/pronunciation/api/pronunciation-upload.guard.ts:37)：依赖 `PronunciationAssessmentService` 只有 `import type`，运行时注入元数据退化为 `Object`。
- [pronunciation-audio.service.ts:49](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/pronunciation/application/pronunciation-audio.service.ts:49)：同样把 `now` 当作必需 `Function` 依赖。

这些类被直接列入已导入模块的 providers；配置开关控制业务入口，并不阻止 Nest 创建这些 provider。建议修复值导入、显式 token、可选参数或工厂，并补一个不访问外部服务的完整模块装配检查。上述三处不是对所有 provider 的穷尽清单。

### R03 · P1：支付回调未验签，也未验证付款状态和订单归属

[pay.service.ts:77](/Users/woofeel/Downloads/en-learning-plus/server/apps/server/src/pay/pay.service.ts:77) 在公开通知接口中直接把订单改成 `TRADE_SUCCESS`，再使用请求体里的 `userId/courseId` 开通课程。没有验证签名、实际 `trade_status`、金额、商户信息，也没有从本地订单取得课程归属。

本次内存复现传入没有签名、状态为 `WAIT_BUYER_PAY` 的通知，仍执行了成功状态更新和课程创建。攻击者能够获得自己创建的订单号，再提交构造的通知；不需要真实付款。建议验签后核对本地订单及成功状态，并将课程、用户、价格快照持久化在订单中，由该快照决定开通对象。

### R04 · P1：课程售价由前端决定

[pay.service.ts:46](/Users/woofeel/Downloads/en-learning-plus/server/apps/server/src/pay/pay.service.ts:46) 和 [第 58 行](/Users/woofeel/Downloads/en-learning-plus/server/apps/server/src/pay/pay.service.ts:58) 直接使用 `createPayDto.total_amount` 建单并传给支付宝，没有查询课程真实售价。即使修好通知验签，调用者仍能修改金额，以低价购买指定课程。

建议客户端仅提交课程标识，服务端读取有效课程和价格生成订单；回调再对照订单快照核验金额。

### R05 · P1：旧聊天接口未认证，会话归属完全由调用者填写

[chat.controller.ts:12](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/chat/chat.controller.ts:12) 和 [第 38 行](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/chat/chat.controller.ts:38) 没有认证守卫；[chat.service.ts:45](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/chat/chat.service.ts:45) 用请求提供的 `userId-role` 作为持久化会话键。知道用户标识即可读取对应历史、向其历史追加消息，也能匿名触发模型调用。

建议所有旧聊天读写统一使用认证主体；SSE 客户端也需补认证头和过期处理，不能只给控制器加守卫就结束。

### R06 · P1：旧聊天将模型返回的 HTML 直接插入页面

[Bubble.vue:21](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/views/Chat/components/Bubble.vue:21) 将 `marked.parse()` 结果交给 `v-html`，[第 84 行](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/views/Chat/components/Bubble.vue:84) 没有清洗。模型内容和联网搜索内容属于不可信输入，包含事件属性的 HTML 可在页面执行；用户令牌又保存在 localStorage，影响不限于页面显示。

建议禁用原始 HTML 或对最终 HTML 使用明确的安全白名单清洗。该问题针对旧聊天，Coach 的普通文本插值没有这条相同路径。

### R07 · P1：退出账号不清空 Coach 状态，可能向下一账号展示上一账号内容

[user.ts:44](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/stores/user.ts:44) 退出时只清空用户 store，Coach store 中的画像、消息、会话 ID 和题目继续存活。[Coach/index.vue:155](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/views/Coach/index.vue:155) 仅在列表非空时打开新会话。

复现场景：A 使用 Coach 后退出，同一页面会话内登录没有历史的 B，再进入 Coach。由于没有重置分支，A 的消息和会话 ID 仍可保留；[ensureConversation](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/views/Coach/index.vue:176) 还会继续复用旧 ID。后端的归属校验不能消除已经存在于浏览器内的内容泄露。

建议在认证主体变更时清理全部学习相关状态，并终止旧流；页面初始化时也应处理无会话及失败分支。

### R08 · P1：头像上传公开且没有上传前的大小和类型约束

[user.controller.ts:39](/Users/woofeel/Downloads/en-learning-plus/server/apps/server/src/user/user.controller.ts:39) 未加认证，`FileInterceptor('file')` 未配置文件大小或类型限制。服务层的 5MB 判断发生在文件已被缓冲之后，且直接接受声明的 MIME 类型上传到对象存储。

影响：匿名调用者可占用内存和存储、向公共资源桶上传非头像文件。建议认证、上传层限额、校验真实图片类型，并规范生成对象名。

### R09 · P1：数据库保存的是可直接重放的密码凭据

前端提交 MD5，服务端在 [user.service.ts:66](/Users/woofeel/Downloads/en-learning-plus/server/apps/server/src/user/user.service.ts:66) 原样存储，再在 [第 40 行](/Users/woofeel/Downloads/en-learning-plus/server/apps/server/src/user/user.service.ts:40) 直接比较。数据库中的该值本身就是登录接口接受的凭据，泄露后不需要破解即可重放。

建议服务端做带盐、适合密码存储的哈希验证，并规划已有账号迁移。浏览器 MD5 不能替代服务端密码存储保护。

### R10 · P2：日报的调度时间与取数窗口错位

[digest.service.ts:70](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/digest/digest.service.ts:70) 每天零点执行，但 [第 89 行](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/digest/digest.service.ts:89) 筛选刚开始的“今天”是否已有学习记录。前一天正常学习的用户因此通常不会被选中；当天稍后产生的学习记录也不会再触发本次任务。即使选中，也是零点生成正文、延迟到用户设置的时间发送，遗漏之后的学习。

建议按照用户发送时刻生成报告并查询明确的报告周期，同时保证查询、调度使用一致时区。

### R11 · P2：完成一组词后不保存，点击“再练一组”才保存

[Course/Learn/index.vue:148](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/views/Course/Learn/index.vue:148) 完成最后一个词只递增索引；实际保存发生在 [第 152 行](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/views/Course/Learn/index.vue:152)，仅由“再练一组”按钮触发。用户看到“已学完”后离开或刷新，这组进度全部丢失。

建议最后一词完成后保存，或提供明确的“保存并结束”；界面应区分练习完成与已保存状态。

### R12 · P2：业务错误统一被响应拦截器标成成功

[interceptor.ts:40](/Users/woofeel/Downloads/en-learning-plus/server/libs/shared/src/interceptor/interceptor.ts:40) 固定 `success: true`，不判断 `ResponseService.error()`。本次复现得到：`{ code: -1, success: true, data: null, message: '课程未购买' }`。

依赖 `res.success` 的调用方会进入成功分支，课程学习页可能把 `list` 设成 `null`，随后访问 `list.length` 出错。建议统一错误契约和 HTTP/业务状态，避免部分页面判断 `code`、部分判断 `success`。

### R13 · P2：普通聊天的多个流会混写到最后一条消息

[Chat/index.vue](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/views/Chat/index.vue:25) 每次发送新建占位消息，但所有回调都写 `list[list.length - 1]`，没有绑定消息 ID，也没有发送中互斥或取消机制。连续发送两条消息，或流式返回时切换聊天角色，会把旧流拼接到新消息/新角色的列表。

建议回调绑定创建时的消息 ID，切换会话/卸载时中止旧流，并明确并发发送规则。

### R14 · P2：语音识别不支持时，普通文字聊天也无法正常初始化

[useVoiceToText.ts:15](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/hooks/useVoiceToText.ts:15) 在浏览器不暴露 SpeechRecognition 时直接抛错；[第 32 行](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/hooks/useVoiceToText.ts:32) 在组件 setup 阶段立即调用。语音按钮还没点击，Bubble 初始化就已经失败。

建议按能力检测禁用语音入口，保留文字聊天，在用户点击录音时才创建识别实例。

### R15 · P2：支付通知没有幂等处理，成功通知重投会失败

[pay.service.ts:95](/Users/woofeel/Downloads/en-learning-plus/server/apps/server/src/pay/pay.service.ts:95) 每次通知都 `courseRecord.create`，但数据模型对用户与课程组合有唯一约束。相同成功通知第二次到达会触发唯一约束错误；支付事件还在事务提交前广播。

建议已成功订单对合法重投直接返回成功，只在首次完成状态迁移时创建权益，提交事务后再发送事件。另需核对支付通知要求的原始响应格式：当前 `return true` 会被全局拦截器转成 JSON 包装，而不是由通知控制器明确输出回执。

### R16 · P2：部署脚本没有执行数据库迁移

[deploy.sh:27](/Users/woofeel/Downloads/en-learning-plus/deploy.sh:27) 只做 `prisma generate` 和构建，随后重启；没有应用仓库中的 Coach、RAG、发音和 MCP 迁移。已有旧数据库直接使用该脚本升级时，生成了新客户端并不等于新表/列已经存在。

建议在明确的发布流程中执行和检查迁移，再切换服务。当前是否已经人工迁移不能从源码判断，本次没有连接数据库验证。脚本的 `pm2 delete all` 还会影响同一 PM2 下其他应用，应只操作本项目进程。

### R17 · P2：默认浏览器回归入口及旧功能夹具失效

[playwright.config.ts:22](/Users/woofeel/Downloads/en-learning-plus/playwright.config.ts:22) 在项目根目录使用 `tests/**/*.spec.ts`，实际也匹配到了新增的 `server/apps/ai/test/evals/unified/tests`，把 Jest 文件当成 Playwright 测试，导致收集阶段失败。

此外，[existing-flows-regression.spec.ts:33](/Users/woofeel/Downloads/en-learning-plus/apps/web/e2e/existing-flows-regression.spec.ts:33) 在 `page.addInitScript` 的浏览器函数中读取外层 `now`，没有作为参数传入。本次 Trace 确認 `ReferenceError: now is not defined`，登录夹具未写入。

建议精确限制测试根目录，并显式向浏览器初始化函数传参。不要把这类夹具失败归因于业务功能，也不要跳过后宣称全部端到端验证通过。

## 尚未完全接通的功能

| 功能 | 已有代码 | 尚缺的连接 | 影响与下一步 |
| --- | --- | --- | --- |
| 发音评测主链路 | 创建/上传/提交/轮询 API、录音 UI、Azure 与音频检查/存储类、结果与学习写入逻辑 | [PronunciationModule:93](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/pronunciation/pronunciation.module.ts:93) 固定绑定三个 `Unavailable` 实现；评测队列、dispatcher、processor、executor 未装配到生产模块 | 单词和 Coach 练习虽有录音入口，但不能完成真实上传和评测。要绑定真实实现并补齐队列消费；仅打开开关或填写 Provider key 不够 |
| 课程/RAG 来源发音 | 来源校验接口、来源类型与规则 | [LearningModule:266](/Users/woofeel/Downloads/en-learning-plus/server/libs/learning/src/learning.module.ts:266) 使用 `UnavailablePronunciationSourceRightsRepository`，真实课程/引用查询未绑定；课程页和引用卡未挂发音入口 | 来源功能会返回不可用。先接当前用户权限与来源版本校验，再开放入口 |
| 发音历史与用户删除 | [PronunciationHistory.vue](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/components/Pronunciation/PronunciationHistory.vue:103) 实现列表、回放、删除 | 组件没有被任何实际页面/路由引用；现有入口关闭后没有可见的历史入口 | 用户无法通过当前 UI 完成跨会话回放和删除历史；需要实际历史页/面板 |
| 发音和 MCP 到期清理 | `PronunciationCleanupProcessor.processDue`、`McpRetentionProcessor.runOnce` | 项目运行代码中没有调度调用这些方法；仅注册 provider 不会定时执行 | 不能证明到期/删除重试会自动完成。需要明确调度与失败恢复；Coach 自身有定时清理调用，不应混为同一缺口 |
| MCP 外部客户端接入 | 协议边界、认证抽象、工具/资源/提示词 registry、确认页和业务 bridge | [McpModule:274](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/mcp/mcp.module.ts:274) 固定禁用验证器；[第 372 行](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/mcp/mcp.module.ts:372) 固定拒绝 admission；[server factory](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/mcp/mcp.module.ts:439) 仅新建空 McpServer，未挂业务 registries | 打开 MCP 开关仍不能完成真实认证和能力调用。需完成认证/授权、限流存储、持久化 Trace、registries 与请求上下文装配 |
| RAG 知识摄取/重建 | backfill 能写 outbox，已有切块/embedding/版本/检索逻辑 | [ingestion processor:70](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/src/knowledge/queue/knowledge-ingestion.processor.ts:70) 缺执行器必定标记 `INGESTION_EXECUTOR_UNAVAILABLE`；dispatcher 的 `dispatchBatch` 在生产代码无调用者 | 新知识不能从入库任务自动走到可检索索引。补执行器、调度、来源变更接线和发布流程；已有索引的查询代码存在，不能据此否认整个检索实现 |
| RAG 引用定位 | 引用卡、受控路由生成 | [contracts.ts:43](/Users/woofeel/Downloads/en-learning-plus/apps/web/src/apis/coach/contracts.ts:43) 跳到 `?citation=...`，词库页与课程页没有读取该参数定位记录 | 点击出处只进入列表，无法找到被引用条目。接记录查询、定位或详情页 |
| Coach 会话管理、反馈、数据删除 | 列表/删除/反馈 API 和客户端封装 | 页面只读取首条会话，没有历史切换/新会话操作；删除和反馈 API 没有页面调用入口 | 多会话、评价和用户主动数据删除未形成可操作的 UI 闭环 |
| 学习打卡天数 | 数据库 `dayNumber`、头像卡和顶栏展示 | 在运行代码中仅查询/展示，未找到递增与按天去重逻辑 | 正常学习不会自动更新打卡天数；需要定义打卡事件和时区并写入 |
| 统一 AI 评测的完整模式 | quick 检查、既有规则/测试封装、报告与 worker 框架 | [run-coordinator.ts:258](/Users/woofeel/Downloads/en-learning-plus/server/apps/ai/test/evals/unified/core/run-coordinator.ts:258) 对 full/qualification 无条件记录缺失门槛；配置与重试分支显式 `NOT_IMPLEMENTED`，多项任务仍未完成 | 目前可做部分离线回归，不能作为完整真实模型质量对比和发布资格评测。需要业务执行组合、数据集/配置、基线与校准等后续工作 |

## 其他应纳入后续修复的事项

- **Tracker 的成功构建会掩盖类型错误。** 9 处错误涉及访客 ID 可空、浏览器信息可空、历史 API 参数和错误堆栈可空。建议单独配置会失败退出的类型检查。现有单元测试主要覆盖 AI 新功能，没有对应 Tracker 回归。
- **Tracker 指标和身份绑定仍有缺口。** `reportPerformance` 在第一个 LCP entry 后断开观察，可能把中间候选当成最终 LCP；初始化依赖 UV 请求成功才安装其他上报监听。`update-uv` 接受任意用户 ID，登出又不清除服务端访客绑定，可能污染用户归因。
- **支付成功页面通知只靠单进程 Socket.IO 房间。** 部署采用多实例，代码未配置跨进程消息适配器；回调落在不同实例时，原窗口可能收不到事件。需要共享适配器或订单状态查询兜底。实际代理拓扑未在本次验证。
- **前端历史能力及运行能力验证仍不足。** 发音浏览器测试仅探测 API 与清理基础能力，核心评测测试调用 fake provider；它们没有验证真实麦克风录制→上传→Provider→持久化的完整链路。现有通过结果不能替代真实联调。

## 建议修复顺序

1. 修复 AI 23 处编译错误和模块依赖注入，保证两个服务可构建、可在受控依赖下装配。
2. 修复支付验签/定价/归属/幂等、旧聊天认证和 HTML 注入、账号切换状态清理、上传保护与密码存储。
3. 先选一条主要 AI 功能完成真实联调：Coach 基础链路 → RAG 摄取与检索 → 发音主链路 → MCP 外部接入；每条验证从用户入口到数据保存，而非只验证类存在。
4. 补齐历史/删除/反馈/引用定位入口、日报窗口、课程完成保存、打卡逻辑及自动清理。
5. 修复默认测试入口和旧夹具，让构建、类型检查、单测及隔离环境端到端验证都成为可重复检查。

本次没有验证生产环境的密钥、数据库迁移状态、支付商户配置、对象存储策略、真实模型质量和实体设备录音；这些属于下一轮受控联调范围，不能在本次结果中标为已通过。
