# 飞书 AI 博客发布

目标：飞书私聊 → OpenClaw/DeepSeek 整理 → 受限发布服务 → blog-page/main → 现有 Docker CI/CD → https://cjw32.xyz/blog/。

当前进度（2026-09-17）：文字博客发布流水线已完成真实验收。官方 OpenClaw 2026.9.4 镜像通过上传归档导入；发布服务和网关通过容器健康检查，OCR 中英文语言包及 GitHub 仓库连接已验证。博客插件 1.4.0 的九项工具已通过真实运行时注册检查，诊断为空，包含全文搜索、原文读取、多轮修改预览、确认保存、删除预览和确认删除。主人已完成飞书配对、真实草稿确认和公开文章发布。图片 OCR 的完整飞书消息流程尚未实测。

验收文章：https://cjw32.xyz/blog/article/ai-4b7084160a947f351a98a8bc 。提交 7b9a138ffc899bc4910da9937323af5786155829；GitHub Actions https://github.com/cjw260/blog-page/actions/runs/35170906275 的 build、deploy 均成功。公网 Markdown SHA-256 与发布任务记录完全一致（12025d4cf326327aa1394ce5cf723f6da348dc029546719bf3c9908a418ace33），发布服务 /status 返回 live。

账号核对发现：本机旧配置与云端旧配置一致（App ID `cli_a9367109ba781bcb`），但当前登录的「陈峻纬／用户616695的飞书」访问该应用返回 403，无法确认其归属。本机旧飞书通道仍禁用。用户已选择在自己的组织新建「CJW 博客助手」，新 App ID 为 `cli_aa20d86dddb9dbb5`。新凭证由用户在服务器隐藏输入并通过 API 验证，云端已重新创建容器切换到新应用。

2026-09-17 09:03：新应用 1.0.0 已发布，范围仅陈峻纬一人，对外共享关闭。开通了 im:message.p2p_msg:readonly、im:message:send_as_bot、im:resource 三项应用权限，订阅 im.message.receive_v1；飞书后台长连接验证成功，两个容器曾确认 running/healthy。主人已发送私聊并提供配对码，待配对请求已核验。配对 CLI 写配置时遇到只读 bind mount 的 EBUSY，随后在宿主机将 dmPolicy 设为 allowlist 并写入唯一的本人 open_id，配置校验通过。

DeepSeek 凭证：用户不认识本机已有密钥，明确要求替换为自己的密钥。旧云端密钥曾比对确认为来自本机配置，但账号归属无法核实，因此暂停网关让用户自行替换。用户现已在服务器通过 `configure-deepseek.py` 隐藏输入自己的密钥，随后已重新创建容器使新 env 生效，并在内存中比对确认容器使用新 env 中的密钥。2026-09-17 09:29，最小模型请求成功，服务实际返回 deepseek-flash（9 输入 token、1 输出 token）；网关 running/healthy，新飞书应用 WebSocket ready，thinking=off。主人已确认飞书真实草稿回复正常，drafts/2026-09-17-feishu-bot-draft.json 已落盘，草稿阶段发布记录为 0；随后飞书确认发布产生任务，文章已上线并通过内容校验。

密钥脚本最初写死了 deepseek-chat，用户两次遇到模型不存在，配置均未写入。现已修复为读取 models 列表并优先选择 deepseek-flash，兼容列表中的 deepseek-v4-flash；缺少 Flash 时让用户从返回列表明确选择，避免自动切换价格档。脚本会同时更新网关模型并保留飞书唯一允许名单。OpenClaw 2026.9.4 的官方适配器仅识别 V4 名称，因此使用官方仍支持的 deepseek-v4-flash 别名调用新版 Flash，thinkingDefault 为 off；不扩展图片上传能力。参考：https://api-docs.deepseek.com/zh-cn/ 。

## 组件与边界

