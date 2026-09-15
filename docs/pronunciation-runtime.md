# 发音评测运行与验证

对应 `specs/003-pronunciation-assessment` 的 FR-089～095 / T110～T122。支持手动英文、单词本、Coach 练习；课程与 RAG 内容仍需要单独的内容使用权适配器，不因购买或检索权限自动开放。

## 完整流程

登录后从导航栏“发音”进入 `/en/pronunciation`。选择 en-US / en-GB、输入最多 30 词 / 200 字符的英文，准备练习 → 练习发音 → 听参考发音 → 开始录音 → 完成录音 → 使用这段录音。录音仅在最后一步提交到服务器。单词本、Coach 题目入口也使用相同流程。

服务器保存私有隔离音频，通过 ffprobe 检查单音轨/容器/编码，通过 ffmpeg 解码为 16 kHz 单声道 PCM，再生成长度明确的 WAV，检查实际时长、静音、低音量。允许 WebM/Opus 和 MP4/AAC，500～30000 ms、上传最多 8 MiB。浏览器 WebM 缺失时长时以实际 PCM 长度为准；超长音频会被拒绝，不截断为合格录音。参考发音使用浏览器语音合成，实际语音取决于设备所装语音。

草稿允许 15 分钟；提交时以原子状态变更设定 60 秒总处理期限，重复提交不延长。后台每秒补投递 QUEUED 记录；worker 原子领取后调用 Azure，单次调用最多 30 秒。取消、删除、来源失效或超时均禁止落入可用结果。崩溃中的 PROCESSING 到期终结，不自动重复计费。用户重试会创建新的关联评测。

历史可分页查看结果、逐词定位回放、仅删除录音或删除完整评测。录音最多保留 24 小时；清理每 30 秒执行，失败会重试。可靠且可映射到词库的词才有资格更新学习记录，手动文本不伪造词库关联。学习写入采用现有事务和幂等约束；失败后每 30 秒恢复，按原完成时间计算，不重新评测。

## 配置（不要提交密钥）

配置模板在根目录 `.env.example`。Nest 从**运行工作目录**的 `.env` 读取；本地 `pnpm --filter @en/server ...` 对应 `server/.env`，容器对应 `/app/.env` 或注入环境变量。复用现有数据库、MinIO、Redis 连接。2026-09-15 已使用用户配置的 eastasia F0 资源完成有限合成录音实测；服务仅在本机启动，未部署到公网。

- Azure：`AZURE_SPEECH_ENDPOINT`、`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`。区域必须和 `PRONUNCIATION_PROVIDER_REGION` 一致。终结点可直接粘贴门户的 `https://eastasia.api.cognitive.microsoft.com/`，两个区域字段均填 `eastasia`；程序自动转换为区域短音频 STT 地址。也支持 `https://资源名.cognitiveservices.azure.com/`。已有 `AZURE_SPEECH_RESOURCE_NAME` 配置仍兼容；填写完整终结点时资源名可留空，完整终结点优先且错误时不会回退。仅接受 HTTPS 基础地址，不接受附加路径、查询参数或非 Azure 域名。
- 独立私有 MinIO 桶：`PRONUNCIATION_AUDIO_BUCKET`。禁止公共访问，已有 lifecycle 必须覆盖 `pronunciation/` 前缀、一天过期；应用只检查，不自动放宽策略。连接使用已有 `MINIO_*` 配置。
- 转码：`PRONUNCIATION_FFMPEG_PATH` / `PRONUNCIATION_FFPROBE_PATH` 必须是绝对路径。Dockerfile 已声明 ffmpeg，Alpine 镜像通常为 `/usr/bin/ffmpeg` / `/usr/bin/ffprobe`。子进程禁止 shell、限制为 pipe 协议、单线程、10 秒总超时、3 MiB 输出、128 MiB 单次分配上限；**整个进程的内存上限须由容器资源限制施加**，`-max_alloc` 不是总内存限制。
- Redis：已有 `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`，另指定 `PRONUNCIATION_REDIS_DB`，worker、队列、取消和额度使用同一连接配置。预算必须使用持久化、禁止淘汰的 Redis；丢失计数器不能作为获得新预算的方式。
- 版本与证据：区域、身份模式、适配协议、隐私、价格和预算版本必须可审计。按 FR-093，Azure REST 使用 `PRONUNCIATION_MODEL_IDENTITY_MODE=AZURE_MANAGED` 和 `PRONUNCIATION_PROVIDER_MODEL_VERSION=azure-speech-managed:unversioned`，明确底层模型版本未公开；它不代表可固定的模型 revision。不要虚填 `PRONUNCIATION_MODEL_IDENTITY_*` 供应商证明；实际拥有可验证证据时才使用 `VENDOR_ATTESTED` 模式。
- 金额：`*_MICROS` 为所选币种的百万分之一。`PRONUNCIATION_PRICE_MICROS_PER_SECOND` 与最小计费时长必须来自该区域已确认价格；价格有效期用 ISO 日期。配置单次、用户日、系统日、系统月四项上限，预算按 UTC 日/月统计，调用前原子预留，未知受理或结算故障保留预留金额。
- `PRONUNCIATION_TRACE_PEPPER`：非空私有 HMAC 密钥；须在所有实例保持一致，以匹配删除任务，避免未迁移就轮换。

