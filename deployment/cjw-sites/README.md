# cjw32.xyz Docker 与 CI/CD 运维说明

状态：2026-09-16，提供的四个项目均已完成 Docker 上线，GitHub Actions 的构建与生产部署全部成功。六个应用容器健康，公网页面、工具 API 和两条 WSS 协作连接通过验证。

## 现在如何发布

在对应仓库向 `main` 推送代码后，`Container CI and deployment` 会自动完成：源码检查 → 构建 Linux amd64 镜像 → 发布 GHCR → 服务器拉取指定镜像版本 → 更新该项目 → 健康检查。无需再登录服务器拉代码或手动重启。

PR 只构建验证。服务器使用镜像 digest，避免同一个标签指向不同版本；项目发布各自加锁，过期的 main 任务会跳过。后端项目为首次低带宽下载预留 45 分钟，启动健康检查仍限制 120 秒。

| 项目 | 公网入口 | 服务器本机地址 | 最终成功发布 |
| --- | --- | --- | --- |
| navigation-Page | https://cjw32.xyz/ | 127.0.0.1:18080 | [Actions](https://github.com/cjw260/navigation-Page/actions/runs/35049164474) |
| blog-page | https://cjw32.xyz/blog/ | 127.0.0.1:18081 | [Actions](https://github.com/cjw260/blog-page/actions/runs/35048499453) |
| vue-tool 前端/API | https://cjw32.xyz/tool/ | 127.0.0.1:18082 / 13003 | [Actions](https://github.com/cjw260/vue-tool/actions/runs/35050671762) |
| vue-mindmap 前端/API | https://cjw32.xyz/work/ | 127.0.0.1:18083 / 11234 | [Actions](https://github.com/cjw260/vue-mindmap/actions/runs/35050594534) |

工具 API 使用 `/tool-api/`，协作连接使用 `/tool-ws/`；思维导图协作连接使用 `/mindmap-ws/`。导航里的工具链接已修正，旧 `/app3/` 入口重定向到 `/tool/`。

宝塔 Nginx 继续负责 HTTPS、证书、统一入口和原英语项目的路由。宝塔入口为 `https://101.96.211.198:28100/f523b115`。没有新增公网应用端口；六个应用端口均已确认只监听 127.0.0.1。

## 服务器与数据

服务器为火山引擎广州 Ubuntu 24.04，x86_64，4 vCPU / 4 GiB / 40 GiB。已安装 Docker 与 Compose v5.3.1。迁移后实测可用内存约 1 GiB、磁盘可用约 21 GiB，尚无 Swap。

MongoDB 7、Redis 7、MinIO 原本就使用容器和 host 网络，本轮保留原服务与数据：

- MongoDB：`/www/docker/mongo-data`
- Redis：`/www/docker/redis-data`
- MinIO：`/www/minio/data`
- 工具运行配置：`/opt/cjw-sites/vue-tool/runtime.env`，权限 600，没有提交到 Git。
- 思维导图持久化：Compose 项目 `cjw-vue-mindmap` 的 `mindmap-data` 命名卷，挂载到 `/data`，使用 `YPERSISTENCE=/data`。

现场验证发现普通 Docker bridge 无法连接现有 MongoDB。工具 API 因此沿用宿主机网络，并由应用明确只监听 `127.0.0.1:13003`；数据库别名映射到 `127.0.0.1`。这会共享宿主机网络命名空间，是适配当前宝塔配置的取舍。其余应用使用独立容器网络；没有修改 MongoDB 或服务器防火墙。

全部应用以非 root 运行，配置了只读文件系统、临时目录、资源限制、日志轮转和重启策略。工具协作数据现在逐次编辑写入 MongoDB，停止时关闭连接并等待写入完成，修复了在线用户在重启时可能丢失编辑的问题。

按所有者选择，思维导图文章页 AI 助手已关闭，前端源码中的 DeepSeek 密钥已清除。旧密钥仍需所有者在 DeepSeek 后台撤销或轮换；删除源码不会撤销已泄漏凭据。

## 自动发布身份

已创建专用服务器账号 `cjw-deploy`，仅配置专用 SSH 公钥登录，并禁止该密钥使用终端及转发功能。账号属于 Docker 组，Docker 管理权限实际等效于较高的宿主机权限，此授权已由所有者确认。

四个仓库的 `production` environment 已配置 `DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`，仓库变量 `ENABLE_PRODUCTION_DEPLOY=true`。SSH 主机指纹经过云控制台与真实连接比对，启用了严格主机身份校验。

GHCR 使用每次工作流的短期 `GITHUB_TOKEN`，通过 SSH 标准输入传递，临时 Docker 登录配置在发布结束后清理。没有在服务器保存长期 GHCR 密码。

暂停自动更新时，将对应仓库的 `ENABLE_PRODUCTION_DEPLOY` 改为 `false`，现有容器继续运行。恢复时改回 `true`，从 main 手动运行工作流即可。

## 版本与回退