- OpenClaw 使用官方固定版本镜像；飞书通过出站 WebSocket 连接，不映射公网端口。
- 发布服务只接收结构化文章，固定提交到 cjw260/blog-page 的 public/markdown。它用 Git plumbing 创建提交，不检出、不运行仓库代码。
- OpenClaw 通过本项目的专用工具插件调用发布、查找、确认删除、部署校验和 OCR；没有通用终端执行权限，普通文件工具仅能读写博客助手工作目录。
- GitHub 仓库专用写入 deploy key 只挂载给发布服务。不能用服务器部署私钥代替，也不要复制个人 GitHub 全权限 token。
- 文本模型使用既有 DeepSeek API；截图通过 Tesseract 中文/英文 OCR 提取文字。当前不上传原始图片，不能保证复杂版面或模糊截图识别准确。
- 飞书群聊关闭，初始私聊需配对；由主人发送配对码确认身份后再锁定 allowlist。未配对用户没有发布入口。
- 只整理时草稿保存在非公开 workspace/drafts；明确要求发布才提交。同一消息对应固定文章 ID，重试不会产生副本，不覆盖旧文章。
- submitted 表示已提交，只有线上 Markdown 内容校验通过才返回 live。超时应查看博客仓库 Actions，不能宣称发布成功。

## 部署目录

服务器目录 /opt/cjw-ai-blog。运行前需要生成 secrets、state、publisher-data、workspace/drafts；secrets 目录 700，凭证文件 600。设置 .env 中 DEPLOY_UID/GID 与目录所有者一致。

配置模板 openclaw.template.json 不含凭证；实际 openclaw.json 仅引用环境变量。secrets/openclaw.env 包含 FEISHU_APP_ID、FEISHU_APP_SECRET、DEEPSEEK_API_KEY、OPENCLAW_GATEWAY_TOKEN、PUBLISHER_TOKEN；secrets/publisher.env 仅包含 PUBLISHER_TOKEN。

publisher 的 secrets/blog_key 是博客专用 SSH 私钥；github_known_hosts 从 GitHub 官方 /meta 公钥或官方指纹核验后写入，不能关闭主机身份校验。

官方 2026.9.4 镜像未自带 Feishu 插件。已使用官方安装器 `plugins install --pin @openclaw/feishu@2026.9.4` 安装到持久化 state 中，安装记录存储在同一 state 目录的 SQLite 注册表。不能只解压插件并添加 load.paths：这无法建立官方来源记录，也不能正确连接 openclaw peer dependency。安装器使用 state/install-config.json 这一可写配置副本；网关正常运行时使用只读挂载的 openclaw.json。

首次构建 publisher 时，先使用 publisher/Dockerfile 生成基础镜像 cjw-ai-blog-publisher:1，再由 Compose 中的 Dockerfile.runtime 构建运行镜像并匹配服务器 UID/GID。已有基础镜像时不重复下载 apt 包。OpenClaw 同样使用已导入的基础镜像派生匹配 UID 的运行镜像。

新应用凭证由用户在服务器终端运行 `python3 /opt/cjw-ai-blog/configure-feishu.py` 后隐藏输入。脚本验证新 App ID 与 Secret，再原子替换 env 中的两个飞书字段，保留模型和发布服务凭证，不自动启动网关。凭证不进入 Git 或聊天。

完成凭证和权限配置后，运行 `docker compose up -d --no-build --pull never`；更新 env 后需要重新创建容器，不能只 restart。查看 `docker compose ps`；日志可能包含用户素材或敏感信息，不能整段公开粘贴。

## 用户操作

在「用户616695的飞书」中私聊「CJW 博客助手」。当前已绑定陈峻纬本人，群聊与外部用户均关闭。可发送：

“把下面内容整理成一篇博客，先给我看草稿：……”

“把这篇草稿发布到我的博客。”

或随截图发送：“识别这张截图，整理后发布到博客；不确定的地方先问我。”

删除文章：发送“删除这篇文章：文章链接”，或者“帮我查找标题包含 Docker 的文章”。机器人先展示精确标题、链接和确认文字；在新消息中原样发送“确认删除 确认码”后才提交删除。确认 15 分钟过期，文章在预览后被修改则必须重新预览。不能批量删除或通过旧发布消息重建已删除文章。

删除 submitted 仅代表 Git 提交；removed 才表示网站已下线。当前网站对不存在的 Markdown 返回 SPA 页面，因此状态检查会先确认网站首页正常，再比对缺失文章响应与首页；普通错误页面不会误报成功。操作保留在 Git 历史，管理员可以恢复对应文章并触发部署。自动恢复已删除文章和上传原图仍未提供专用接口。

