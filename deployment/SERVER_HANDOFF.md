> 本文已迁移到独立私有仓库 [cjw260/cjw-server-ops](https://github.com/cjw260/cjw-server-ops)。最新交接文档位于 `skills/cjw-server-ops/references/SERVER_HANDOFF.md`；此处仅保留历史副本，后续请维护运维仓库。

# cjw32.xyz 服务器结构与 Agent 交接说明

> 核验时间：2026-09-17 11:52–11:55（Asia/Shanghai）。这是运维快照，不是实时监控。
> 面向接手网站、部署和飞书博客流水线的 Agent。先阅读本文件，再按具体任务核对实际状态。
> 本文件只记配置/凭证的存放位置，不包含密码、私钥、API Key、授权码或飞书用户标识。不要将它自动发布到网站。

## 1. 先理解这台服务器

这是一台**混合部署**的个人服务器：宝塔管理宿主机 Nginx 和部分基础软件；四个个人网站已经迁移到 Docker + GitHub Actions；旧英语项目仍在宿主机上通过 PM2 运行；飞书博客助手是另外一组 Docker 容器。目录存在不代表它正在对外提供服务。

| 项目 | 当前结论 |
| --- | --- |
| 服务器 | 火山引擎 ECS，101.96.211.198，主机名 `iv-yeq3jmfvnkt56on9ynkk` |
| 系统与规格 | Ubuntu 24.04、x86_64/linux/amd64、4 vCPU、约 4 GiB 内存、40 GiB 系统盘 |
| Docker | Engine 29.6.1、Compose v5.3.1，数据根目录 `/var/lib/docker` |
| 部署账号 | `cjw-deploy`，UID/GID 1003，Docker 组 GID 988；没有已确认的免密 sudo |
| 域名入口 | `https://cjw32.xyz/`；简历计划使用 `https://resume.cjw32.xyz/` |
| 实测资源 | 内存 available 约 479 MiB，Swap 0；系统盘使用 26 GiB、可用 12 GiB。随时会变，启动新服务前重新检查 |
| 已运行 | 9 个新应用容器均 healthy，另有 mongo/redis/minio 3 个旧容器 running；宿主机旧英语/工具/思维导图进程仍存在 |
| 未运行 | Reactive Resume 容器尚未创建；本地新项目 `en-learning-plus` 尚未部署 |

**不要误认：** `/www/wwwroot/blog-page` 还是旧 Vue 博客目录；当前线上博客已经是 GitHub `cjw260/blog-page` main 上的 Astro/CitrusGrid，运行于 `/opt/cjw-sites/blog-page` 的镜像发布体系。

## 2. 请求如何到达应用

```text
访客 HTTPS
  └─ 宿主机宝塔 Nginx（80/443，证书与公网入口）
      ├─ /                   → 127.0.0.1:18080 → 导航容器
      ├─ /blog/              → 127.0.0.1:18081 → Astro 静态博客容器
      │    └─ /blog/api/stats/{visit,total} → 内部 stats:8080 → SQLite
      ├─ /tool/              → 127.0.0.1:18082 → 工具前端容器
      ├─ /tool-api/          → 127.0.0.1:13003/api/ → 工具 API 容器
      ├─ /tool-ws/           → 127.0.0.1:13003/ → 工具协作 WebSocket
      ├─ /work/              → 127.0.0.1:18083 → 思维导图前端容器
      ├─ /mindmap-ws/        → 127.0.0.1:11234/ → 思维导图协作容器
      ├─ /en/               → 旧英语项目 apps/web/dist（宿主机静态目录）
      ├─ /api、/socket.io/   → localhost:3000 → 旧英语 server / PM2
      ├─ /ai                → localhost:3001 → 旧英语 ai / PM2
      └─ /models/           → 旧英语项目 apps/web/dist/models

飞书私聊 → 出站长连接 OpenClaw → DeepSeek + 受限博客工具
                                  └─ publisher:8080（内部网络）
                                      → blog-page/main 提交
                                      → GitHub Actions → GHCR → 服务器更新博客
```

`/app3`、`/app3/` 是旧工具入口，已重定向到 `/tool/`。不要新建一个同名站点来承接它。

入口路由来自此前已验收的迁移记录及本次端口/容器核验；本次账号不能读取宝塔 vhost 原文件，修改前仍要由有权限的管理员确认实时配置。

## 3. 主要文件树：位置、职责与是否可以编辑

```text
/opt/cjw-sites/                         # 四个网站的生产发布根目录
├── navigation-page/
├── blog-page/
├── vue-tool/
├── vue-mindmap/
│   各项目的共同结构：
│   ├── READY                          # 初始化完成标记，部署脚本需要
│   ├── deploy.lock                    # 项目级发布锁
│   ├── releases/<Git SHA>-<run>-<attempt>/
│   │   ├── compose.yaml              # 该版本的容器编排
│   │   ├── images.env                # 固定镜像 digest 清单，不是应用密钥文件
│   │   └── deploy.sh                 # 对应版本发布脚本
│   ├── current -> releases/...       # 当前成功版本（软链接）
│   └── previous -> releases/...      # 上一成功版本；并非每个项目都已存在
├── blog-page/data/stats/stats.sqlite3 # 博客浏览统计，独立于版本目录
├── blog-page/backups/stats/           # 发布前 SQLite 在线备份，保留最近 7 份
├── blog-page/backups/pre-citrus-*/    # 博客换主题前备份
├── vue-tool/runtime.env              # 工具运行配置/数据库连接，敏感文件
├── backups/                          # 初次容器迁移的 Nginx、MongoDB 备份
└── cutover.py                        # 一次性入口切换脚本，已经执行，不要直接重复运行

/opt/cjw-ai-blog/                      # 飞书 AI 博客流水线，独立于四个站点发布
├── compose.yaml                      # OpenClaw + publisher
├── .env                              # 编排变量；按敏感配置处理
├── openclaw.json                      # 生产网关配置（只读挂载进容器）
├── configure-feishu.py               # 用户交互更新自己的飞书凭证
├── configure-deepseek.py             # 用户交互更新自己的模型密钥
├── openclaw-runtime/Dockerfile        # 基于官方镜像适配运行 UID/GID
├── publisher/
│   ├── Dockerfile                    # 带 Git/OCR 的基础镜像
│   ├── Dockerfile.runtime            # 后续业务代码构建，避免重复 apt 下载
│   └── server.py                     # 受限发布、查询、修改、删除、状态/OCR 服务
├── plugin/                           # OpenClaw 九项博客工具，当前插件 1.4.0
│   ├── index.mjs
│   ├── openclaw.plugin.json
│   └── package.json
├── secrets/                          # 目录 700、凭证文件 600
│   ├── openclaw.env                   # 飞书、DeepSeek、网关及 publisher 令牌
│   ├── publisher.env                 # publisher 鉴权令牌
│   ├── blog_key                      # 仅 blog-page 可写的 GitHub Deploy Key
│   └── github_known_hosts            # 已核验 GitHub 主机公钥
├── state/                            # 插件安装注册、会话、配对/缓存、媒体等状态
│   └── install-config.json           # 安装插件用的可写配置；不是生产配置入口
├── workspace/
│   ├── AGENTS.md                     # 机器人行为规则，不是整个服务器的运维规则
│   ├── IDENTITY.md / SOUL.md / USER.md
│   ├── skills/cjw-blog-publish/      # 机器人专用发布技能
│   └── drafts/                       # 未发布草稿，不对外公开
├── publisher-data/
│   ├── repository.git/              # 博客裸仓库缓存，不能当工作区随意修改
│   ├── jobs/                         # 发布任务状态
│   ├── edits/                        # 不可变修改预览和确认状态
│   └── deletions/                    # 删除预览和确认状态
├── backups/                          # 每次机器人功能升级的配置/代码备份
├── *-feature-stage/                  # 历次部署中转目录，不是实际运行来源
└── *.tar / *.tar.gz / *.tgz / *.log   # 镜像离线导入、传输包、安装日志；不是业务数据

/home/cjw-deploy/
├── .ssh/                             # 登录身份配置；不要输出 authorized_keys 内容
├── cjw-sites-operations.md            # 较早的四站点运维说明，信息可能过时
├── SERVER_HANDOFF.md                  # 本文的服务器副本
└── reactive-resume/                   # 已准备，尚未运行
    ├── compose.yaml / compose.offline.yaml
    ├── .env                          # SMTP、数据库、认证配置，敏感
    ├── configure.py                  # 隐藏输入 SMTP 授权码
    ├── setup-server.sh               # 管理员配置证书与 Nginx，并检查应用就绪
    ├── prepare-images.sh / pull-images.sh
    ├── import-images.sh / use-verified-images.sh / verify-images.py
    ├── nginx-http.conf / nginx-https.conf  # 模板，不等于已生效 vhost
    ├── prepare-images.log / https-setup.log / *pull*.log
    └── *.tar                         # 已上传的应用/PostgreSQL 离线镜像包

/www/
├── wwwroot/
│   ├── 101.96.211.198/                # 仍在生产使用的旧英语项目
│   │   ├── apps/web/dist/             # /en/ 静态文件（models 也在此）
│   │   ├── apps/tracker/
│   │   ├── packages/common/、config/
│   │   └── server/
│   │       ├── .env                  # 旧英语服务配置；还有历史副本，均视为敏感
│   │       ├── ecosystem.config.js   # PM2 配置
│   │       ├── prisma/               # 旧数据库模型/迁移
│   │       └── dist/apps/{server,ai}/ # 当前 Node 进程编译产物
│   ├── nav/                          # 旧导航静态目录，已不承接主入口
│   ├── blog-page/                    # 旧 Vue 博客源码与 dist，不是线上 Astro
│   ├── vue-tool/                     # 旧工具源码；旧 Node 后端仍在运行
│   ├── vue-mindmap/                  # 旧思维导图源码；旧 Node 后端仍在运行
│   ├── resume-acme/                  # 简历域名 ACME 验证 webroot
│   └── default/
├── docker/
│   ├── docker-compose.yml           # 旧 mongo/redis/minio 编排，可能含密钥
│   ├── mongo-data/                  # mongo 容器 /data/db
│   └── redis-data/                  # redis 容器 /data
├── minio/data/                       # minio 容器 /data，仍需保留
├── server/
│   ├── nginx/sbin/nginx              # 宝塔 Nginx 可执行文件
│   ├── panel/vhost/nginx/            # 真正的宿主机站点配置（需管理员权限）
│   ├── pgsql/                        # 宿主机 PostgreSQL；data/ 为数据目录，data_directory 为路径记录文件
│   ├── nodejs/                       # 宝塔 Node 运行时
│   ├── cron/                         # 宝塔计划任务；本次未核验内容
│   └── redis/ 等                     # 宝塔安装目录，存在不代表正在使用
├── wwwlogs/                          # 宿主机网站日志；具体文件看实际 vhost
├── backup/                           # 宝塔备份目录；不能假定已配置全量/异地备份
└── .Recycle_bin/                     # 宝塔回收站

/var/lib/docker/                      # Docker 管理，不要手工改写或清理
└── volumes/cjw-vue-mindmap_mindmap-data/_data/  # 思维导图协作持久化
```

`._*`、`[internal]`、`ERROR`、`CACHED` 等少量文件在现场目录中存在，是传输/历史操作遗留，不是服务组件。本次仅记录，未删除。

## 4. 项目、仓库、容器、端口一览

| 服务 | 源码 / 管理入口 | 生产容器名 | 访问方式 / 数据 |
| --- | --- | --- | --- |
| 导航 | `https://github.com/cjw260/navigation-Page` | `cjw-navigation-page-web-1` | `/` → 127.0.0.1:18080 → 容器 8080 |
| 博客 | `https://github.com/cjw260/blog-page` | `cjw-blog-page-web-1` | `/blog/` → 127.0.0.1:18081 → 8080 |
| 博客统计 | 同上 `stats/` | `cjw-blog-page-stats-1` | 内部 8080；`/opt/cjw-sites/blog-page/data/stats` |
| 工具前端 | `https://github.com/cjw260/vue-tool` | `cjw-vue-tool-web-1` | `/tool/` → 127.0.0.1:18082 → 8080 |
| 工具 API | 同上 `server/` | `cjw-vue-tool-api-1` | host 网络，应用仅绑定 127.0.0.1:13003；数据在旧 MongoDB |
| 思维导图前端 | `https://github.com/cjw260/vue-mindmap` | `cjw-vue-mindmap-web-1` | `/work/` → 127.0.0.1:18083 → 8080 |
| 思维导图协作 | 同上 `server/` | `cjw-vue-mindmap-api-1` | 127.0.0.1:11234 → 1234；命名卷 `cjw-vue-mindmap_mindmap-data` → `/data` |
| 飞书网关 | 本地 `deployment/ai-blog/` + 服务器 `/opt/cjw-ai-blog/` | `cjw-ai-blog-openclaw-1` | 无宿主机公开端口；容器内网关 18789，飞书出站长连接 |
| 博客发布服务 | 同上 `publisher/` | `cjw-ai-blog-publisher-1` | 无宿主机公开端口；内部 `publisher:8080`，必须鉴权 |
| MongoDB 7 | `/www/docker/docker-compose.yml` | `mongo` | host 网络；`/www/docker/mongo-data`，另有 `/data/configdb` 匿名卷 |
| Redis 7 | 同上 | `redis` | host 网络；`/www/docker/redis-data` |
| MinIO | 同上 | `minio` | host 网络；`/www/minio/data`；宿主机进程表中的 PID 56254 已核验属于此容器，并非第二套服务 |
| 旧英语服务 | 既有 `cjw260/en-learning`，服务器 `/www/wwwroot/101.96.211.198` | 无；root 所属 PM2 | server 3000、ai 3001；本次观察各 4 个 Node 进程 |
| 旧工具/导图后端 | `/www/wwwroot/{vue-tool,vue-mindmap}/server` | 无；宿主机 Node/历史 PM2 | 旧 3003、1234 仍监听；已迁移公网入口，未自动停止旧进程 |
| Reactive Resume | 官方 `reactive-resume/reactive-resume`，准备版本 v5.3.0 | 尚无 `cjw-resume-*` 容器 | 计划 127.0.0.1:18084 → 3000，独立 PostgreSQL 17 与 uploads 卷 |

新应用端口绑定回环地址；**不要据此推断整台服务器的数据库都只监听本机**。本次 `ss -lnt` 还看到 27017、6379、5432、旧 3000/3001/3003/1234、部分 9000/9001 监听通配地址。公网能否访问取决于云安全组/主机防火墙，本次未验证其外部可达性，也未改动规则。

其余已观察端口：SSH 22、HTTP/HTTPS 80/443、宝塔 28100、888；53 为本机 DNS。不要凭端口号直接停服务。

## 5. 当前发布版本与后续发布方式

以下为本次读取 `current` 得到的版本，不要把它们硬编码到后续部署工具中：

| 项目 | 当前 release 目录名 |
| --- | --- |
| navigation-page | `b40d656a6e4a375017839905978cfaee8d3db50f-35049164474-1` |
| blog-page | `d7a6e9f99514d747007241bb75d54d47ed5a629f-35178579777-1` |
| vue-tool | `cf80da0b209e0c1e4e166620c8180339923940fe-35050671762-1` |
| vue-mindmap | `f97b8a292e8e724963977568399e79f72165e8ac-35050594534-1` |

博客上一成功 release 是 `6b19c760cc979dd6ac6298f027fb06f4ad7d288e-35178062076-1`；另外三个项目本次未看到 `previous` 链接。

常规网站发布：修改对应 GitHub 仓库 → 向 `main` 推送 → `Container CI and deployment` 构建 linux/amd64 镜像并推 GHCR → SSH 上传 release 清单 → 服务器拉固定 digest → 健康检查 → 更新 `current`/`previous`。PR 构建验证，不直接生产发布。

- 工作流在各仓库 `.github/workflows/`；Dockerfile 与 `deploy/` 以该仓库 main 为准。
- `production` 环境 Secrets：`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`；只记录名称，不导出值。
- 仓库变量 `ENABLE_PRODUCTION_DEPLOY=true` 启用生产发布。改成 false 可暂停后续自动发布，不会停止现有容器。
- GHCR 认证使用工作流短期 `GITHUB_TOKEN`，服务器使用临时 Docker 登录目录；不要额外保存个人长期 token。
- 每个项目使用 `deploy.lock`。先拉完镜像再换容器；健康失败尝试上一成功 release。单实例不保证零停机。
- 博客有 web + stats 两个镜像。不能只更新 `WEB_IMAGE` 而漏掉 `STATS_IMAGE`。
- 不在 `current` 目录手改构建产物；不再靠旧 `/www/wwwroot/*` 的 `git pull` 更新这四个站点。
- 飞书会提交文章到 blog-page/main：开始开发前 fetch 最新 main，保留并发文章提交，不 force push、不重置整条分支。

## 6. 博客的数据契约与已实现行为

博客是 Astro/CitrusGrid，继续使用原仓库/域名。内容唯一来源为 `public/markdown/*.md`，文章 ID 是文件名，公开链接仍为 `/blog/article/{id}/`。截至核验有 42 篇文章；删除/新增后数量可能变化。

- `src/content.config.ts`：`date → published`，`summary → description`，`updated_at → updated`；保留原字段和既有文章链接。
- `index`：0 不置顶，正整数置顶，数值越大越靠前。机器人当前限制 0–10000。
- 发布时间与更新时间是不同字段。卡片内部为发布时间；左下角为更新时间，无独立记录时用发布时间并显示说明。不要使用 git checkout 时间或文件 mtime 伪造文章更新。
- 机器人确认修改正文、标题、摘要、分类、标签或置顶后写北京时间 `updated_at`，保留原 `date`、ID 和未改字段。
- 头像：`public/profile.jpeg`，构建按图片字节 SHA-256 生成版本 URL，图片长期缓存；站内翻页保留同版本头像。改头像后提交发布，下次翻页/刷新使用新版本。不要去旧 Vue 目录换图片。
- 图片迁移映射为 `src/legacy-images.json` 和 `public/media/`。旧 Markdown 原文不因迁移而改写。
- 历史缺图：`2025101601.md` 原 Windows/Typora 图片 `image-20251016121355790.png` 没有源文件；待主人提供，不能凭空恢复。
- 不存在的文章/Markdown 返回真实 404；旧文档里关于 Vue SPA 返回首页的说明已过时。

统计服务是本站 Python/SQLite，不是演示站第三方计数：

- 浏览器持久匿名标识用于 UV，后端保存加盐摘要；清理浏览器存储/换设备会形成新访客。
- PV 按实际页面访问计；首页展示文章卡片不增加对应文章 PV。
- `POST /blog/api/stats/visit` 记录访问；`GET /blog/api/stats/total` 返回汇总。服务有路径白名单、事件去重、同源校验和基础限流。
- 数据在 `stats.sqlite3`，不在镜像/文章文件中。迁移前历史浏览量没有被导入。
- 发布脚本使用 SQLite backup 接口备份，保留最近 7 份。不要直接复制运行中的主数据库文件并假定包含 WAL 中全部数据。

## 7. 飞书博客助手的运行与权限边界

当前应用是主人组织「用户616695的飞书」中的 **CJW 博客助手**，App ID `cli_aa20d86dddb9dbb5`。仅主人私聊 allowlist，群聊关闭。旧本机应用的账号归属无法确认，不能重新沿用旧凭证；DeepSeek 已由主人替换为自己的密钥。

- 运行镜像：`cjw-ai-blog-openclaw:2026.9.4`、`cjw-ai-blog-publisher-runtime:5`。
- 官方基础镜像 `ghcr.io/openclaw/openclaw:2026.9.4` 已离线导入；发布基础镜像 `cjw-ai-blog-publisher:1` 已构建。
- 飞书插件使用官方 `@openclaw/feishu@2026.9.4`，安装状态持久化于 `state`；不能只复制包而绕过官方注册步骤。
- 博客工具插件 1.4.0，九项工具；包括搜索、原文读取、发布、修改预览/确认、删除预览/确认、状态与 OCR。OpenClaw 没有通用终端权限，也没有 Docker socket。
- 模型当前通过 OpenClaw 的 `deepseek/deepseek-v4-flash` 别名调用 Flash，thinking 关闭。更换模型前确认用户偏好与实际可用模型。
- 新文章/修改必须先展示完整预览，再由主人的新消息确认。“可以了”“上传吧”可用于最新修改稿确认。
- 修改稿 24 小时有效，旧预览失效；确认时校验原文版本，遇到并发修改先重读，不能覆盖别人修改。
- 删除需精确确认码，15 分钟有效；不以普通“可以了”代替删除确认。
- `submitted` 只表示 Git 提交；线上内容校验后才是 `live`，删除完成是 `removed`。不能把 Actions 排队当成上线成功。
- OCR 用容器内 Tesseract 中/英文，不把原始图片发给文本模型；完整飞书图片消息 OCR 链路尚未验收。
- 更新 env 后需要重建相应容器，单纯 `restart` 不会加载新环境变量。先核对 Compose、备份状态，再执行具体更新。
- 生产配置 `openclaw.json` 是只读挂载；CLI 尝试原地改写可能 EBUSY。不要把安装用临时配置误当生产配置。
- 停止这组服务不影响已发布静态博客。不得删除 `secrets`、`state`、`workspace/drafts`、`publisher-data`。

## 8. 旧英语项目与未完成的部署

### 旧英语项目

旧仓库 `cjw260/en-learning` 仍承接 `/en/`、`/api`、`/ai`、`/socket.io/`、`/models/`，源码在 `/www/wwwroot/101.96.211.198`。现场确认 root 所属 PM2 及 server/ai 各 4 个 Node 进程；历史进程名为 `en-server`、`en-ai`，本次未读取 root 的完整 PM2 清单。

当前电脑上的 `/Users/woofeel/Downloads/en-learning-plus` 是新项目，**不是已上线的旧英语源码**。计划迁移前需另行核对 PostgreSQL/pgvector、Prisma migrations、Redis、MinIO、ffmpeg 和旧数据兼容性。不能直接以新代码连接旧库并运行迁移。宿主机 PostgreSQL 已运行，目录位于 `/www/server/pgsql`；本次未读取其配置来确认精确 data_directory、版本或库用途。

### Reactive Resume

准备目录 `/home/cjw-deploy/reactive-resume`，目标 `https://resume.cjw32.xyz/`。DNS、163 SMTP 配置和证书签发此前已完成；本次确认应用/PostgreSQL 镜像已存在，但**没有应用容器、没有持久卷、18084 没有监听，尚未上线**。

- 准备版本 v5.3.0；独立 PostgreSQL 17；计划 Compose 项目名 `cjw-resume`，卷 `postgres-data`/`uploads`。
- SMTP 为 `smtp.163.com:465` TLS，凭证仅在 `.env`；不在文档记录邮箱授权码。
- 证书历史签发位置 `/etc/letsencrypt/live/resume.cjw32.xyz/{fullchain.pem,privkey.pem}`，当时到期日 2026-12-15；本次目录权限不足，未重新读取。已确认 `certbot.timer` 存在，但续期到 Nginx 重载的完整流程仍需核验。
- `https-setup.log` 最后记录应用就绪等待超时，HTTPS 入口保持未切换；不能看到 `CJW_RESUME_CERT_READY` 就宣称应用可用。
- 应用/数据库计划内存上限 512/256 MiB；本机可用内存已经较少，继续启动前先评估容量，不在这次文档任务中启动。
- 尚未建立与四站点相同的 GitHub CI/CD，数据库/上传文件也没有已确认的自动异地备份。

## 9. 宝塔、证书、权限和凭证定位

主站 Nginx 配置（此前核实）：
`/www/server/panel/vhost/nginx/html_101.96.211.198.conf`

主站证书（此前核实）：
`/www/server/panel/vhost/nginx/cert/cjw32.xyz.pem` 与 `cjw32.xyz.key`

简历独立 vhost 预定路径：
`/www/server/panel/vhost/nginx/resume.cjw32.xyz.conf`

宝塔端口 28100；面板还有安全入口路径，本文件不复制该路径/账户凭证。确需找回时由服务器管理员使用宝塔命令查看默认信息，输出中可能含登录信息，不要整段贴进对话。

SSH 日常使用 `cjw-deploy` 与已核验主机公钥，禁止关闭 StrictHostKeyChecking。CI 专用部署密钥与博客写入 Deploy Key 是两套用途不同的密钥，不能互换。

本次 Agent 使用过带期限的临时 SSH 公钥；它不是长期接入方式，后续可能已过期。其他 Agent 不应依赖本机 `/private/tmp` 中的私钥继续获得权限。需要接入时使用主人当前授权的连接方式，不自动创建新身份或扩大权限。

`cjw-deploy` 能管理 Docker，不等于可以随意操作宿主机 root 文件。遇到 `/opt`、宝塔 vhost、证书、root PM2、全局备份目录权限不足时应明确标记未核验，不利用特权容器或宿主机挂载绕过权限。

## 10. 备份、回滚与日志

| 资源 | 已有位置/机制 | 边界 |
| --- | --- | --- |
| 四站点版本 | `/opt/cjw-sites/<app>/releases`、`current`、可能的 `previous` | 镜像回退不等于数据库回退；不保证零停机 |
| 首次入口迁移 | `/opt/cjw-sites/backups/nginx-before-*.conf` | 本次账号无法列出，路径来自已完成迁移记录 |
| 工具数据库初始备份 | `/opt/cjw-sites/backups/vue-tool-20260916T023323384Z.archive.gz` | 曾做逻辑备份/dry-run 验证；不能当作持续备份 |
| 博客换主题前 | `/opt/cjw-sites/blog-page/backups/pre-citrus-20260917-101955` | 历史 Vue 版本回退参考 |
| 博客统计 | `/opt/cjw-sites/blog-page/backups/stats/stats-*.sqlite3` | 每次发布备份，保留 7 份；仍在同一服务器 |
| 机器人功能升级 | `/opt/cjw-ai-blog/backups/` | 最新 `pin-feature-20260917-110033`；前版镜像 :4 仍在 |
| 文章 | GitHub `blog-page` Git 历史 | 恢复对应 Markdown 再提交，不 reset 整个 main |
| 数据库/对象存储/简历 | 尚无本次已核验的统一异地备份计划 | 不要把目录存在理解为灾备已完成 |

发布回退需先确认没有同项目发布进行，在同一 `deploy.lock` 下用上一版本的 `images.env` 和 `compose.yaml`、相同 Compose 项目名恢复并验健康，再同步版本指针。不直接运行没有 token 的历史 `deploy.sh`，也不盲目执行 `cutover.py`。

日志入口：网站/服务容器用 `docker logs --tail`；发布看对应仓库 Actions；宝塔站点日志在 `/www/wwwlogs`，具体文件名看 vhost；机器人安装日志在 `/opt/cjw-ai-blog/*.log`；简历日志在其准备目录。机器人日志可能包含聊天素材，排错只提取必要片段并脱敏。

## 11. 新 Agent 的只读检查清单

以下在**服务器终端**执行，不是在本机 macOS。用于获取现状，不会重启或修改服务：

```sh
hostname
date -Is
free -m
df -h /
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
ss -lnt
readlink -f /opt/cjw-sites/blog-page/current
readlink -f /opt/cjw-sites/blog-page/previous
```

核对博客编排状态时要显式带固定 Compose 项目名和镜像清单，否则可能创建错误的项目上下文：

```sh
release_dir=$(readlink -f /opt/cjw-sites/blog-page/current)
docker compose --project-name cjw-blog-page \
  --env-file "$release_dir/images.env" -f "$release_dir/compose.yaml" ps
curl --fail --silent http://127.0.0.1:18081/healthz
curl --fail --silent https://cjw32.xyz/blog/api/stats/total
```

核对机器人：

```sh
cd /opt/cjw-ai-blog
docker compose ps
```

不要把完整 `docker inspect`、`docker compose config`、`env`、`.env`、私钥、完整机器人会话/日志贴到输出。需要配置验证可用 `docker compose config --quiet`；需要 inspect 时只选择状态、端口、挂载等必要字段，避免 `.Config.Env`。

涉及 Nginx 的后续修改需要管理员身份：先备份实际 vhost，使用 `/www/server/nginx/sbin/nginx -t` 检查，通过后再 reload。不能用发行版默认 `/etc/nginx` 猜测宝塔配置位置，也不能覆盖所有路由只保留当前任务的网站。

## 12. 本地资料位置与维护约定

本文件的本地版本：
`/Users/woofeel/Downloads/en-learning-plus/deployment/SERVER_HANDOFF.md`

服务器副本：
`/home/cjw-deploy/SERVER_HANDOFF.md`

本地辅助材料：

- `deployment/cjw-sites/`：四站点 Docker/CI 迁移记录；`repositories/` 只是当时新增/替换文件的快照，不是完整且最新的源码。
- `deployment/cjw-sites/citrus-migration/`：博客迁移基线、文章和图片清单。
- `deployment/cjw-sites/blog-statistics/`：统计/置顶验收记录，后续头像和日期改动以当前仓库为准。
- `deployment/ai-blog/`：机器人部署源码与说明；服务器端编排变量/凭证不应覆盖成本地模板。
- `deployment/reactive-resume/`：简历部署模板；服务器可能有后续离线导入脚本。
- 当前博客开发工作区 `/private/tmp/cjw-blog-citrus`，上次提交 `d7a6e9f`；临时目录会被清理，权威源码是 GitHub main。
- 本地这些 `deployment/` 材料当前未提交进 en-learning-plus 仓库；本次文档未推送任何公开仓库。

后续完成服务变更时，更新本文的核验日期、服务状态、目录/端口与未完成事项，并同步另一份副本。运行态以现场为准、源码以对应仓库为准、密钥以原受限配置为准。

不要自动执行 `pm2 delete all`、`docker compose down -v`、`docker system prune -a`，也不要批量删除旧 `/www/wwwroot`、镜像包或数据库目录。确认归属、保留回退、得到对应操作授权后再针对性处理。

## 13. 本次核验范围与待续事项

本次直接核验了：可读目录、所有容器状态/网络/挂载/资源上限、current/previous、主机监听端口、Node 进程路径、Docker 版本、内存/磁盘、certbot timer、简历准备日志和本地部署记录。

本次没有读取或更改：凭证内容、数据库业务记录、root PM2 完整状态、实际宝塔 vhost/证书受限文件、云安全组、主机防火墙细则、宝塔/root 计划任务、系统中所有其他 root 私有目录。本文件覆盖已知业务系统和运维关键路径，不声称是整台磁盘的逐文件清单。

后续仍需单独处理：Reactive Resume 启动与 HTTPS/邮件验收、新英语项目的数据迁移、旧 PM2 回退进程是否退役、资源扩容或其他容量方案、统一异地备份、历史泄漏的旧 DeepSeek 密钥撤销情况，以及飞书图片 OCR 实际验收。这些都没有在本次整理文档时自动实施。
