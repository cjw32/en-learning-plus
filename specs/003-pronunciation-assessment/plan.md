# Implementation Plan: AI 发音评测

**Branch**: `003-pronunciation-assessment`（Spec Kit 逻辑分支；当前 Git 工作分支仍为 `codex/rag-source-citations`） | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-pronunciation-assessment/spec.md`

**Status**: Complete — Ready for Tasks only after explicit user acceptance of this Plan

**Scope of this artifact**: 本计划只定义技术方案、契约、数据模型、验证路径与发布门槛；不安装依赖、不修改生产配置、不迁移数据库、不调用真实 Provider、不推送或部署。

## Summary

在现有 Vue/NestJS/PostgreSQL/Redis/MinIO 学习平台上增加一次性浏览器录音、异步发音评测与学习闭环。前端使用浏览器原生 `MediaRecorder`、Web Audio 与现有 Axios/Pinia；AI 服务复用现有 JWT 主体、BullMQ、Redis 治理、Prisma、MinIO 客户端和学习调度能力，但以独立 `pronunciation` 模块、队列、Trace 和 Provider 适配边界承载语音敏感数据，不让原始音频进入 Coach/LangGraph。

首发 Provider 的实现候选为 Azure Speech Pronunciation Assessment 短音频 REST，使用 Node 原生 `fetch` 调用，避免引入 Provider SDK。浏览器上传的 WebM/Opus 与 MP4/AAC 必须在调用 Provider 前由受限的音频工具链验证并转换为 16 kHz、单声道、16-bit PCM WAV；仓库当前没有该工具链，因此 `ffmpeg`/`ffprobe` 运行时能力属于后续需要用户明确授权的依赖门槛。Provider 地域、零留存/禁训、动态价格预算及不可伪造的底层模型身份未全部批准前，功能与学习写入均默认关闭并 fail closed。

## Technical Context

**Language/Version**: Web 为 TypeScript `~6.0`、Vue `^3.5`；服务端为 TypeScript `^5.7`、NestJS `^11`，Node.js `^20.19 || >=22.12`（服务端类型基线 Node 24）

**Primary Dependencies**: 只计划复用现有 Vue Router、Pinia、Axios、Element Plus、NestJS、Prisma 7、BullMQ 5、ioredis 5、MinIO 8、Zod/`@en/common`；浏览器侧使用原生 MediaRecorder/Web Audio；Provider 通过 Node 原生 `fetch`/`AbortController` 调用。音频探测与转码所需 `ffprobe`/`ffmpeg` 当前不存在，未经授权不得安装

**Storage**: PostgreSQL 保存评测、目标、版本化结果、Provider 调用、学习投影与删除审计；Redis 保存限流、单并发、取消信号和 BullMQ 状态；复用现有 MinIO 集群/客户端但必须使用新建的私有专用 bucket，原始音频最长 24 小时且不进入普通备份

**Testing**: 服务端 Jest 30/Supertest，Web Vitest 4/Vue Test Utils，端到端 Playwright 1.62；确定性 fake Provider、伪造音频探测器和授权离线评测集；真实 Provider 测试仅在预算、凭据、数据授权和区域批准后单独启用

**Target Platform**: Linux Node 服务；桌面 Chrome/Edge/Firefox/Safari 与 Android Chrome/iOS Safari 的当前及前一个稳定大版本，按运行时能力检测而不是 User-Agent 放行

**Project Type**: pnpm monorepo Web 应用 + NestJS API/异步 Worker + 共享学习领域库

**Performance Goals**: 录音控制反馈不超过 300 ms；上传完成到终态 P95 不超过 15 s；Provider 硬超时 30 s；音频不超过 30 s/8 MB且不少于 500 ms；目标不超过 30 个英文词或 200 字符

**Constraints**: 每用户 1 个处理中评测、6 次/分钟、120 次/天；同一逻辑评测通常最多 1 次 Provider 调用；可信度 `<0.60` 拒绝、`0.60–0.79` 仅参考、`>=0.80` 才可能写学习状态；未知价格/版本/预算/区域/隐私条件一律关闭调用；用户身份只取 JWT；音频不得进入 Prompt、日志、Coach 记忆或普通备份；取消后的迟到结果不得写入

**Scale/Scope**: 第一阶段覆盖单词、短语、单句；单次最多 30 个目标词；一个主 Provider。契约覆盖 WordBook、Course、Coach、RAG 与手动来源，但安全生产 MVP 仅开放 WordBook、手动文本和平台自有 Coach 目标；Course/RAG 等待第三方处理用途授权。不含实时流式纠音、段落、多人、视频或自研模型

## Constitution Check

`.specify/memory/constitution.md` 仍是未填写的模板，没有可执行的项目级原则。为避免把模板当成批准规则，本计划以 `develop-ai-learning-feature` 的 SDD 规则、已确认规格和用户本轮限制作为门禁。

### Phase 0 前门禁

| Gate                  | Result | Evidence / treatment                                                                                  |
| --------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| 仓库边界              | PASS   | 已核对当前仓库为 `en-learning-plus`；所有产物均位于 `specs/003-pronunciation-assessment/`             |
| SDD 顺序              | PASS   | 已有 `spec.md` 且状态为 Ready for Plan；本阶段只生成 Plan 产物，不创建 `tasks.md` 或实现代码          |
| 现有架构优先          | PASS   | 复用现有 JWT、NestJS、Prisma、Redis/BullMQ、MinIO 客户端、`LearningAttempt` 和 SM-2 调度器            |
| 主体不可变            | PASS   | 所有公开契约均不接受 `userId`；资源所有权由服务端认证主体重新验证                                     |
| AI 输出不直写         | PASS   | Provider 原始响应经适配、Schema、业务一致性、置信度和权限门禁后才可能进入学习事务；LLM 不生成核心评分 |
| 成本/隐私 fail closed | PASS   | Provider 调用默认关闭；价格、预算、地域、零留存/禁训、模型身份缺任一项即拒绝调用                      |
| 不越权变更            | PASS   | 本阶段不新增依赖、不改生产配置、不编码、不推送、不部署                                                |

### Phase 1 后复核

设计产物维持以上门禁，且增加了以下实现前阻断项：

1. 获得用户对 `ffmpeg`/`ffprobe` 运行时依赖及沙箱资源上限的明确授权，或批准一个同等安全、已审计且兼容两种浏览器容器的既有能力。
2. 取得可审计的 Provider 底层模型/评分引擎身份；不得用 REST API 版本冒充 `modelVersion`。无法取得时生产调用保持关闭。
3. 批准 Provider 区域、分包/隐私条款、零留存/禁训证据，以及版本化的单次、用户日、系统日、系统月预算和区域价格目录。
4. 批准创建私有音频 bucket 及其生命周期/备份排除配置；现有 `avatar` 公共读 bucket 不得复用为音频存储。
5. 授权并完成专项数据集评测；零容忍安全项、错误学习写入、取消后写入、伪造维度或口音公平门槛任一失败均阻断发布。

**Post-design result**: PASS for planning; BLOCKED for production enablement until the five explicit gates above are approved and verified.

## Architecture

```text
Vue recording UI
  │ target intent + browser audio + idempotency key
  ▼