## 验证

`python3 -m unittest discover -s publisher -p 'test*.py'`：29 项测试使用独立本地 Git 仓库，覆盖创建、删除确认、版本变更、并发修改、重试、推送故障、崩溃恢复、路径限制及网站状态识别。

`node --test plugin/test.mjs`：6 项测试覆盖工具请求、确认参数传递、路径限制、凭证不出现在结果、运行时工具声明与允许名单。生产查询和预览验证已通过，两个容器 healthy，飞书 WebSocket 已恢复；现有文章内容校验一致，仓库仍为 7b9a138ffc899bc4910da9937323af5786155829。验证未调用真实删除确认，测试预览已清理。

部署版本：插件 1.4.0，发布服务运行镜像 cjw-ai-blog-publisher-runtime:5；保留 :1、:2、:3 镜像及服务器 backups/edit-feature-* 中的旧配置用于回滚。恢复文章时只恢复对应 Markdown 文件并提交，不重置整个 main 分支。

已验收：容器健康、飞书本人配对、实际消息生成草稿、用户确认后发布、GitHub Actions 结果和公开文章内容一致。待额外验证：实际飞书图片消息的 OCR 输出。

## 停止与恢复

docker compose stop 只停止博客助手和发布服务，已发布的网站继续运行。不要删除 state（配对和会话）、publisher-data（发布记录）与 secrets。恢复 docker compose up -d。

需要恢复本机飞书接收时，先停止云端 OpenClaw，再启用本机原账号。不要同时运行两个相同飞书账号实例。

更新镜像前备份配置和状态，固定新版本并重新验证官方飞书插件兼容性。服务不给 Docker socket，也不挂载其他网站目录。

## 查询和修改文章（1.2.0）

查询示例：“我之前有没有写过防抖函数的文章？”助手按主题检索标题、标签、摘要和正文，防抖/debounce、节流/throttle 支持对应检索。返回真实文章标题、链接及必要的匹配说明；没有匹配就说没有找到，不根据记忆编造。搜索失败不能被当作零结果。

修改示例：“我想修改《xxx》这篇文章。”助手查找并读取完整文章，展示完整标题和正文，然后询问修改哪部分。每一轮新要求都生成不可变的完整修改稿，仅暂存；每一轮都展示完整修改后的内容，长文分段而不省略。用户在看到最新稿后回复“可以了”“上传吧”“可以了，上传”等，才提交这个 draft_id 对应的版本。确认接口不接受正文，避免上传未经展示的内容。

原链接、ID、发布日期及未修改的 metadata 保留；修改正文、标题、摘要、分类或标签时自动写入北京时间 ISO 8601 updated_at。博客加载层将该值映射为 updated，文章页展示最后更新时间。一个文章有新预览后旧预览不可再确认；草稿有效 24 小时。版本冲突、删除、过期均需重新读取和预览，随后再次确认。保存记录保留在 Git 历史。

接口：GET /articles?query=关键词、GET /articles/{id}、POST /edit/preview、POST /edit/confirm、GET /status/edt-{id}。均使用既有私有服务鉴权，不开放公网。修改 submitted 仅为提交；与公开 Markdown 的 SHA-256 相同才返回 live。暂存稿位于 publisher-data/edits，和聊天工作目录一样不公开。

发布服务测试覆盖多轮预览不修改 Git、旧稿不能确认、自然语言确认与否定、原文变化/删除、保留 metadata 和其他文件、重复请求、推送不确定及崩溃恢复。生产验证不擅自修改真实文章；实际飞书修改由主人按以上流程发起。

1.2.0 上线验收（2026-09-17）：29 项发布服务测试、6 项工具测试通过。服务器全文读取、修改稿原样暂存、零结果查询、预览不改变原文与 Git HEAD 的检查通过，测试草稿已清理。搜索“防抖函数”实际返回《手写防抖》《通用防抖hook封装》《防抖节流》以及正文提及的《闭包》《Ref全家桶》。OpenClaw/publisher 均 healthy，9 项工具注册无诊断，飞书长连接恢复。