先配置真实依据，再按模板打开 capture → upload（存储、转码获批）→ provider（区域、身份、隐私、价格、预算获批）→ result display。学习写入和 Coach 摘要另需评测批准版本，按规格逐步开启。前端通过经过身份校验的 `GET /ai/v1/pronunciation/capabilities` 获取可用状态，不再依赖 VITE 构建时开关。缺少配置时页面显示暂未开放，历史仍可读。

## 不泄露配置值的本地检查

```sh
pnpm --filter @en/server exec node --import tsx tools/check-pronunciation-config.ts
# 指定已有配置文件时：
PRONUNCIATION_ENV_FILE=/absolute/path/to/runtime.env pnpm --filter @en/server exec node --import tsx tools/check-pronunciation-config.ts
```

检查只输出缺失的变量名称、开关与可执行文件状态，不发网络请求；退出码 2 代表尚未就绪。它不代替 MinIO 策略、Azure 资源及真实声音的上线验收。

## 可复现验证

```sh
pnpm --filter @en/server exec jest --runInBand --testPathPatterns='pronunciation|ai-module-composition'
PRONUNCIATION_TEST_REDIS_BINARY=/absolute/path/to/redis-server pnpm --filter @en/server exec jest --runInBand --testPathPatterns=pronunciation-redis-runtime
pnpm --filter @en/web test:unit
pnpm exec playwright test apps/web/e2e/pronunciation-runtime.spec.ts --project=chromium
```

Redis 用例创建独立、无持久化的本地 Unix socket 实例，只对该实例清库，结束后销毁。浏览器用例使用真实 MediaRecorder 录制合成音，接口由本地测试替身拦截，覆盖准备、录音、上传、轮询、结果和历史；这些证据不等于真实 Azure 评分质量或实际 ffmpeg 二进制端到端验证。已有发音评测数据集和对齐、可靠性、建议等评估仍随 Jest 发音测试运行。

Azure REST 端点、WAV 格式和评分字段依据：[Microsoft Speech 短音频 REST 文档](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short)。