Nest pronunciation API ── JWT/ownership/admission/budget gates
  │                         │
  │                         └─ PostgreSQL: target + assessment + trace
  ▼
private MinIO quarantine object (TTL ≤24h, never public)
  │ assessmentId only
  ▼
BullMQ pronunciation-assessment worker
  │ cancel/deadline → ffprobe validation → ffmpeg canonical WAV
  ▼
PronunciationAssessmentProvider adapter
  │ Azure short-audio REST candidate; one normal call
  ▼
deterministic adapter → JSON Schema → alignment/confidence policy
  │
  ├─ rejected / reference-only result (no learning write)
  └─ eligible result (confidence ≥.80 + all gates)
       ▼ single PostgreSQL transaction
     PronunciationAssessment ↔ LearningAttempt
       └─ pronunciation review events / SM-2 item state
```

### Boundary decisions

- `server/apps/ai/src/pronunciation` owns HTTP, orchestration, queue, audio pipeline, Provider adapter, governance and pronunciation-specific Trace. It does not enter the Coach LangGraph.
- `server/libs/learning/src/pronunciation` owns authoritative target resolution, deterministic learning projection, compensation/recalculation and exposure of minimal Coach facts.
- `packages/common/pronunciation` owns versioned strict Zod contracts used by Web and service, plus deterministic JSON Schema generation; external raw response types stay private to the adapter.
- PostgreSQL is the durable authority for state and idempotency. Redis coordinates, but loss of Redis cannot manufacture a successful assessment or learning write.
- MinIO infrastructure/client is reused, not the existing public avatar bucket/policy. Audio keys are random, never derived from user text, and playback is authenticated server streaming with `private, no-store` response headers.
- The UI polls the durable assessment resource after a `202` response. Existing Axios upload progress and bounded polling are sufficient; v1 does not need a new realtime transport or dependency.

## Request and processing flows

### 1. Create an assessment and resolve an authoritative target

`POST /ai/v1/pronunciation/assessments` accepts one discriminated source intent (`WORD_BOOK`, `COURSE_WORD`, `RAG_CITATION`, `COACH_EXERCISE`, `MANUAL`) and locale, never a user identifier. The server resolves WordBook text, validates Course ownership, re-authorizes an active KnowledgeCitation and selection offsets, or validates Coach ownership. Manual text is normalized and labeled manual; it cannot claim a resource/source association. The immutable target snapshot stores reference text, normalized tokens, source/version evidence and access evidence. Access, content rights and source status are checked again before Provider admission and before learning write.

### 2. Upload and submit

`PUT /ai/v1/pronunciation/assessments/{id}/audio` accepts multipart field `audio`; `POST .../{id}/submit` queues the assessment. Mutations carry an `Idempotency-Key`, and a server-computed body/content hash enforces same-key/same-content replay and same-key/different-content conflict. An authentication/admission guard runs before body buffering; the upload interceptor uses a strict 8 MB memory limit and immediately moves the object to a private quarantine key. The database reaches `AUDIO_READY` before an assessment ID is enqueued. Queue payload is only `{ assessmentId }`.

### 3. Validate, normalize and assess

The worker rechecks cancellation, deadline, durable state, source rights and budget. A sandboxed probe verifies magic bytes, container, codec, duration, channels, sample rate and decode work; a constrained conversion emits canonical 16 kHz mono 16-bit PCM WAV. Raw quarantine bytes are deleted after replacement. Static quality rules reject silence, clipping, insufficient speech and malformed media before the Provider call.

The adapter sends only reference text, locale, canonical audio and a random technical connection ID. It returns a provider-neutral result. The normal path has one external call; one automatic retry is allowed only when the first request is provably unaccepted or Provider idempotency is contractually reliable. Unknown acceptance is billable/audited and not automatically retried.

### 4. Normalize, validate and project

The adapter maps Azure scripted/HundredMark/word-level comprehensive assessment into the internal contract. A versioned deterministic normalizer and sequence aligner preserves target position, handles insertions/omissions and validates timestamps. Confidence is conservatively computed as the minimum of a valid Provider recognition-confidence signal and deterministic alignment coverage after all structural/audio checks; the policy is versioned and separately calibrated before release.

- `<0.60`: terminal `UNRECOGNIZABLE`; no full result or learning write.
- `0.60–0.79`: `REFERENCE_ONLY`; clearly labeled feedback only.
- `>=0.80`: eligible, but only if source, schema, timestamps, cancellation, version and all learning rules still pass.

Eligible word results use the existing `AttemptService.qualityFromScore` thresholds instead of inventing a second scale: `90–100→5`, `75–89→4`, `60–74→3`, `40–59→2`, `1–39→1`, omitted/no confirmed score `→0`. Only reliably aligned target words with a WordBook identity participate; inserted/uncertain tokens and unlinked manual words are excluded. Repeated positions for the same learning item use the lowest quality, matching current attempt semantics. The mapping is pinned as `pronunciation-quality.v1` and must be calibrated before write enablement.

### 5. Cancel, retry and delete

- Cancel records a durable timestamp, removes queued work where possible and signals Redis/AbortController. A late Provider result may be charged but is discarded for learning purposes.
- Retry creates a new logical assessment linked to the prior one unless it is a safe replay of the same idempotent mutation; history is never overwritten.
- Audio-only deletion immediately revokes playback and queues object/cache deletion while retaining structured result and historical learning evidence.
- Full assessment deletion immediately hides details, revokes audio, and recomputes affected pronunciation item state from remaining non-void events. A separate recalculation audit stores before/after snapshots and pinned rule versions; old evidence is voided/purged only after successful compensation, so history is not silently rewritten.

## Provider selection and rollout

Azure Speech Pronunciation Assessment is the only first-release implementation candidate because the researched Google Cloud Speech-to-Text V2 and Amazon Transcribe contracts provide transcription/timestamps but not the required reference-text pronunciation scores and word miscues. Azure remains an adapter target, not an approved production dependency.

Planned Azure mode:

- short-audio REST with Node native `fetch`, scripted assessment, `HundredMark`, word granularity, comprehensive mode and miscue enabled;
- prosody requested only for supported `en-US` assessments and only after its separate price is approved; otherwise `prosodyScore = null`;
- `en-US`/`en-GB` come from the authoritative target, not browser locale alone;
- Provider API/adapter versions, response request IDs and application connection IDs are recorded separately;
- underlying model identity must be vendor-backed and immutable/queryable. If Azure cannot provide it, the production Provider gate cannot open.

Feature rollout uses independent default-off gates: capture UI, Provider call, structured result display, and learning write. Production-oriented config names are design placeholders only; they are not created or changed in this phase.

## Confirmed plan decisions

These decisions turn the product/engineering recommendations accepted by the user into explicit implementation constraints. A later Tasks phase may decompose them but may not silently reopen or bypass them.

| ID    | Decision                                                                                             | Consequence                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| D-001 | Keep pronunciation inside the existing Web + AI app + learning library, but outside Coach LangGraph  | Reuse platform infrastructure without making prompts or LLMs part of scoring                                                                  |
| D-002 | Production MVP starts with `WORD_BOOK`, `MANUAL` and platform-owned `COACH_EXERCISE` targets         | `COURSE_WORD` and `RAG_CITATION` remain contract-compatible but disabled until explicit third-party pronunciation-use rights exist            |
| D-003 | Azure short-audio REST is the only first adapter candidate; Google/AWS are not fallback scorers      | No provider averaging or hidden fallback; failure is explicit                                                                                 |
| D-004 | `modelVersion` means vendor-attested scoring-engine identity/revision or enforceable release channel | REST API version, region and local labels cannot satisfy the requirement; missing identity keeps production calls closed                      |
| D-005 | Browser formats are accepted only after real server decode validation and canonicalization           | No MIME/magic-only downgrade; absent approved audio runtime fails before Provider invocation                                                  |
| D-006 | Learning starts in shadow mode after result quality approval                                         | The system computes and traces proposed changes without mutating mastery; persisted writes open only after quality/fairness/security approval |
| D-007 | Audio playback is a freshly authorized backend stream                                                | No public or permanent object URL, simpler immediate revocation, no MinIO CORS dependency                                                     |
| D-008 | Extend `LearningAttempt` with an explicit discriminator                                              | No fake Exercise/Submission/Coach rows and no parallel attempt authority                                                                      |
| D-009 | Core scores, confidence, alignment, word status, next action and write eligibility are deterministic | LLM use is optional and limited to wording after facts are frozen; it cannot change facts                                                     |
| D-010 | Full deletion uses event replay plus an auditable recalculation record                               | Current learning state loses deleted evidence without silently rewriting historical facts                                                     |

### First-release target scope

| Target source               | Contract  | Initial runtime status                     | Learning-write eligibility                                                                               |
| --------------------------- | --------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| WordBook                    | Supported | Enabled after audio/Provider gates         | Yes, when a reliable word identity and all write gates pass                                              |
| Manual text                 | Supported | Enabled after audio/Provider gates         | No automatic mastery penalty in v1 because it has no authoritative learning-item identity                |
| Platform-owned Coach target | Supported | Enabled after owned target snapshot exists | Yes only for target words mapped to authoritative WordBook identities                                    |
| Purchased course word       | Supported | Disabled initially                         | Requires an authoritative course word/item, current ownership, and explicit third-party processing right |
| RAG citation span           | Supported | Disabled initially                         | Requires active citation/version/access plus explicit `pronunciationAssessment` usage right              |

This narrowing does not remove the broader contract. It defines the safe production MVP and prevents display rights from being misinterpreted as permission to send content to a third party.

## Progressive enablement plan

Every stage is independently reversible. Moving forward requires recorded evidence; disabling a later stage never makes an earlier stage call a Provider implicitly.

| Stage               | Enabled behavior                                                                                 | Still disabled                                          | Exit evidence                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0. Default off      | Existing product only                                                                            | Capture, upload, Provider, result, learning write       | Existing Coach/RAG/WordBook/Course regression and zero pronunciation calls            |
| 1. Local capture    | Permission notice, continuous recording, local waveform/preview/re-record                        | Server upload and Provider                              | Supported-browser capability/resource-cleanup evidence                                |
| 2. Private pipeline | Authenticated upload, private quarantine, decode/quality validation, deletion with fake Provider | Live Provider and learning mutation                     | Audio attack suite, private-storage policy and retention SLA                          |
| 3. Provider shadow  | Approved Azure call and internal normalized result/Trace                                         | User-visible authoritative result and learning mutation | Model identity, region/privacy, price/budgets, schema/latency/stability baseline      |
| 4. Result display   | Structured scores/word feedback with clear confidence tier                                       | Mastery/review mutation                                 | Usability, accuracy, accent fairness and zero-tolerance safety approval               |
| 5. Learning shadow  | Proposed quality/review changes computed and traced                                              | Persistent `LearningAttempt`/item-state mutation        | Human-reviewed mapping comparison and zero invalid/cancelled/source-expired proposals |
| 6. Learning write   | Atomic `LearningAttempt`/review/item-state updates                                               | Raw audio in Coach                                      | Idempotency, rollback, deletion compensation and regression approval                  |
| 7. Coach follow-up  | Minimal owned structured summary for recommendations                                             | Audio access and scoring authority in Coach             | Cross-user/no-audio tool tests and grounded recommendation checks                     |

Planned independent gates are conceptually `capture`, `upload`, `provider`, `resultDisplay`, `learningShadow`, `learningWrite` and `coachSummary`. Their concrete production configuration is deliberately not added during Plan.

## Compatibility and migration strategy

- Additive schema comes first while all runtime gates are off. Existing `LearningAttempt` rows backfill to `EXERCISE`; no existing request path changes semantics.
- Deploy-compatible code must understand both attempt variants before validating the database XOR constraint. The migration plan uses verification queries before constraint validation.
- Redis remains coordination only. The per-user active uniqueness rule also lives in PostgreSQL so Redis loss cannot create duplicate active facts.
- Existing BullMQ connection differences (global host/port versus Coach password/database configuration) must be reconciled through one validated connection factory before registering the queue; no new environment keys are assumed silently.
- The audio storage adapter validates that a pre-provisioned bucket is private and lifecycle-compliant; it must never create or modify a production bucket policy during application startup.
- Clustered AI processes claim cleanup work durably in PostgreSQL; no single-process timer owns deletion correctness.
- Rollback order is `coachSummary → learningWrite → learningShadow → resultDisplay → provider → upload → capture`. Disabling Provider prevents new calls but preserves owned structured history and continues scheduled deletion.
- Database rollback cannot coerce pronunciation attempts into exercise attempts. If code/schema rollback would remove new fields, retain the additive schema until an explicit retention/export decision is approved.

## Authorization ledger

The plan is complete without guessing these external values. They are explicit enablement inputs whose absence has a defined closed behavior.

| Input                    | Required form                                                                 | Checked at                                 | Missing behavior                             |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------- |
| Audio runtime            | Approved binary identity/version and fixed resource policy                    | startup + every worker execution           | upload/scoring unavailable; no Provider call |
| Private audio storage    | Existing private bucket, lifecycle/backup evidence                            | startup + upload + playback                | server audio persistence unavailable         |
| Provider engine identity | Vendor-attested scoring engine/release channel                                | startup + response validation              | live Provider gate closed                    |
| Region/privacy           | approved region, subprocessor and zero-retention/no-training evidence version | admission                                  | live Provider gate closed                    |
| Content usage right      | rights-policy version permitting third-party pronunciation assessment         | target create + admission + learning write | affected course/RAG target unavailable       |
| Price catalog            | regional, dated version for base assessment and optional prosody              | admission + settlement                     | new call rejected                            |
| Monetary budgets         | positive per-call, subject-day, system-day, system-month caps                 | admission + settlement                     | new call rejected                            |
| Evaluation approval      | dataset/rubric/version plus approved quality/fairness thresholds              | result-display/write rollout               | stage cannot advance                         |

## Project Structure

### Documentation (this feature)

```text
specs/003-pronunciation-assessment/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── requirements-traceability.md
├── contracts/
│   ├── README.md
│   ├── pronunciation-api.openapi.yaml
│   ├── pronunciation-provider.schema.json
│   └── pronunciation-result.schema.json
└── tasks.md                         # future $speckit-tasks output; not created here
```

### Source Code (repository root; planned, not created in this phase)

```text
apps/web/src/
├── apis/pronunciation/
├── components/Pronunciation/
├── hooks/usePronunciationRecorder.ts
├── stores/pronunciation.ts
└── views/{Course/Learn,WordBook,Coach}/