每个项目位于 `/opt/cjw-sites/<项目小写名称>/`。`releases` 保存每次发布的镜像清单、Compose 和部署脚本，`current` 指向当前成功版本，后续成功发布会将此前版本记录到 `previous`。

发布先拉齐镜像再更新应用。健康检查失败会尝试恢复上一成功版本；首次发布失败时撤回本次应用容器并保留持久卷。工具首次上线曾因数据库网络问题失败，实际验证了撤回流程，旧公网服务没有因此中断。

单实例更新有短暂中断，这套方案不承诺零停机。回退不包含数据库结构回滚；本轮没有执行数据库升级或结构迁移。

手动回退时，应先确认没有发布正在进行，在同一项目发布锁保护下使用 `previous` 中的 `images.env` 和 `compose.yaml` 恢复，保持相同 Compose 项目名 `cjw-<项目小写名称>` 并使用 `--pull never`。确认健康后同步更新版本指针。首次迁移没有上一容器版本时，可恢复对应的 Nginx 备份，配置校验成功后重载。

现有旧静态目录和 `tool-server`、`mindmap-server` PM2 进程暂时保留运行作为首次迁移回退资源；入口已指向新容器，检查时旧协作连接数为 0。确认观察期结束后可单独停止这两个进程并保存 PM2 状态。不要使用 `pm2 delete all`，也不要删除原英语服务。

至少保留当前和上一成功镜像。不要在发布中执行 `docker system prune -a` 或 `docker compose down -v`。

## 备份与入口配置

宝塔实际配置文件：`/www/server/panel/vhost/nginx/html_101.96.211.198.conf`。

已创建的服务器备份：

- 原始 Nginx：`/opt/cjw-sites/backups/nginx-before-containers-20260916T023048Z.conf`
- 工具 MongoDB：`/opt/cjw-sites/backups/vue-tool-20260916T023323384Z.archive.gz`；逻辑备份与 `mongorestore --dryRun` 检查成功，没有执行恢复写入。
- 每个项目切换前另存 `nginx-before-<项目>-<时间>.conf`，均位于同一个备份目录。

`server/cutover.py` 按当前配置 SHA-256 校验后逐项目修改入口，保留证书、ACME、`/en/`、`/api`、`/ai`、`/socket.io/`、`/models/` 规则。每次切换先备份，Nginx 校验失败则恢复原文件，不进行重载。脚本已完成本次切换，不应直接重复执行。

## 本目录与验证记录

`repositories/<仓库>/` 是已应用到各仓库的新增和替换文件副本，并非完整独立源码。实际后续开发以各仓库 main 为准，不要把这些 Compose 当作当前英语项目的启动文件。`nginx-locations.conf` 为路由参考片段，不要直接追加到现有配置造成重复 location。

验证已完成：

- 六个 Linux amd64 镜像构建、实际容器启动与健康检查。
- 四个站点公网首页，三个 Vue 项目的脚本资源与深层路径回退。
- 旧 `/app3/` 的 308 跳转、原 `/en/` 页面、工具公网列表 API。
- `/tool-ws/`、`/mindmap-ws/` 公网 WSS 握手。
- 独立测试数据库中的工具 REST 读写；两类协作数据的断开重连、在线连接状态重启恢复。
- 四个部署脚本各五种隔离模拟场景：成功、拉取失败不更新、健康失败回退、首次失败撤回、非法镜像清单拒绝，共 20 项。
- 四个仓库最终的真实 Actions 构建与生产部署全部成功；记录见 `production-runs.json`。

`verification/test-deploy.sh` 仅允许在临时 Linux 容器内运行，模拟验证发布控制流程，不等同于生产数据库故障演练。

变更记录：[导航 PR](https://github.com/cjw260/navigation-Page/pull/1)、[博客 PR](https://github.com/cjw260/blog-page/pull/1)、[工具迁移](https://github.com/cjw260/vue-tool/pull/1)、[工具网络适配](https://github.com/cjw260/vue-tool/pull/2)、[思维导图迁移](https://github.com/cjw260/vue-mindmap/pull/1)、[下载时限](https://github.com/cjw260/vue-mindmap/pull/2)。

## 后续接入 en-learning-plus

当前新英语项目仍未部署。线上 `/en/` 来自旧仓库 `cjw260/en-learning`，原 `en-server` 和 `en-ai` PM2 进程保持原样。

新项目需要 PostgreSQL/pgvector、Redis、MinIO、ffmpeg 等。应先隔离验证当前 Prisma migrations 与旧数据的兼容性，再安排数据迁移和路由切换；不能直接拿旧数据库启动最新代码。当前 4 GiB 服务器应先每类运行一个 Node 进程并设置限额，测量实际负载后再扩展。

参考：[Docker Compose 生产部署](https://docs.docker.com/compose/how-tos/production/)、[Docker 与 GitHub Actions](https://docs.docker.com/build/ci/github-actions/)、[Nginx WebSocket](https://nginx.org/en/docs/http/websocket.html)。