区域短音频评测地址依据：[Azure 官方发音评测示例](https://github.com/Azure-Samples/Cognitive-Speech-TTS/blob/master/PronunciationAssessment/Python/sample.py)。

## 本机数据库、存储与 Redis

`compose.pronunciation.local.yml` 使用项目独立数据卷，仅映射本机 `127.0.0.1:19000/19001`（MinIO）、`127.0.0.1:16379`（Redis）和 `127.0.0.1:15432`（PostgreSQL）。凭据从 `server/.env` 读取，不写入 Compose。Redis 使用 AOF 每次同步和 noeviction。MinIO 从官方 2025-10-15 安全修复源码构建；官方仓库已归档，本配置只用于本地验证，不能直接作为生产部署方案。

```sh
docker compose --env-file server/.env -f compose.pronunciation.local.yml up -d --build
pnpm --filter @en/server exec node --import tsx tools/setup-pronunciation-local.ts
```

初始化工具仅允许上述本地地址，创建独立 `pronunciation-private` 桶和一天过期规则，拒绝覆盖已有访问策略。以合成音验证真实 WebM 转码、私有上传/读取/删除、匿名读取被拒绝、Redis 读写及持久化设置；不调用 Azure、不改变功能开关。若检查中断，需修复后重跑，不能把创建配置文件等同于服务已通过验收。

## 当前可用状态与启动

本机已通过真实 PostgreSQL、Redis、MinIO、ffmpeg 和 Azure F0 的完整评测。录音、上传、评分、逐词反馈、历史回放、取消、重试、删除与后台清理均有实测。核心 capture/upload/provider/result display 开关已开启；学习自动写入、学习 shadow、Coach 自动摘要仍关闭，避免未经真人质量基线验证就修改学习掌握度。具体证据见 [本机验收记录](reviews/2026-09-15-pronunciation-live.md)。

本机 `server/.env` 已配置 `LOCAL_POSTGRES_PASSWORD`、`DATABASE_URL`、`AI_DATABASE_URL`、`SECRET_KEY` 和上述服务凭据。两个数据库 URL 指向同一项目独立的本地数据库；这是新数据库，不包含其他环境的账号。登录页可正常注册自己的账号，无需使用测试账号。七个已有迁移已执行。

当前服务正在运行。电脑重启后，在项目根目录启动 Docker 服务并运行：

```sh
docker compose --env-file server/.env -f compose.pronunciation.local.yml up -d
pnpm run all
```

页面为 `http://127.0.0.1:8080/en/pronunciation`。本地开发启动和后端构建会自动编译共享契约的 Node 运行产物；未配置支付服务时只禁用支付，不阻止学习服务启动。只有更换为新的空数据库时才需要重新执行项目迁移。不要将本机 `.env` 提交到 Git。

本机 F0 配置：`AZURE_SPEECH_TIER=F0`、每秒价格为 0、最小计费单位 1 秒。项目额外限制每用户每天 300 秒、全站每天 1800 秒、全站每月 14400 秒（4 小时），同一资源最多一个进行中的调用。额度按 UTC 统计，音频时长向上取整，发出前失败可释放，未知是否受理保留额度。F0 单价为零也必须遵守时长额度；本项目不统计同一 Speech 资源被其他应用消耗的用量。当前价格配置有效期至 2027-01-01，到期需复核更新；账户切换为 S0 时也必须先按实际价格重新配置，不能沿用零单价。

Microsoft 的 F0 标准语音转文本免费配额为每月 5 小时，基础发音评测按标准转文本计量；本项目采用更低的 4 小时上限作为余量，不启用额外收费的韵律评测。参见 [Speech 定价](https://azure.microsoft.com/en-us/pricing/details/speech/) 和 [服务配额](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits)。实时评测数据处理说明见 [Microsoft 隐私说明](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/speech-to-text/data-privacy-security)。

MinIO/Redis/PostgreSQL 使用持久化 Docker 数据卷。停止容器不要添加 `-v`，否则会删除数据库、录音和额度记录。MinIO 镜像仅用于本机验证；本机启动成功不代表已完成公网部署、生产容量和真人口音质量验收。

## 可选的真实服务回归

以下检查会向已配置的 Azure F0 上传短合成录音，默认不运行。先准备 `/tmp/en-pron-live-speech.webm`（英文 “Good morning. I would like a cup of coffee.”、WebM/Opus），启动上述真实本地服务后运行：

```sh
PRONUNCIATION_RUN_LIVE_CHECK=true pnpm --filter @en/server exec node --import tsx tools/check-pronunciation-live.ts
PRONUNCIATION_LIVE_BROWSER=true pnpm exec playwright test apps/web/e2e/pronunciation-live.spec.ts --project=chromium
```

HTTP 工具创建随机本地联调账号并验证真实评分、历史、私有回放、匿名拒绝、取消和删除；仅本机 F0 和 15432 数据库允许运行。浏览器工具使用该账号，以合成语音替代麦克风输入，实际执行 MediaRecorder→上传→Azure→结果→回放→删除，不拦截业务 API。私有临时会话文件 `/tmp/en-pron-live-session.json` 包含测试账号令牌，权限为 0600，浏览器测试不录制 trace；验证后可删除该文件。真人麦克风与多口音公平性仍需单独验证。