packages/common/pronunciation/
├── api.schemas.ts
├── result.schemas.ts
├── provider.schemas.ts
└── versions.ts

server/apps/ai/src/pronunciation/
├── api/
├── application/
├── audio/
├── governance/
├── observability/
├── provider/
└── queue/

server/libs/learning/src/pronunciation/
├── pronunciation-target.service.ts
├── pronunciation-learning.service.ts
├── pronunciation-quality.policy.ts
└── pronunciation-deletion.service.ts

server/apps/ai/test/
├── contract/pronunciation/
├── integration/pronunciation/
├── security/pronunciation/
└── evals/pronunciation/

server/prisma/
└── schema.prisma                    # future schema change/migration only after approval

tests/
└── pronunciation-assessment.spec.ts
```

**Structure Decision**: 保持现有 monorepo 边界。用户交互放在 Web；共享公开契约放在 `@en/common`；第三方与异步处理留在 AI app；跨 Coach/普通练习复用的学习规则进入 `libs/learning`；不新增服务、仓库或第二套作答事实源。

## Delivery phases

后续由 `$speckit-tasks` 拆分为原子任务时应维持以下依赖顺序；当前阶段不执行任何一项。

1. **契约与默认关闭骨架**：共享枚举/Schema、错误码、Provider port、版本常量、fake Provider、功能开关读取与 fail-closed 测试。
2. **数据模型与迁移设计**：增加 pronunciation 领域表，扩展 `LearningAttempt` 为显式类型联合，先做兼容性迁移/回填/约束验证方案，不改旧练习行为。
3. **目标解析与授权**：WORD/COURSE/RAG/COACH/MANUAL 服务端解析、第三方发音处理用途授权、来源重验、跨用户不泄露测试。
4. **录音 UI**：能力检测、权限说明、连续录制状态机、本地试听/重录、资源释放、上传进度与无障碍反馈。
5. **私有音频管线**：在依赖和私有 bucket 获批后实现上传前 admission、quarantine、探测、受限转码、质量门禁、TTL/删除。
6. **异步评测与治理**：独立 BullMQ、持久状态机、Redis 并发/双窗口限流、预算、取消、超时、幂等与 Trace。
7. **Azure 候选适配器**：在 Provider 门槛获批后实现 REST 映射、模型身份校验、费用计量；默认不开真实调用。
8. **确定性结果管线**：文本规范化、序列对齐、时间戳/分数/矛盾校验、置信度分档、公开结果组装。
9. **学习闭环**：在评测基线和 write gate 获批后，以单事务写入 `LearningAttempt`、复习事件和 item state；实现删除补偿与最小 Coach 摘要。
10. **专项验证与渐进发布**：契约/安全/集成/E2E/离线质量公平性/成本回归，按 capture→Provider→display→learning-write 分闸启用。

## Verification strategy

- **Contract**: OpenAPI 与 JSON Schema 解析；公开请求无 `userId`；Provider 原始字段不能穿透公开结果；可选维度必须为 `null`。
- **Unit**: 录音状态机、目标规范化、重复词对齐、分数/时间戳边界、置信度分档、质量→SM-2 映射、错误映射、幂等 hash。
- **Integration**: PostgreSQL 状态事务、Redis 单并发/频率/预算、BullMQ 重放、MinIO 私有访问/TTL、取消竞态、Provider unknown-acceptance、全删除重算。
- **Security**: 跨用户 CRUD/播放/重试、恶意容器/解码炸弹、播放撤销、日志与 Trace 敏感字段扫描、Prompt/Coach 无音频、来源撤销竞态。
- **Evaluation**: 授权数据集上的 WER、mispronounced/omitted/inserted 指标、时间戳误差、人工一致性、稳定性、口音公平性、拒绝质量、Schema、成功率、P50/P95、费用。
- **Regression**: 功能关闭时 Coach、RAG、WordBook、Course、普通练习全部保持原行为且 Provider 调用数为零。

Requirement-to-design/test/evaluation coverage is recorded in [requirements-traceability.md](./requirements-traceability.md). It is a Plan artifact, not an implementation task list.

## Complexity Tracking

没有项目 Constitution 规则可判定为已违反。新增独立 pronunciation 模块、队列与 Trace 是由音频敏感性、外部调用计费、取消竞态和既有 `CoachTrace` 强绑定 `CoachRequest` 所要求；它们仍位于现有 AI 服务和数据库内，不构成新服务或平行学习系统。
