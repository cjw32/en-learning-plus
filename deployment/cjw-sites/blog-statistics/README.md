# 博客统计与机器人置顶（2026-09-17）

线上：https://cjw32.xyz/blog/
博客仓库：cjw260/blog-page；最终提交 988cfeaf706f63f1971d359c66c9329e3158c9c0。
最终自动构建/发布成功：https://github.com/cjw260/blog-page/actions/runs/35177015189
首次统计发布成功：https://github.com/cjw260/blog-page/actions/runs/35176727246
首次连接被重置的失败任务：35176541120；已在工作流补充最多 3 次 SSH 传输错误重试。

## 功能与实现

- 自托管 Python/SQLite PV/UV 服务，独立容器 cjw-blog-page-stats-1，无公网端口、无发布/Git 凭证，96 MiB 内存上限。
- 浏览器生成持久匿名标识，后端保存加盐摘要；UV 按浏览器去重，PV 按实际页面打开计算，首页展示卡片不增加文章 PV。请求事件去重、渲染路径白名单、同源检查、基础限流。
- SQLite 持久化目录 /opt/cjw-sites/blog-page/data/stats。每次发布前在线备份，保留最近 7 份；已核验再次部署后文章计数仍为 PV=3、UV=1。
- 卡片和详情页显示统计，PV 单位次、UV 单位人。手机宽度 390px 验证无横向溢出、更新时间与统计按钮不重叠。
- 机器人插件 1.4.0 / publisher-runtime:5：读取、搜索、预览包含 index；0 取消置顶，正整数置顶，越大越靠前，上限 10000。仍需完整预览后新消息确认，自动更新 updated_at，保留原链接/发布日期/未改字段。
- 没有擅自指定真实文章置顶，没有修改真实文章内容。仅本地临时文章验证排序、角标、更新时间；已删除，最终构建为真实 42 篇文章。

## 验证

35 项发布服务测试、6 项工具测试、6 项统计服务测试通过；Astro 检查、TypeScript 检查、站点构建及文章契约测试通过。机器人线上置顶预览只暂存，验证原文 SHA 不变并清理测试稿。九项工具注册正常、飞书 WebSocket ready。
浏览器实际首页 → 文章 → 再次阅读确认，文章 PV 从 2 到 3，UV 保持 1。最终服务均 healthy。完整飞书对话中的置顶确认由主人选择具体文章后执行。

## 回滚

博客通过 /opt/cjw-sites/blog-page/previous 保留上一成功部署。统计数据库应保留，不随代码回滚删除。
机器人备份：/opt/cjw-ai-blog/backups/pin-feature-20260917-110033，旧 publisher-runtime:4 镜像保留。
