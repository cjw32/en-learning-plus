# Tasks: 个性化英语学习 Coach

**Input**: Design documents from `/specs/001-personalized-learning-coach/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 本功能规格明确要求单元、合同、集成、端到端、安全、故障注入、回归和 AI 离线评测，因此各用户故事均包含先行测试任务。

**Task-stage boundary**: 本文件只定义未来 Implement 阶段的工作；生成本文件时不得安装依赖、编写业务代码、执行迁移、部署、提交或推送。

**Organization**: 任务按用户故事组织；每项均包含稳定 ID、明确文件路径、需求关联和验证方式。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可在满足前置条件后并行执行，且不会与同批任务修改同一文件。
- **[Story]**: 对应 `spec.md` 中的用户故事。
- **Req**: 关联的功能需求、成功标准或已识别依赖。
- **Verify**: Implement 阶段必须执行的验证方式；测试任务应先编写并确认在实现前失败。

---

## Phase 1: Setup（共享工程准备）

**Purpose**: 声明已批准的依赖、工程入口和测试基础，但不在 Tasks 阶段执行这些操作。

- [x] T001 在 `server/package.json`、`packages/common/package.json`、`apps/web/package.json`、根 `package.json` 和 `pnpm-lock.yaml` 中声明 `@langchain/langgraph`、`ioredis`、`zod`、`vitest`、`@vue/test-utils`、`@playwright/test` 及对应脚本，不引入向量库、外部 Trace 或多 Agent 依赖（Req: DEP-006, FR-020, FR-067；Verify: `pnpm install --lockfile-only` 后运行 `pnpm --filter @en/server exec node -e "require.resolve('@langchain/langgraph');require.resolve('ioredis')"`、`pnpm --filter @en/web exec vitest --version` 和 `pnpm exec playwright --version`）。
- [x] T002 在 `server/nest-cli.json`、`server/tsconfig.json`、`server/package.json`、`server/libs/learning/tsconfig.lib.json` 和 `server/libs/learning/src/index.ts` 注册 `@libs/learning` Nest 库及 Jest 路径映射（Req: DEP-004, FR-023；Verify: `pnpm --filter @en/server build` 能从 `en-server` 与 `en-ai` 解析 `@libs/learning`）。
- [x] T003 [P] 建立 `packages/common/coach/index.ts`、`packages/common/coach/api.schemas.ts`、`packages/common/coach/event.schemas.ts`、`packages/common/coach/result.schemas.ts` 和 `packages/common/coach/tool.schemas.ts` 的共享合同入口（Req: FR-020, FR-032；Verify: `pnpm --filter @en/web type-check` 与 `pnpm --filter @en/server build` 均能导入 `@en/common/coach`）。
- [x] T004 [P] 在 `server/apps/ai/test/jest-e2e.json`、`apps/web/vitest.config.ts`、`playwright.config.ts` 和 `apps/web/e2e/fixtures/coach.ts` 配置 AI e2e、Vue 单测和浏览器测试环境，强制使用合成用户与隔离 PostgreSQL/Redis（Req: FR-056, FR-067；Verify: Jest、Vitest、Playwright 分别能列出 Coach 测试且配置中不存在生产 URL 或凭证）。
- [x] T005 [P] 在 `packages/config/index.ts`、`server/apps/ai/src/coach/governance/coach-config.schema.ts` 和 `.env.example` 定义 `COACH_ENABLED`、`COACH_LIVE_MODEL_ENABLED`、`COACH_WRITE_ENABLED`、模型/价格/预算/数据集版本配置，并让缺失生产预算时写功能 fail closed（Req: FR-042, FR-061, FR-073, DEP-008；Verify: `server/apps/ai/test/governance/coach-config.spec.ts` 覆盖合法配置、占位值、缺失价格和三层开关）。

**Checkpoint**: 工程、测试与配置入口就绪；尚未提供任何 Coach 业务能力。

---

## Phase 2: Foundational（阻塞所有用户故事）

**Purpose**: 建立版本化合同、持久化模型、认证上下文、请求状态、队列、预算和最小 Trace 基础。

**⚠️ CRITICAL**: 本阶段完成前不得开始用户故事实现。

### Foundational tests（先编写并确认失败）

- [x] T006 [P] 在 `server/apps/ai/test/contract/coach-schemas.spec.ts` 编写 API、SSE、最终结果和六个工具的 Zod/JSON Schema 等价性、未知字段拒绝、场景条件和 `userId` 禁止测试（Req: FR-017, FR-020, FR-021, FR-029–FR-032, SC-002；Verify: 实现前测试因合同缺失而失败，实现后 `pnpm --filter @en/server test -- --runInBand coach-schemas.spec.ts` 通过）。
- [x] T007 [P] 在 `server/apps/ai/test/security/coach-auth-context.spec.ts` 编写 access token/refresh token 区分、过期边界、不可变认证主体和模型/请求 `userId` 注入测试（Req: FR-001, FR-016–FR-019, DEP-001, SC-001；Verify: `pnpm --filter @en/server test -- --runInBand coach-auth-context.spec.ts` 证明数据访问前拒绝且响应不暴露资源存在性）。
- [x] T008 [P] 在 `server/libs/learning/src/review/legacy-learning-state.backfill.spec.ts` 编写新实体约束、存量 `isMaster` 回填、重复运行、固定 rollout 时间及只读查询零写入测试（Req: FR-062–FR-066, DEP-003；Verify: 在一次性测试数据库运行两次后状态行数量不变，`WordBookRecord` 与 `User.wordNumber` 快照完全一致）。
- [x] T009 [P] 在 `server/apps/ai/test/integration/coach-request-state.spec.ts` 编写请求状态机、同 key 同 body 重放、同 key 异 body冲突、终态不可逆和单会话仅一个活动请求测试（Req: FR-004, FR-010, FR-047–FR-048；Verify: `pnpm --filter @en/server test -- --runInBand coach-request-state.spec.ts` 覆盖全部合法/非法转换）。
- [x] T010 [P] 在 `server/apps/ai/test/governance/coach-foundation.spec.ts` 编写预算计数、限流键隔离、Trace 顺序和日志脱敏 allowlist 测试（Req: FR-005, FR-027, FR-041–FR-043, FR-049–FR-052；Verify: 超预算停止下一节点，敏感 canary 在日志、Trace 和事件中命中数为 0）。

### Foundational implementation

- [x] T011 在 `server/prisma/schema.prisma` 添加 `LearnerProfile`、`LearningItemState`、`LearningReviewEvent`、`CoachConversation`、`CoachMessage`、`CoachRequest`、`Exercise`/条目/目标、`ExerciseSubmission`/条目、`LearningAttempt`、`CoachTrace`、`CoachStepTrace`、`CoachFeedback`、`TraceSubjectMapping` 及 `data-model.md` 中的枚举、关系、索引和唯一约束（Req: FR-004–FR-005, FR-047–FR-060, FR-062–FR-065, DEP-002–DEP-007；Verify: `pnpm --filter @en/server exec prisma validate` 通过，且模型/约束逐项与 `data-model.md` 对照）。
- [x] T012 在 `server/prisma/migrations/202609020001_personalized_learning_coach/migration.sql` 生成并审查仅新增的迁移，包含数据库可表达的检查/唯一/外键约束且不改变旧字段语义（Req: FR-048, FR-060, FR-065, SC-006, SC-012；Verify: 对空库和旧版数据快照各执行一次 `prisma migrate deploy`，再对比 `WordBookRecord.isMaster` 与 `User.wordNumber`）。
- [x] T013 在 `server/prisma/backfills/coach-learning-state.ts` 实现可重入存量单词状态回填和计数审计，固定 rollout 时间并在任何差异时拒绝启用 Coach 写开关（Req: FR-065–FR-066, DEP-003；Verify: 运行两次得到相同摘要，每个旧 mastered 词最多一条状态且 due 顺序稳定）。
- [x] T014 [P] 在 `packages/common/coach/api.schemas.ts`、`packages/common/coach/event.schemas.ts`、`packages/common/coach/result.schemas.ts`、`packages/common/coach/tool.schemas.ts` 和 `packages/common/coach/index.ts` 实现 `coach.v1`/`coach.sse.v1` 的 Zod 源合同与推断类型，覆盖 OpenAPI、最终结果和六个工具且任何公开/工具输入均无 `userId`（Req: FR-017, FR-020–FR-021, FR-029–FR-035；Verify: T006 通过，并用 `rg -n 'userId' packages/common/coach/tool.schemas.ts` 确认无身份输入字段）。
- [x] T015 在 `packages/common/coach/generate-contracts.ts` 和 `server/apps/ai/test/contract/coach-contract-artifacts.spec.ts` 实现从 Zod 导出/比对 `contracts/coach-result.schema.json` 与 `contracts/coach-tools.schema.json` 的确定性流程（Req: FR-020, FR-032；Verify: 连续生成两次无 diff，计划阶段合同示例全部通过运行时 Schema）。
- [x] T016 [P] 在 `server/libs/shared/src/auth/auth.guard.ts`、`server/libs/shared/src/auth/coach-execution-context.ts` 和 `server/libs/shared/src/index.ts` 提供严格 Bearer 解析、access-token-only 校验、过期时间和不可变 `CoachExecutionContext`，不把 JWT 放入队列或模型状态（Req: FR-001, FR-016–FR-019, FR-044, DEP-001；Verify: T007 通过并检查 BullMQ job fixture 仅含 `requestId`）。
- [x] T017 [P] 在 `server/libs/learning/src/common/owned-resource.service.ts`、`server/libs/learning/src/common/learning-errors.ts` 和 `server/libs/learning/src/learning.module.ts` 建立认证主体独立参数、统一归属查询和安全 not-found/error 合同，禁止工具适配器直接使用 Prisma（Req: FR-018–FR-024, DEP-004；Verify: 单元测试比较他人 ID 与不存在 ID 的公开错误完全一致，并用依赖测试阻止 `coach/tools` 导入 Prisma）。
- [x] T018 在 `server/apps/ai/src/coach/api/coach-request.service.ts` 和 `server/apps/ai/src/coach/api/coach-request.repository.ts` 实现会话/消息/请求持久化、状态机、body hash、单活动请求和终态不可变规则（Req: FR-004, FR-009–FR-010, FR-047–FR-048；Verify: T009 全部通过）。
- [x] T019 [P] 在 `server/apps/ai/src/coach/governance/coach-idempotency.service.ts` 实现按认证主体、操作、逻辑资源、答案版本绑定的数据库幂等语义，Redis 仅作加速（Req: FR-022, FR-039, FR-047–FR-048；Verify: 同 key 同 body 重放原结果，同 key 异 body 返回 `IDEMPOTENCY_CONFLICT` 且数据库无第二次变化）。
- [x] T020 [P] 在 `server/apps/ai/src/coach/queue/coach.queue.ts`、`server/apps/ai/src/coach/queue/coach.processor.ts` 和 `server/apps/ai/src/coach/streaming/coach-redis.module.ts` 建立 `jobId=requestId` 的 BullMQ 执行入口及共享 Redis 连接，job 数据只含请求 ID（Req: FR-004, FR-036, FR-048；Verify: 队列重复投递只运行一个逻辑请求，job/Redis 敏感字段扫描为 0）。
- [x] T021 [P] 在 `server/apps/ai/src/coach/workflow/coach-state.ts`、`server/apps/ai/src/coach/workflow/coach-guards.ts`、`server/apps/ai/src/coach/prompts/coach-prompt.registry.ts` 和 `server/apps/ai/src/coach/governance/model-policy.ts` 定义受控图状态、节点前置门禁、版本化 Prompt/hash 和明确模型策略（Req: FR-002–FR-007, FR-010, FR-050；Verify: 状态 Schema 拒绝身份字段，Reasoner 默认禁用，未知 Prompt/模型版本无法执行）。
- [x] T022 [P] 在 `server/apps/ai/src/coach/governance/coach-budget.service.ts`、`server/apps/ai/src/coach/governance/coach-rate-limit.service.ts`、`server/apps/ai/src/coach/observability/coach-trace.service.ts` 和 `server/apps/ai/src/coach/observability/coach-redaction.ts` 建立节点前预算/并发检查、Trace/step 顺序及内容最小化基线（Req: FR-005, FR-027, FR-041–FR-043, FR-049–FR-052；Verify: T010 通过，缺价格版本或预算版本时 live/write 路径拒绝启动）。
- [x] T023 在 `server/libs/learning/src/learning.module.ts`、`server/apps/ai/src/coach/coach.module.ts`、`server/apps/ai/src/ai.module.ts` 和 `server/apps/server/src/app.module.ts` 完成共享学习库、Coach 模块、认证、Prisma、队列和配置的依赖装配，同时保持现有 `ChatModule` 路由不变（Req: FR-023–FR-024, SC-012；Verify: `pnpm --filter @en/server build` 通过，Nest 模块测试确认 `/ai/v1/chat` 未被 Coach Guard/Schema 改写）。

**Checkpoint**: 合同、数据库、身份、幂等、队列、图状态、预算和 Trace 基础均可测试；用户故事可开始实现。

---

## Phase 3: User Story 1 — 获得个性化讲解与纠错（Priority: P1）🎯 MVP

**Goal**: 已登录学习者获得基于本人 CEFR、学习目标、词汇/课程和可信历史的结构化讲解或纠错；数据缺失时透明降级。

**Independent Test**: 使用两个画像不同的合成用户提出相同问题，通过 API 查询最终结果；两者至少一个预定义适配维度不同、合同有效、引用有权访问，且任何未登录/跨用户请求在模型调用前被拒绝。

### Tests for User Story 1（先编写并确认失败）

- [x] T024 [P] [US1] 在 `server/apps/ai/test/security/coach-auth.e2e-spec.ts` 编写 profile、会话、请求、历史和结果读取的未登录、无效/refresh token、跨用户、Prompt/userId 注入测试（Req: FR-001, FR-016–FR-019, SC-001；Verify: `pnpm --filter @en/server exec jest --config apps/ai/test/jest-e2e.json --runInBand coach-auth.e2e-spec.ts` 零越权且模型 fake 调用次数为 0）。
- [x] T025 [P] [US1] 在 `server/libs/learning/src/learner-profile/learner-profile.service.spec.ts` 和 `server/libs/learning/src/materials/learning-material.service.spec.ts` 编写 CEFR/目标/本人课程校验、信号可用性、词典/课程引用、语法不可用和缺失数据测试（Req: FR-011–FR-015, FR-018, FR-028, DEP-002, DEP-005；Verify: 无历史返回合法缺失快照，未购课程与伪造 grammar 引用均被拒绝）。
- [x] T026 [P] [US1] 在 `server/apps/ai/test/workflow/coach-answer.workflow.spec.ts` 编写 ANSWER/CORRECTION 路径、工具顺序、一次 Schema 重试、确定性安全修复、引用校验和合法降级测试（Req: FR-002–FR-010, FR-029–FR-031, SC-002–SC-004；Verify: `pnpm --filter @en/server test -- --runInBand coach-answer.workflow.spec.ts` 且无路径进入 grade/save）。
- [x] T027 [P] [US1] 在 `apps/web/src/views/Coach/__tests__/coach-answer.spec.ts` 编写 profile 缺失提示、纠错/解释/示例、错误类型/引用渲染、未知 Schema 版本和另一用户数据 canary 测试（Req: FR-012, FR-032, FR-055–FR-056, SC-004；Verify: `pnpm --filter @en/web test:unit -- coach-answer` 通过且 DOM 无敏感 canary）。

### Implementation for User Story 1

- [x] T028 [P] [US1] 在 `server/libs/learning/src/learner-profile/learner-profile.service.ts` 和 `server/libs/learning/src/learner-profile/learner-profile.types.ts` 实现 CEFR/目标/时区/本人已购活动课程读写及最小画像快照，明确 available/missing/stale/not_applicable（Req: FR-011–FR-015, FR-055, DEP-002；Verify: T025 profile 用例通过，未设置等级时不产生默认 CEFR）。
- [x] T029 [P] [US1] 在 `server/libs/learning/src/materials/learning-material.provider.ts`、`word-book-material.provider.ts`、`course-material.provider.ts`、`grammar-material.provider.ts` 和 `learning-material.service.ts` 实现 provider-neutral 搜索、课程归属过滤、稳定 Citation 与 `DATA_NOT_AVAILABLE`（Req: FR-018, FR-023, FR-025, FR-028, FR-046, DEP-005；Verify: T025 materials 用例通过且 Bocha/Web 搜索不被标记为 RAG）。
- [x] T030 [US1] 在 `server/apps/ai/src/coach/tools/get-learner-profile.tool.ts` 和 `server/apps/ai/src/coach/tools/search-learning-materials.tool.ts` 实现只读适配器，通过 `@libs/learning` 和不可变上下文调用并校验输入/输出（Req: FR-017, FR-020, FR-023, FR-025；Verify: 工具合同测试通过，静态检查确认工具目录无 `PrismaService` 导入）。
- [x] T031 [P] [US1] 在 `server/apps/ai/src/coach/prompts/classify-intent.prompt.ts`、`server/apps/ai/src/coach/prompts/answer.prompt.ts`、`server/apps/ai/src/coach/prompts/correction.prompt.ts` 和 `server/apps/ai/src/coach/workflow/coach-model.gateway.ts` 实现最小上下文、未信任内容分隔和结构化调用，不输出 reasoning（Req: FR-003, FR-011–FR-014, FR-029, FR-052, FR-055, FR-061；Verify: Prompt snapshot 仅含允许画像字段/材料摘要，注入测试不能改变工具或身份）。
- [x] T032 [US1] 在 `server/apps/ai/src/coach/workflow/coach.graph.ts`、`server/apps/ai/src/coach/workflow/answer.nodes.ts` 和 `server/apps/ai/src/coach/workflow/final-result.validator.ts` 实现 classify→profile→可选 materials→answer/correction→recommend→validate/fallback 的显式边与一次重试（Req: FR-002–FR-010, FR-029–FR-031；Verify: T026 全部路径和禁止边断言通过）。
- [x] T033 [US1] 在 `server/apps/ai/src/coach/api/coach.controller.ts` 和 `server/apps/ai/src/coach/api/coach-api.service.ts` 实现 `GET/PATCH /coach/profile`、会话创建/列表/详情及 MESSAGE 请求创建/状态读取，所有接口使用 JWT、归属和幂等校验（Req: FR-001, FR-004, FR-015–FR-019, FR-047；Verify: OpenAPI operationId 对应的 US1 接口合同测试与 T024 通过）。
- [x] T034 [P] [US1] 在 `apps/web/src/apis/index.ts`、`apps/web/src/apis/coach/index.ts` 和 `apps/web/src/apis/coach/contracts.ts` 为 `aiApi` 增加与主 API 一致的 access-token/刷新处理并实现类型安全 Coach profile/会话/请求 API，任何请求不发送 `userId`（Req: FR-001, FR-016, FR-032, DEP-001；Verify: MSW/Vitest 断言 Authorization 存在、401 刷新一次且请求体无身份字段）。
- [x] T035 [US1] 在 `apps/web/src/stores/coach.ts` 实现会话、profile、消息、最终结果和错误的类型化状态，最终消息只接受通过共享 Schema 的 `result`（Req: FR-004, FR-031–FR-032, FR-056；Verify: T027 对未知版本/无效结果进入失败状态且不持久化 provisional 内容）。
- [x] T036 [US1] 在 `apps/web/src/router/coach/index.ts`、`apps/web/src/router/index.ts`、`apps/web/src/views/Coach/index.vue`、`components/LearnerProfileEditor.vue`、`components/CoachComposer.vue` 和 `components/CoachMessage.vue` 添加受保护 Coach 入口、CEFR/目标编辑和结构化讲解/纠错展示，保留现有 Chat 页面（Req: FR-011–FR-015, FR-032, SC-004, SC-012；Verify: T027、Web type-check/build 通过，未登录路由跳转登录且 `/chat` 行为不变）。

**Checkpoint**: Read-only Coach MVP 可独立演示和测试，学习写功能仍关闭。

---

## Phase 4: User Story 2 — 生成针对性练习（Priority: P1）

**Goal**: Coach 按等级、薄弱项、到期词和材料生成四种题型的可提交练习，绝不泄露答案键。

**Independent Test**: 两个薄弱项不同的合成用户请求同一题型，验证目标覆盖和难度有差异；材料不可用时得到合法降级且数据库没有 READY 练习。

### Tests for User Story 2（先编写并确认失败）

- [x] T037 [P] [US2] 在 `server/apps/ai/test/contract/coach-exercise.contract.spec.ts` 编写四种题型、数量/长度边界、目标/引用子集、用户投影禁止 `answerKey`/`gradingRubric` 和无依据练习不可提交测试（Req: FR-020–FR-021, FR-025, FR-028, SC-002；Verify: 合同 fixture 全部通过且敏感字段扫描为 0）。
- [x] T038 [P] [US2] 在 `server/libs/learning/src/review/review-schedule.service.spec.ts` 和 `server/libs/learning/src/exercises/exercise.service.spec.ts` 编写本地学习日 due 查询、稳定 cap/order、薄弱目标选择、一级挑战提示和缺失画像降级测试（Req: FR-011–FR-014, FR-027, FR-065；Verify: 相同快照重复运行顺序一致，只读 due 查询不新增状态）。
- [x] T039 [P] [US2] 在 `server/apps/ai/test/workflow/coach-exercise.workflow.spec.ts` 编写 profile→due words（按需）→materials→create exercise→recommend 路径、工具预算、材料故障和禁止 grade/save 测试（Req: FR-002–FR-006, FR-025–FR-030, SC-003–SC-004, SC-007；Verify: 失败场景无可提交 exerciseId 且 Trace 顺序符合预期）。
- [x] T040 [P] [US2] 在 `apps/web/src/views/Coach/__tests__/coach-exercise.spec.ts` 编写题型选择、练习卡、挑战提示、个性化理由、隐藏答案和降级 UI 测试（Req: FR-013–FR-014, FR-032, SC-004；Verify: `pnpm --filter @en/web test:unit -- coach-exercise` 且 DOM/序列化状态无答案键）。

### Implementation for User Story 2

- [x] T041 [P] [US2] 在 `server/libs/learning/src/review/review-schedule.service.ts` 实现按认证用户、IANA 时区、课程范围、到期时间和稳定优先级读取 due words，返回空成功或 `DATA_NOT_AVAILABLE`（Req: FR-011, FR-014, FR-018, FR-025, FR-065；Verify: T038 due 用例通过且查询日志无写语句）。
- [x] T042 [US2] 在 `server/apps/ai/src/coach/tools/get-due-words.tool.ts` 实现只读 Schema 适配器和友好 Trace 状态，不接收身份或任意查询表达式（Req: FR-017, FR-020, FR-023, FR-027；Verify: 工具合同与超时测试通过，同参数重复调用被图缓存/阻止）。
- [x] T043 [P] [US2] 在 `server/libs/learning/src/exercises/exercise.service.ts`、`exercise-targeting.service.ts` 和 `server/apps/ai/src/coach/prompts/create-exercise.prompt.ts` 实现四题型、受控答案键/评分 rubric、目标关联、材料引用、幂等 exercise 持久化和用户安全投影（Req: FR-011–FR-014, FR-025, FR-028；Verify: T037/T038 通过，创建练习不产生 attempt/review 事件）。
- [x] T044 [US2] 在 `server/apps/ai/src/coach/tools/create-exercise.tool.ts` 实现 compute/read 工具、结构重试、预算门禁和无可靠材料时不创建 READY 练习（Req: FR-006, FR-020, FR-025–FR-027, FR-029–FR-030；Verify: T039 工具路径通过且失败事务不留下可提交练习）。
- [x] T045 [US2] 在 `server/apps/ai/src/coach/workflow/exercise.nodes.ts`、`server/apps/ai/src/coach/workflow/coach.graph.ts` 和 `server/apps/ai/src/coach/api/coach-api.service.ts` 接入 CREATE_EXERCISE 分支和 `ExercisePreferences`，由业务代码决定 due/material/tool 顺序（Req: FR-002–FR-006, FR-008, SC-003；Verify: T039 全部路径通过，模型无法插入额外工具或越过预算）。
- [x] T046 [US2] 在 `apps/web/src/views/Coach/components/CoachComposer.vue`、`ExerciseCard.vue` 和 `apps/web/src/stores/coach.ts` 添加题型/题量输入、练习结果和可提交状态，客户端类型中不存在答案键（Req: FR-032, SC-004；Verify: T040、Web type-check/build 通过）。

**Checkpoint**: 用户可获得有依据的针对性练习，但作答保存仍未启用。

---

## Phase 5: User Story 3 — 批改并形成学习闭环（Priority: P1）

**Goal**: 对本人练习进行结构化批改，只有有效同版本批改才能原子、幂等地保存一次并更新 SM-2 状态。

**Independent Test**: 对同一练习提交正确、错误、重复、越权和故障注入答案；有效答案有完整批改并最多写一次，无效/越权/部分失败不改变学习状态。

### Tests for User Story 3（先编写并确认失败）

- [x] T047 [P] [US3] 在 `server/libs/learning/src/review/sm2-review-scheduler.spec.ts` 编写 q=0–5 映射、E-Factor 下限、1/6/ceil 间隔、低分重置、MASTERED 门槛、时区和同目标取最低质量的表驱动/性质测试（Req: FR-063–FR-066；Verify: `pnpm --filter @en/server test -- --runInBand sm2-review-scheduler.spec.ts` 覆盖所有边界）。
- [x] T048 [P] [US3] 在 `server/libs/learning/src/grading/grading.service.spec.ts` 编写客观题确定性评分、翻译/对话结构评分、可接受变体、空/部分/重复/超长答案、逐项与总分一致性测试（Req: FR-007, FR-020–FR-022, FR-062, SC-005；Verify: 不可评分返回 `score=null`、状态非 `GRADED_VALID`）。
- [x] T049 [P] [US3] 在 `server/apps/ai/test/workflow/coach-grading.workflow.spec.ts` 编写 owned exercise→grade→validate grade→save→recommend 路径、无效 Schema 重试/降级和 save-before-grade 禁止测试（Req: FR-006–FR-010, FR-029–FR-031, FR-045–FR-048, SC-003, SC-007；Verify: 每条失败路径的 `save_attempt` 调用次数为 0）。
- [x] T050 [P] [US3] 在 `server/apps/ai/test/integration/coach-attempt.e2e-spec.ts` 编写双击、同 key 异 body、提交后断网、SSE 重连、队列重投、取消边界和 review-event 中途失败的事务测试（Req: FR-022, FR-038–FR-039, FR-047–FR-048, FR-062–FR-065, SC-006–SC-007；Verify: 每个逻辑提交最多一个 attempt/每目标一个 event，故障时全部回滚）。
- [x] T051 [P] [US3] 在 `server/apps/ai/test/security/coach-grading-ownership.e2e-spec.ts` 编写他人 exercise/submission/attempt 标识、伪造 grading hash、答案版本错配和状态冲突测试（Req: FR-018–FR-019, FR-022, SC-001；Verify: 他人资源与不存在资源同响应，数据库零变化）。
- [x] T052 [P] [US3] 在 `server/apps/server/test/learn-coach-regression.e2e-spec.ts` 编写旧十词学习、`saveWordMaster`、重复单词和计数兼容测试（Req: FR-023, FR-065, SC-012；Verify: 旧响应合同不变、`wordNumber` 仅由旧流程更新且新状态幂等初始化）。
- [x] T053 [P] [US3] 在 `apps/web/src/views/Coach/__tests__/coach-grading.spec.ts` 编写分数、逐项纠错、错误类型、示例、saved/replayed/not_saved 和批改成功但保存失败的 UI 测试（Req: FR-032, FR-064, SC-005–SC-006, SC-010；Verify: `pnpm --filter @en/web test:unit -- coach-grading` 通过）。

### Implementation for User Story 3

- [x] T054 [P] [US3] 在 `server/libs/learning/src/review/sm2-review-scheduler.ts` 和 `review-schedule.service.ts` 实现 `SM2_V1` 纯函数转换、最低质量聚合和 UTC due 计算，不触碰 legacy `isMaster`/`wordNumber`（Req: FR-063–FR-066；Verify: T047 全部通过并对固定输入产生稳定 snapshot）。
- [x] T055 [P] [US3] 在 `server/libs/learning/src/grading/deterministic-grader.ts`、`grading.service.ts` 和 `server/apps/ai/src/coach/prompts/grade-answer.prompt.ts` 实现客观/主观分层评分、受控错误类型、业务总分和 grading hash（Req: FR-007, FR-020–FR-022, FR-062；Verify: T048 通过，模型不能提供答案键、任意规则或最终总分 authority）。
- [x] T056 [US3] 在 `server/apps/ai/src/coach/tools/grade-answer.tool.ts` 实现本人 exercise 加载、答案版本校验、结构重试和不可评分降级，不写学习状态（Req: FR-007, FR-019–FR-022, FR-025, FR-029–FR-030；Verify: T049/T051 grade 部分通过，工具执行后 attempt 数量不变）。
- [x] T057 [US3] 在 `server/libs/learning/src/attempts/attempt.service.ts` 实现 `data-model.md` 定义的单事务：锁定 submission、复核 owner/hash/state、插入一次 attempt、每目标一次 event、更新 aggregate、标记 SAVED 或返回已有结果（Req: FR-009, FR-022, FR-026, FR-047–FR-048, FR-062–FR-065；Verify: T050 全部原子/幂等用例通过）。
- [x] T058 [US3] 在 `server/apps/ai/src/coach/tools/save-attempt.tool.ts` 实现唯一写工具和 grade-valid 门禁，只接受批改引用/摘要校验值与提交幂等键（Req: FR-006–FR-007, FR-022, FR-026, FR-047；Verify: 工具 Schema 无任意 score/mastery/due/userId，T049 禁止边断言通过）。
- [x] T059 [US3] 在 `server/apps/ai/src/coach/workflow/grading.nodes.ts`、`server/apps/ai/src/coach/workflow/coach.graph.ts`、`server/apps/ai/src/coach/api/coach-api.service.ts` 和 `coach.controller.ts` 接入 EXERCISE_SUBMISSION、有效批改门禁、保存状态对账和最终 grading 结果（Req: FR-002–FR-010, FR-029–FR-031, FR-038, SC-005–SC-007；Verify: T049–T051 与 OpenAPI answer-submission request union 合同通过）。
- [x] T060 [US3] 在 `server/libs/learning/src/review/legacy-review-initializer.service.ts`、`server/apps/server/src/learn/learn.service.ts` 和 `learn.module.ts` 让旧 `saveWordMaster` 在原事务中幂等初始化新状态，同时维持既有返回和计数语义（Req: FR-023, FR-065, SC-012；Verify: T052 及回填测试通过，Coach attempt 不增加 `wordNumber`）。
- [x] T061 [US3] 在 `apps/web/src/views/Coach/components/GradingResult.vue`、`LearningUpdate.vue`、`ExerciseCard.vue` 和 `apps/web/src/stores/coach.ts` 实现答案提交、结构化批改、逐项结果及 saved/replayed/not_saved 展示（Req: FR-032, FR-064, SC-005–SC-006, SC-010；Verify: T053、Web type-check/build 通过，重复点击复用同一幂等键）。

**Checkpoint**: P1 学习闭环完整，所有写入已由有效批改、归属、状态和幂等门禁保护。

---

## Phase 6: User Story 4 — 控制流式会话（Priority: P2）

**Goal**: Vue 通过认证 SSE 展示安全状态与增量内容，并可靠处理取消、重连、重试、超时和失败。

**Independent Test**: 模拟正常、断网、重连、主动取消、Token 过期、模型/工具超时和重试；事件有序去重、最终结果唯一，写入最多一次且无内部信息泄露。

### Tests for User Story 4（先编写并确认失败）

- [x] T062 [P] [US4] 在 `server/apps/ai/test/contract/coach-sse.contract.spec.ts` 编写所有 SSE envelope/event、sequence、result→completed、友好 label、答案键/Prompt/reasoning 禁止和 410 过期合同测试（Req: FR-033–FR-036, FR-040, SC-002, SC-010；Verify: 事件 fixtures 全部通过 `CoachSseEventSchema`）。
- [x] T063 [P] [US4] 在 `server/apps/ai/test/integration/coach-stream-recovery.e2e-spec.ts` 编写 Redis Stream replay、跨实例订阅、重复 eventId、取消传播、写提交边界、Token 过期和 Redis 中断恢复测试（Req: FR-036–FR-044, FR-048, SC-006–SC-007；Verify: 重连不创建新请求，取消后无新节点，终态与 durable request 一致）。
- [x] T064 [P] [US4] 在 `apps/web/src/stores/__tests__/coach-stream.spec.ts` 编写 connected/status/tool/content/result/completed/cancelled/error reducer、事件去重、provisional 丢弃、410 fallback 和 retryability 测试（Req: FR-033–FR-040, SC-010；Verify: `pnpm --filter @en/web test:unit -- coach-stream` 通过）。
- [x] T065 [P] [US4] 在 `apps/web/e2e/coach-streaming.spec.ts` 编写加载、工具状态、取消、网络中断、replay、retry、超时、预算和最终保存状态的浏览器场景（Req: FR-033–FR-040, SC-006–SC-007, SC-010；Verify: `pnpm exec playwright test coach-streaming`，网络/DOM 中无 Prompt、reasoning、原始工具参数）。

### Implementation for User Story 4

- [x] T066 [P] [US4] 在 `server/apps/ai/src/coach/streaming/coach-event-stream.service.ts` 实现 `coach:events:{requestId}` 一小时 Redis Stream、严格序列、去重、heartbeat 和终态封口，数据库结果保持权威（Req: FR-033–FR-036, FR-048；Verify: T062/T063 replay 与终态测试通过）。
- [x] T067 [US4] 在 `server/apps/ai/src/coach/streaming/coach-sse.controller.ts` 实现认证/归属复核、`Last-Event-ID`、实时订阅和 replay 过期 410，不使用 query token（Req: FR-001, FR-036, FR-039–FR-040；Verify: T063 的未登录/跨用户/过期缓存场景通过）。
- [x] T068 [US4] 在 `server/apps/ai/src/coach/queue/coach.processor.ts` 和 `server/apps/ai/src/coach/workflow/coach.graph.ts` 发布 allowlist 状态/工具/内容事件，并把 `AbortSignal` 传播到 LangChain 与可中断工具（Req: FR-034–FR-035, FR-037, FR-044；Verify: 取消/超时后模型 fake 和工具 fake 均收到 abort，迟到回调不发 result）。
- [x] T069 [P] [US4] 在 `server/apps/ai/src/coach/governance/coach-cancellation.service.ts` 和 `coach-retry.service.ts` 实现 durable+Redis 取消、显式 retry lineage、已完成请求重放和不可重试分类（Req: FR-037–FR-040, FR-044, FR-048；Verify: T063 所有取消/重试状态通过）。
- [x] T070 [US4] 在 `server/apps/ai/src/coach/api/coach.controller.ts` 和 `coach-api.service.ts` 实现 request events、cancel、retry 和 durable status OpenAPI 操作，全部要求 JWT/owner/Idempotency-Key（Req: FR-001, FR-037–FR-040, FR-047；Verify: OpenAPI 合同与 T063 通过，断开 SSE 本身不会取消请求）。
- [x] T071 [P] [US4] 在 `apps/web/src/apis/coach/stream.ts` 实现带 Authorization、`AbortSignal`、`Last-Event-ID` 的 fetch-event-source 客户端和 401/410 恢复，不把 token 放 URL（Req: FR-033, FR-036–FR-040；Verify: T064 request mock 检查 header、abort、reconnect 与 fallback 请求）。
- [x] T072 [US4] 在 `apps/web/src/stores/coach.ts` 实现事件 reducer、已处理 ID 集、provisional/final 分离、取消/重试状态机和 durable reconciliation（Req: FR-035–FR-040, SC-010；Verify: T064 全部通过，重复 result/completed 不重复更新状态）。
- [x] T073 [US4] 在 `apps/web/src/views/Coach/components/CoachProgress.vue`、`CoachComposer.vue` 和 `apps/web/src/views/Coach/index.vue` 展示连接/生成/工具/批改/保存/完成/取消/超时/失败状态及 Cancel/Retry 控件，只映射服务端友好 label（Req: FR-033–FR-040, SC-010；Verify: T065 浏览器场景和无敏感 DOM 扫描通过）。

**Checkpoint**: 流式交互在 PM2 多实例、断网和取消条件下可恢复且不会重复写入。

---

## Phase 7: User Story 5 — 理解推荐和学习变化（Priority: P2）

**Goal**: 每个结果都给出基于已验证状态的下一步行动理由；保存后明确展示每个学习项的前后变化。

**Independent Test**: 分别构造低质量、到期但本次表现正常、表现良好无到期项和保存失败场景；验证 nextAction 枚举、理由和 learningUpdate 与实际状态完全一致。

### Tests for User Story 5（先编写并确认失败）

- [x] T074 [P] [US5] 在 `server/apps/ai/test/workflow/coach-next-action.spec.ts` 编写“本次 q<4→practice、否则有 due→review、否则 continue”、缺失画像和模型不得改写枚举测试（Req: FR-008, FR-011–FR-014, FR-064–FR-065；Verify: 所有决策由确定性状态决定，解释模型只能填理由）。
- [x] T075 [P] [US5] 在 `apps/web/src/views/Coach/__tests__/coach-recommendation.spec.ts` 编写推荐依据、个性化信号状态、逐目标前后变化、未变化原因及批改成功但未保存提示测试（Req: FR-012, FR-054, FR-064, SC-005, SC-010；Verify: `pnpm --filter @en/web test:unit -- coach-recommendation` 通过）。

### Implementation for User Story 5

- [x] T076 [P] [US5] 在 `server/apps/ai/src/coach/workflow/next-action.policy.ts` 实现只消费有效 grade/due/profile 的确定性 `review|practice|continue` 决策和 evidence codes（Req: FR-008, FR-011–FR-014, FR-065；Verify: T074 policy 用例通过且模型调用为 0）。
- [x] T077 [US5] 在 `server/apps/ai/src/coach/prompts/explain-next-action.prompt.ts` 和 `server/apps/ai/src/coach/workflow/recommendation.nodes.ts` 让模型只解释固定 action，限制依据为本次表现、due 状态或明确通用规则（Req: FR-008, FR-012, FR-029–FR-030；Verify: 注入或矛盾模型输出不能改变 action，失败时业务 fallback 仍有合法理由）。
- [x] T078 [US5] 在 `server/apps/ai/src/coach/workflow/coach-result.assembler.ts` 和 `final-result.validator.ts` 组装 learningUpdate 的 saved/replayed/not_saved、每项目 previous/next/reason/dueAt，并复核与事务事实一致（Req: FR-030–FR-031, FR-054, FR-062–FR-064；Verify: T050/T074 对账用例通过，保存失败绝不显示已更新）。
- [x] T079 [US5] 在 `apps/web/src/views/Coach/components/LearningUpdate.vue`、`GradingResult.vue` 和 `CoachMessage.vue` 展示推荐理由、信号不足、学习状态前后差异和下一复习时间（Req: FR-012, FR-064, SC-005, SC-010；Verify: T075 及 Web 可访问性查询通过）。
- [x] T080 [US5] 在 `server/apps/ai/src/coach/observability/coach-trace.service.ts` 和 `server/apps/ai/test/integration/coach-recommendation.e2e-spec.ts` 记录/验证 nextAction evidence、批改与 save/replay/not_saved 对账状态，不记录原始学习文本（Req: FR-049–FR-054；Verify: 四种独立场景均可由 Trace 安全元数据解释且敏感扫描为 0）。

**Checkpoint**: 用户可以理解 Coach 的推荐依据和实际学习状态变化。

---

## Phase 8: User Story 6 — 评估和追踪 Coach 质量（Priority: P2）

**Goal**: 建立可查询的隐私安全 Trace、请求治理、数据生命周期和 50–100 条可重复评测，阻止安全、质量、成本与延迟回归。

**Independent Test**: 运行完整确定性评测、故障注入和一次批准的 live candidate；报告可复现版本/工具/Schema/质量/TTFT/耗时/Token/费用，安全门槛零失败且无生产对话或直接身份。

### Tests for User Story 6（先编写并确认失败）

- [x] T081 [P] [US6] 在 `server/apps/ai/test/integration/coach-observability.e2e-spec.ts` 编写 completed/degraded/cancelled/timed-out/budget/schema/save replay Trace 完整性、步骤顺序、TTFT、Token、费用和反馈关联测试（Req: FR-049–FR-054, SC-008；Verify: 每个请求正好一个 Trace，必填指标/版本齐全）。
- [x] T082 [P] [US6] 在 `server/apps/ai/test/security/coach-redaction.spec.ts` 编写 JWT、refresh token、API key、数据库 URL、系统 Prompt、reasoning、答案键、堆栈、邮箱/手机号和跨用户 canary 扫描（Req: FR-051–FR-057, FR-061, SC-001, SC-008；Verify: API/SSE/Redis/job/log/Trace/eval 输出禁止值命中数为 0）。
- [x] T083 [P] [US6] 在 `server/apps/ai/test/governance/coach-failures.spec.ts` 编写用户/IP 限流、并发、输入/输出 Token、费用、模型/工具次数、单工具/总时限、模型/材料/Redis/DB 故障和迟到回调测试（Req: FR-027, FR-041–FR-048, SC-007, SC-011；Verify: 每个超限/故障得到稳定 code/retryable/saveStatus 且不启动后续写）。
- [x] T084 [P] [US6] 在 `server/apps/ai/test/integration/coach-retention.e2e-spec.ts` 编写 1h events、24h reconciliation、90d conversation/checkpoint、180d Trace/feedback、7d diagnostic、用户删除并发和 Trace 解绑测试（Req: FR-058–FR-060, SC-008；Verify: fake clock 推进后正确清理，删除后 24h 内主存储行消失且剩余 Trace 不可关联）。
- [x] T085 [P] [US6] 在 `server/apps/ai/test/evals/coach-eval-deterministic.spec.ts` 编写评测集规模/覆盖、Schema、工具路径、归属、引用、grade-before-save、幂等、注入、故障和版本元数据的确定性门禁（Req: FR-067–FR-074, SC-009；Verify: `pnpm --filter @en/server test -- --runInBand coach-eval-deterministic.spec.ts` 对安全类要求零失败）。

### Implementation for User Story 6

- [x] T086 [P] [US6] 在 `server/apps/ai/src/coach/observability/coach-trace.service.ts`、`coach-langchain.callbacks.ts` 和 `coach-trace-query.service.ts` 完成模型/Prompt/schema/budget 版本、TTFT、总耗时、Token、工具顺序/耗时/状态、重试和终态采集及授权查询（Req: FR-049–FR-054；Verify: T081 所有 Trace 字段/顺序断言通过）。
- [x] T087 [P] [US6] 在 `server/apps/ai/src/coach/governance/model-price.catalog.ts` 和 `coach-cost-meter.ts` 按 provider/model/version 计算可审计估算费用，未知价格拒绝 live/write（Req: FR-042–FR-043, FR-050, FR-073, DEP-008；Verify: 固定 token fixture 的费用可重复，未知/过期价目触发 `BUDGET_EXCEEDED` 或配置拒绝）。
- [x] T088 [US6] 在 `server/apps/ai/src/coach/governance/coach-budget.service.ts`、`coach-rate-limit.service.ts` 和 `server/apps/ai/src/coach/queue/coach.processor.ts` 完成执行前估算、逐调用计量、用户/IP/并发限制、deadline/AbortSignal 和节点前 fail-closed（Req: FR-027, FR-041–FR-044, SC-011；Verify: T083 所有预算维度 100% 安全终止且无后续 save step）。
- [x] T089 [P] [US6] 在 `server/apps/ai/src/coach/governance/coach-failure.mapper.ts` 和 `server/apps/ai/src/coach/workflow/fallback.builder.ts` 实现稳定错误类别、retryability、用户文案、合法 degraded result 和 saveStatus 对账，过滤 provider/SQL/stack（Req: FR-009–FR-010, FR-029–FR-030, FR-045–FR-046；Verify: T083 每种故障均匹配合同且无伪造 score/citation/update）。
- [x] T090 [P] [US6] 在 `server/apps/ai/src/coach/observability/coach-feedback.service.ts`、`server/apps/ai/src/coach/api/coach.controller.ts` 和 `apps/web/src/apis/coach/index.ts` 实现幂等 feedback upsert、本人 request 归属和 Trace/版本/responseType 关联（Req: FR-053, FR-056；Verify: T081 feedback 用例通过，他人 request 与重复反馈不新增行）。
- [x] T091 [P] [US6] 在 `server/apps/ai/src/coach/observability/coach-retention.service.ts`、`coach-retention.processor.ts` 和 `server/libs/learning/src/privacy/learning-data-deletion.service.ts` 实现分层 TTL、立即隐藏、异步物理清除、删除 tombstone 和 TraceSubjectMapping 解绑（Req: FR-058–FR-060, DEP-007；Verify: T084 fake-clock 与并发删除用例通过）。
- [x] T092 [US6] 在 `server/apps/ai/src/coach/api/coach.controller.ts`、`coach-api.service.ts` 和 `server/apps/ai/src/coach/observability/checkpoint-purge.service.ts` 实现会话删除与 `DELETE /coach/data`，清理 Redis 并调用 `PostgresSaver.deleteThread`，不让在途请求恢复已删数据（Req: FR-058–FR-060；Verify: T084 删除后历史/stream/status 均不可读，在途 worker 不能重新写回）。
- [x] T093 [P] [US6] 在 `server/apps/ai/test/evals/fixtures/cases.jsonl` 创建 50–100 条合成/人工样本，覆盖五类意图、A1–C2/缺画像、薄弱项、四题型、安全攻击、无效输出、依赖失败和最坏成本路径（Req: FR-067–FR-068, SC-009；Verify: T085 统计规模、类别和成对个性化覆盖，无生产标识或对话复制）。
- [x] T094 [P] [US6] 在 `server/apps/ai/test/evals/expected/tool-paths.json` 和 `server/apps/ai/test/evals/expected/security-gates.json` 定义每例允许/禁止工具、顺序、来源 ID、Schema、安全、写门禁和幂等断言（Req: FR-068–FR-069, FR-072；Verify: T085 对所有安全/合同样本零失败，缺预期字段即使 runner 失败）。
- [x] T095 [P] [US6] 在 `server/apps/ai/test/evals/rubrics/correction.json`、`cefr-fit.json`、`exercise-targeting.json`、`grading.json`、`next-action.json` 和 `citation-support.json` 定义人工/独立模型评分输入、锚点、通过状态和争议人工复核规则（Req: FR-070, FR-072–FR-073；Verify: rubric Schema 校验通过且评分者输入不含身份字段）。
- [x] T096 [US6] 在 `server/apps/ai/test/evals/run.ts`、`deterministic-assertions.ts` 和 `report.ts` 实现 mock/live 两种可复现运行、确定性零失败门禁、质量评分、TTFT/总耗时/Token/费用与机器可读报告（Req: FR-069–FR-074, SC-008–SC-011；Verify: 同版本 mock 连续两次结果一致，报告包含全部版本和类别）。
- [x] T097 [US6] 在 `server/apps/ai/test/evals/baselines/coach-v1-approved.json` 和 `server/apps/ai/src/coach/governance/coach-budget-policy.approved.json` 建立“先测 existing AI 与 candidate、再审批相对容差/预算”的流程；没有实际测量和批准值时保持 live/write 关闭（Req: FR-042, FR-071–FR-073, DEP-008；Verify: baseline 缺失或版本不匹配时发布门禁失败，禁止填入猜测指标）。
- [x] T098 [US6] 在 `server/apps/ai/test/evals/trace-linker.ts`、`server/apps/ai/test/evals/release-gate.ts` 和 `server/apps/ai/test/evals/report.ts` 关联 dataset/prompt/model/schema/trace/feedback 版本，阻止安全失败、通过→不通过质量回退及超出批准成本/延迟容差（Req: FR-053, FR-071–FR-074, SC-009–SC-011；Verify: 注入一条安全失败或基线回退时 gate 非零退出，生产对话内容不进入结果）。

**Checkpoint**: AI 质量、安全、成本、时延、工具行为和数据生命周期均有可重复发布证据。

---

## Phase 9: Polish & Cross-Cutting Validation

**Purpose**: 运行全量验证、证明兼容性并形成发布/回滚证据；不扩大功能范围。

- [x] T099 在 `specs/001-personalized-learning-coach/contracts/coach-api.openapi.yaml`、`coach-result.schema.json`、`coach-tools.schema.json`、`coach-sse.md` 和 `server/apps/ai/test/contract/coach-contract-artifacts.spec.ts` 完成实现后合同同步检查（Req: FR-020, FR-032, SC-002；Verify: OpenAPI/JSON Schema 解析与所有示例测试通过，生成器运行后无 diff）。
- [x] T100 [P] 按 `specs/001-personalized-learning-coach/quickstart.md` 的 Build and Static Validation 执行 `server/package.json` 与 `apps/web/package.json` 构建/type-check 脚本，并把命令、版本和退出码写入 `specs/001-personalized-learning-coach/evidence/build.md`（Req: SC-012；Verify: `pnpm --filter @en/server build`、`pnpm --filter @en/web type-check`、`pnpm --filter @en/web build-only` 全部为 0）。
- [x] T101 [P] 按 `specs/001-personalized-learning-coach/quickstart.md` 在一次性数据库验证 `server/prisma/migrations/202609020001_personalized_learning_coach/migration.sql` 和 `server/prisma/backfills/coach-learning-state.ts` 的迁移、回填、重复运行及旧字段快照，并写入 `specs/001-personalized-learning-coach/evidence/migration.md`（Req: FR-065–FR-066, SC-006, SC-012；Verify: 报告含迁移退出码、前后计数、唯一性和 legacy 快照）。
- [x] T102 [P] 运行 `server/apps/ai/test/contract/`、`workflow/`、`integration/`、`security/`、`governance/` 和 `server/libs/learning/src/**/*.spec.ts` 的全量测试，并在 `specs/001-personalized-learning-coach/evidence/server-tests.md` 记录命令/版本/结果（Req: FR-001–FR-074, SC-001–SC-011；Verify: 全部确定性门禁通过，任何失败保持任务未完成）。
- [x] T103 [P] 运行 `apps/web/src/**/__tests__/` 和 `apps/web/e2e/coach-streaming.spec.ts`，在 `specs/001-personalized-learning-coach/evidence/web-tests.md` 记录浏览器 trace/截图和状态覆盖（Req: FR-032–FR-040, FR-064, SC-010；Verify: Vitest/Playwright 退出码为 0，敏感 DOM/网络扫描为 0）。
- [x] T104 [P] 在 `server/apps/server/test/existing-flows-regression.e2e-spec.ts` 和 `apps/web/e2e/existing-flows-regression.spec.ts` 覆盖登录/刷新、词典、已购课程、10 词学习、批量掌握、普通 AI 模式和非 AI 页面，并写入 `specs/001-personalized-learning-coach/evidence/regression.md`（Req: FR-023–FR-024, SC-012；Verify: 旧公开合同/计数无未经批准变化，Coach flags 关闭时旧功能仍可用）。
- [x] T105 在 `specs/001-personalized-learning-coach/implementation-evidence.md` 汇总 Schema/OpenAPI、迁移计数、测试、50–100 条评测、批准预算/基线、Trace/脱敏、浏览器和已知偏差，并逐项回链 FR/SC/Task ID（Req: FR-049–FR-074, SC-001–SC-012；Verify: 每个 FR-001–FR-074 和 SC-001–SC-012 至少有一条实际证据或明确未完成阻塞，禁止推测结果）。
- [x] T106 在 `specs/001-personalized-learning-coach/release-readiness.md` 记录 `COACH_ENABLED`→`COACH_LIVE_MODEL_ENABLED`→`COACH_WRITE_ENABLED` 的分阶段开启条件、关闭回滚、不可逆学习记录保护和未满足门禁，保持迁移为 additive（Req: FR-042–FR-048, FR-060, SC-007–SC-012；Verify: 缺任一安全/迁移/预算/评测证据时 write flag 检查失败，关闭 flags 后旧流程回归通过）。

**Final Checkpoint**: 只有 T001–T106 全部完成且 `implementation-evidence.md` 无未解决阻塞，Implement 阶段才能宣称功能完成。

---

## Dependencies & Execution Order

### Phase Dependencies

1. **Phase 1 Setup** 无业务前置，可立即开始。
2. **Phase 2 Foundational** 依赖 Phase 1，完成前阻塞全部用户故事。
3. **US1** 依赖 Foundational，构成 read-only MVP。
4. **US2** 依赖 US1 的 profile/material 能力。
5. **US3** 依赖 US2 的 owned exercise，完成 P1 学习闭环。
6. **US4** 的测试/客户端可在 Foundational 后用 fixtures 并行开发；最终集成依赖 US1–US3 的请求和写状态。
7. **US5** 依赖 US1 的推荐结果和 US3 的学习更新事实。
8. **US6** 的 Trace/治理基础可在 Foundational 后并行；完整评测/发布门禁依赖 US1–US5。
9. **Polish** 依赖计划发布的全部用户故事和 US6 发布门禁。

### User Story Dependency Graph

```text
Setup → Foundational → US1 → US2 → US3 ─┬→ US5 ─┐
                     └────────→ US4 ─────┤       ├→ US6 final gates → Polish
                     └────────→ US6 infra┘       │
                                  US1–US5 evidence┘