文章更新时间展示提交 b18bcac461f179b6a430e83e28e1c501cf95b3cf 已推送到 blog-page/main；构建与部署 https://github.com/cjw260/blog-page/actions/runs/35172531498 成功。前端清单回归测试 1 项通过，本地生产构建成功。生产验证没有确认保存任何测试修改稿，真实多轮飞书编辑由用户自行发起。

2026-09-17 博客主题迁移：blog-page 改用 Astro/CitrusGrid，public/markdown 源文件、原文章 ID、raw Markdown 地址和 Git 工作流保持原契约。站点不存在的文章/Markdown 返回真实 404，首页保留 id=app 健康标记，发布服务无需改动。主题在读取时映射 date、summary、updated_at，现有发布、全文查询、编辑和删除接口均继续适用。

## 分类与标签修改（1.3.0）

已有文章支持只修改分类或标签。读取和每轮完整预览包含 category、tags；新增标签保留其余标签，支持删除、整体替换或明确清空，支持全新分类/标签。分类限单个非空名称（50 字符），标签最多 12 个、每个 40 字符；预览去除标签开头 #、首尾空格并去重。用户在新消息确认后保存预览，更新 updated_at，保留原发布日期、链接及未改正文。旧版未携带这两个字段的草稿继续保留原分类和标签。

1.3.0 上线验收（2026-09-17）：33 项发布服务测试、6 项工具测试通过；隔离仓库确认保存后，Astro 构建验证新标签与新分类聚合页面、原文章链接和发布日期。生产读取 42 篇文章的分类/标签成功，修改预览返回规范化字段，原文章 SHA-256 未改变，测试草稿已清理。9 项工具运行时注册无诊断，OpenClaw/publisher 均 healthy，飞书 WebSocket 已恢复。没有代替用户提交真实文章修改。回滚备份：/opt/cjw-ai-blog/backups/taxonomy-feature-20260917-104516，旧发布服务镜像 :3 保留。

## 置顶修改（1.4.0）

读取、搜索和完整修改预览返回 index。0 为不置顶，1 为普通置顶，数字越大越靠前，上限 10000；机器人支持置顶、取消、调整优先级，未要求修改则保留当前状态。依然先展示完整正文、分类、标签及置顶状态，再等主人新消息确认保存；只改置顶也会记录 updated_at。旧草稿未携带 index 时保持原置顶状态。

1.4.0 验收（2026-09-17）：35 项发布服务测试、6 项工具测试通过，覆盖只改置顶、调优先级、取消置顶、非法值、未展示版本拒绝保存、正文及原日期/链接保持。线上搜索返回 42 篇文章的置顶优先级，真实预览检查通过并清理，未改变真实文章。九项工具注册正常，OpenClaw/publisher healthy，飞书 WebSocket ready。回滚备份 /opt/cjw-ai-blog/backups/pin-feature-20260917-110033，旧镜像 :4 保留。

## 2026-09-17 上下文修复（15:46 核验）

已部署插件 1.4.1 与 1,000,000-token Flash 窗口。原 64K 配置过早触发压缩，日志确认摘要缺章节/标识符被质量检查拒绝。显式采用 safeguard、压缩 thinking=off、保留最近 20K tokens、recentTurnsPreserve=0、严格质量检查及最多 3 次纠正、轮中预算预检。普通回复上限仍为 8192。修改预览仅省略与本次参数逐字一致的重复正文，以 body_source 和 SHA-256 标识；完整预览、新消息确认和服务端原文版本检查保持不变。密钥配置脚本保留 1M 窗口与压缩设置。

真实会话通过官方 sessions.compact 语义压缩，58,321 → 17,928 tokens，619 条原始事件未改动，压缩计数 5 → 6。运行时模型与会话投影确认 1M，机器人/发布服务 healthy。没有代用户发消息或提交文章；未做百万 token 压力测试。回归：`node --test deployment/ai-blog/plugin/context-budget.test.mjs`。服务器备份 `/opt/cjw-ai-blog/backups/compaction-20260917-154259`，含旧配置/源码与 SQLite 在线备份；回退不得用旧数据库覆盖新增消息。详见运维仓库第 7 节交接记录。
