# CitrusGrid 迁移记录

用户确认：沿用 cjw260/blog-page 仓库、https://cjw32.xyz/blog/ 地址，验证后替换线上站点。迁移开发在 codex/citrus-grid-migration 分支，工作目录 /private/tmp/cjw-blog-citrus。

迁移前提交：b18bcac461f179b6a430e83e28e1c501cf95b3cf。迁移提交：7ae4134。42 篇 public/markdown 原文的文件名和每个字节均不变；图片原始 URL 保留，渲染时映射到迁入的 15 张文章图片及头像。现有分类、标签、摘要、发布日期及 updated_at 在 Astro 内容加载时映射，继续兼容服务器 /opt/cjw-ai-blog 的原有发布接口。

检查：Astro check 和 TypeScript 检查通过；生产构建通过（67 页，Pagefind 索引 42 篇）；五项迁移测试通过；新增/修改/删除文章兼容流程用本地临时稿连续三次构建验证，最后删除临时稿并恢复构建；浏览器站内搜索、防抖搜索结果跳转、窄屏布局、桌面导航边界通过。最终 pnpm production audit 为 0 项已知漏洞。

回滚配置备份：/opt/cjw-sites/blog-page/backups/pre-citrus-20260917-101955。现有部署脚本保留 previous 发布目录并在新容器不健康时自动回滚。已发布正文不依赖博客助手在线。

已知旧缺图：2025101601.md 第 76 行引用原 Windows 电脑 Typora 图片 image-20251016121355790.png，仓库与服务器均无原文件。保留原文，在新站展示缺图说明，待获得原图片后补齐。

代码及最终 README 位于原 GitHub 博客仓库；该目录仅保存迁移记录和基线清单。

## 最终线上验收

GitHub Actions https://github.com/cjw260/blog-page/actions/runs/35174063136 的 build、deploy 均成功，提交 7ae41342f0cf9d50f633319ba6aeda59dd1e6285 已上线。

公网逐篇检查：42 个原文章 URL 全部 HTTP 200；42 个 Markdown 文件 SHA-256 全部与原始基线相同；16 个迁入图片文件（15 张文章图及头像）逐一哈希一致；分类、标签、归档、RSS、sitemap、Pagefind 均可访问；不存在的文章及 Markdown 返回真实 404。

生产博客助手检查：防抖主题查询通过、原文章全文读取通过、既有删除任务状态仍正确返回 removed。未对真实文章执行测试修改或删除。飞书工作说明已同步为 Astro/CitrusGrid，现有权限、密钥和数据目录保留。