```

### Within Each User Story

- 先创建测试并确认其因能力缺失而失败。
- Schema/模型约束先于 Service，Service 先于工具适配器，工具先于工作流/API 集成。
- 业务写入先证明事务/归属/幂等，再接入图与前端。
- 每个故事达到其 Independent Test 后再进入依赖它的故事。

---

## Parallel Opportunities

### US1

- T024–T027 可并行编写测试。
- T028 profile 与 T029 materials 可并行；T031 Prompt/model 可在共享合同完成后并行。
- T034 前端 API 可与后端 services 并行，T035–T036 随后串行集成。

### US2

- T037–T040 可并行。
- T041 due service 与 T043 exercise service/prompt 可并行；T042/T044 分别依赖对应 Service。
- T046 可基于共享合同与 fixtures 与后端分支并行。

### US3

- T047–T053 可按不同测试文件并行。
- T054 scheduler 与 T055 grader 可并行；T057 attempt 需等待 scheduler/grade 数据合同。
- T061 可用 contract fixtures 与 T056–T060 并行开发，最终用 e2e 对接。

### US4

- T062–T065 可并行。
- T066 event service、T069 cancel/retry 和 T071 frontend stream 可并行；随后集成 controller/processor/store/UI。

### US5

- T074–T075 可并行。
- T076 policy 与 T079 UI 可基于合同并行；T077–T078 串联业务结果。

### US6

- T081–T085 可并行编写测试。
- T086 Trace、T087 cost、T089 failure、T091 retention、T093 fixtures、T094 expected paths 和 T095 rubrics 修改不同文件，可并行推进。
- T096–T098 在数据、rubric、Trace 和 cost 完成后串行形成发布门禁。

---

## Requirement Traceability Summary

| Requirement group | Primary tasks | Verification evidence |
|-------------------|---------------|-----------------------|
| FR-001–FR-010 controlled/authenticated workflow | T007, T016–T023, T024, T026, T032–T033, T049, T059 | Auth/security e2e + graph path tests |
| FR-011–FR-015 personalization | T025, T028–T032, T038, T043, T074–T079 | Paired-user tests + profile/material unit tests |
| FR-016–FR-024 identity/authorization/business layer | T006–T007, T014, T016–T017, T024, T030, T051, T060 | Contract scans + cross-user tests + dependency boundary checks |
| FR-025–FR-032 tools/structured output | T006, T014–T015, T026, T029–T032, T037–T045, T048–T059 | Tool/result contracts + invalid-output/fallback tests |
| FR-033–FR-040 streaming/cancel/retry | T062–T073 | SSE contract + recovery integration + Vitest/Playwright |
| FR-041–FR-048 governance/idempotency | T009–T010, T018–T022, T050, T063, T069–T070, T083, T087–T089 | Limit/fault/idempotency/transaction tests |
| FR-049–FR-054 observability/feedback | T010, T022, T080–T082, T086, T090, T098 | Trace completeness + redaction + feedback linkage |
| FR-055–FR-061 privacy/lifecycle | T027, T031, T082, T084, T089–T092 | Context minimization + retention/deletion + leak scan |
| FR-062–FR-066 learning state | T008, T011–T013, T047–T061, T078 | SM-2/property + migration/backfill + atomic save tests |
| FR-067–FR-074 AI evaluation | T004, T085, T093–T098 | Versioned 50–100-case deterministic/live report and gates |
| SC-001–SC-012 | T024–T106 | Story checks plus final implementation evidence |
| DEP-001–DEP-008 | T001–T023, T025, T038, T047, T084, T087, T097 | Foundation gates, declared degradations, baseline approval |

---

## Implementation Strategy

### MVP First

1. 完成 Phase 1 Setup。
2. 完成 Phase 2 Foundational。
3. 完成 US1（T024–T036）。
4. 停止并运行 US1 Independent Test；仅开启 `COACH_ENABLED` 的 read-only/mock 或已批准 live 路径，保持 `COACH_WRITE_ENABLED=false`。

### Incremental Delivery

1. US1：认证、画像、材料、讲解与纠错。
2. US2：有依据的练习生成，仍不更新学习状态。
3. US3：有效批改后的原子/幂等学习闭环。
4. US4：完整 SSE、取消、重连和重试体验。
5. US5：推荐和状态变化可解释性。
6. US6：完成 Trace、生命周期、50–100 条评测、成本/时延基线及发布门禁。
7. Phase 9：全量回归和分阶段开关验证。

### Release Discipline

- `COACH_WRITE_ENABLED` 只能在迁移/回填、事务幂等、安全零失败、生命周期、批准预算和 live evaluation 均有实际证据后开启。
- 任何 Prompt、模型、Schema 或工具合同变化均重新运行 T085、T096–T098 和受影响故事测试。
- 不得用预计、外推或未执行结果勾选任务；缺证据时保留未完成并记录阻塞。

---

## Notes

- 所有 `[P]` 任务仍需满足其阶段/前置依赖；标记仅表示文件冲突允许并行。
- 测试任务必须先失败再实现，安全与确定性门禁不得依赖模型评分。
- 第一版材料检索不是 pgvector RAG；grammar 无真实来源时必须降级。
- `save_attempt` 始终是唯一 Coach 学习写工具。
- 现有 generic `/ai/v1/chat`、课程、词典和旧学习流程必须保持兼容。
- 本任务列表不授权安装依赖、执行迁移、部署、提交或推送；这些动作须在获准的 Implement 阶段按任务执行。

### 2026-09-15 历史与管理接线

- [x] CM-01 增补历史消息的 requestId/反馈公开投影及契约，不泄露内部请求字段。
- [x] CM-02 会话列表、新建、切换、消息分页与完整临时状态重置，防止迟到结果混写。
- [x] CM-03 历史/新回答反馈、单会话删除与全部 Coach 数据删除确认、失败恢复。
- [x] CM-04 增加入口及会话隔离/分页/反馈/删除验证，完成类型、构建和相关回归并记录证据。

- [x] CM-05 修复旧数据库 Trace 主体列非空约束与现有删除契约不一致的问题，新增兼容迁移并在本机验证删除。

CM-01–CM-05 验收：`docs/reviews/2026-09-15-coach-management.md`。

### 2026-09-15 引用与打卡补齐

- [x] LC-01 单词安全读取、词条定位与课程高亮，处理失效和不支持来源。
- [x] LC-02 每日唯一打卡表与事务计数，接课程、Coach 作答和可靠发音结果。
- [x] LC-03 查询学习状态与顶栏自动刷新，显示累计天数和今日状态，隔离账号切换。
- [x] LC-04 确定性、浏览器及真实本地数据库验证，回归并记录边界。

LC-01–LC-04 验收及当前来源授权边界：`docs/reviews/2026-09-15-citation-study-day.md`。
