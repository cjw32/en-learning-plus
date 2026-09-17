# Reactive Resume 部署

目标：https://resume.cjw32.xyz；服务器 101.96.211.198。
部署目录：`/home/cjw-deploy/reactive-resume`。

当前状态：DNS 已生效；用户已在服务器完成 SMTP 登录验证及证书签发。镜像传输和应用运行验证仍待完成，尚未上线。

## 组件

- 官方 v5.3.0 镜像，固定 linux/amd64 摘要；源码对应 `f89acb436865cf536fffed2b23d4d72a7ecff0db`。
- 独立 PostgreSQL 17、数据库卷与上传文件卷；不公开数据库端口。
- 应用只监听服务器 `127.0.0.1:18084`，由宝塔 Nginx 提供 HTTPS。
- 开放注册，保留应用自带认证限流。官方版本注册时发送验证邮件，但不强制验证邮箱才能登录。
- PDF 在浏览器生成。未配置可选的 AI Agent、Redis、S3 服务。
- 应用/数据库内存上限分别为 512/256 MiB。这是当前共享主机的初始限制，需通过实际运行确认容量；不代表已完成负载测试。

## 邮件配置

以 `cjw-deploy` 身份在服务器目录运行 `python3 configure.py`，交互填写 163 发件邮箱及 SMTP 授权码。授权码不会回显，也不会写入命令历史。程序只验证 SMTP 登录，不发送邮件。配置保存为仅账号可读的 `.env`；已存在时拒绝覆盖数据库和认证密钥。

163 参数：`smtp.163.com:465`，隐式 TLS，使用邮箱的 SMTP 授权码。

## 启动与核验

服务器管理员交互执行 `bash /home/cjw-deploy/reactive-resume/setup-server.sh` 可配置 SMTP、证书与 Nginx，并在镜像就绪后启动应用。再次执行会保留已有密钥和邮箱配置。脚本先检查 Nginx 配置，失败时恢复上一个文件。

已完成首次 SMTP 配置后，可加 `--wait` 以等待最多 60 分钟，待准备作业启动应用且健康检查通过，再启用 HTTPS。非交互运行仅适用于 `.env` 已存在的情况。查看 `prepare-images.log` 获取应用准备状态；HTTPS 成功标记是 `CJW_RESUME_HTTPS_READY`。准备失败或等待超时均不会开放入口。

数据库镜像使用 Docker 官方在 AWS ECR 的公开副本，已核验清单 SHA-256 与 Docker Hub 原镜像完全一致，避免服务器访问 Docker Hub 时的 `unexpected EOF`。应用镜像仍来自项目官方 GHCR。所有镜像均固定摘要。`verify-images.py` 兼容经典 Docker 的配置摘要和 containerd 镜像存储的清单摘要。

完成邮件配置后，在部署目录运行：

```sh
docker compose config --quiet
docker compose up -d --wait --wait-timeout 180
curl --fail http://127.0.0.1:18084/api/health
docker compose ps
```

不要直接把 `docker compose config` 或 `.env` 内容贴到聊天中，以免泄露凭证。

DNS 添加 A 记录 `resume` → `101.96.211.198`。现有主域名证书不覆盖子域名。
`nginx-http.conf` 为签发证书前的 ACME 验证入口；`nginx-https.conf` 为正式入口模板。
需由服务器管理员安装到单独的宝塔 vhost 文件；签发证书、检查 `nginx -t` 成功并确认应用健康后再启用 HTTPS 入口。
证书路径按 Certbot 默认路径准备，实际采用其他 ACME 客户端时必须相应修改。需要配置并验证自动续期。

## 数据与更新

`docker compose down` 保留数据；不要使用 `down -v`。
更新前备份数据库和上传文件。为保证两者一致，可在维护时间先停止 app，再备份 PostgreSQL 和 uploads 卷，最后启动 app。备份应另存服务器之外的安全位置；当前未配置自动备份。
更新通过修改镜像版本与摘要后重新创建容器。新版本可能执行数据库迁移，单纯换回旧镜像不保证可回滚，应保留配套数据库备份。

官方文档：https://github.com/reactive-resume/reactive-resume/blob/f89acb436865cf536fffed2b23d4d72a7ecff0db/docs/self-hosting/docker.mdx
