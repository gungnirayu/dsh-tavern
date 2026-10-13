# Docker 局域网兼容审查（2026-10-13）

## 范围与结果

检查了当前 fork 的 CLI 启动、安装、Profile、Tavern HTTP 路由、主前端、侧边栏、主题及相关插件代码，以及 `config/cli-runtime/package-lock.json` 固定的 DSH 0.1.5-rc.2 依赖。实际安装检查了 524 个 npm 包；其中 @deepseek-ai 命名空间 241 个包、55 个编译后的浏览器 client.js。同时检查了硬编码 loopback 地址、Host/Origin fence、客户端 isLoopback 分支、URL 生成、HTTP 安全上下文 API、沙箱 iframe 的 opaque origin、HTTP 流与 WebSocket。

“所有 127.0.0.1 都替换掉”不是正确修复：容器内监听、健康检查、URL 解析基址和内网访问隔离仍应使用本机地址。本次按实际用途分类，保留容器内部约束，修复浏览器对外访问不兼容的边界。

| 位置 / 行为 | 结论 | 处理或验证 |
|---|---|---|
| CLI_HOST、start/stop、健康检查使用 127.0.0.1:3081 | 容器内部通信，保留 | 唯一外部入口为 :3080 的 HTTP 代理；无需映射内部端口 |
| DSH Connection 的 Host/Origin 和签名 cookie | 应保留认证 | 代理校验配置的公开 origin，再统一内部 authority；未登录和伪造来源回归测试 |
| Tavern 自定义 API 的 localhost Origin fence | 不兼容 NAS origin | 在统一代理处理；额外验证 cookie，真实 Tavern POST 测试 |
| Sidebar / Dream Skin 的请求 fence | 同样依赖 Host/Origin | 统一代理转换覆盖所有路径，不逐个改上游插件 |
| ui-settings 非 loopback 切换 memory | 阻止目录加载与设置持久化 | 镜像适配为 host；检查实际启动脚本与 settings describe RPC |
| ui-settings-general 的 documentController 本机判断 | 仅控制“在宿主原生编辑器打开 settings.yaml” | 保留；不是网页设置读写开关。NAS 无桌面编辑器，不伪装本机能力 |
| Connection/Gateway 的 isLoopback 事实、类型声明 | 不是额外权限开关 | 保留；审核其消费者，避免统一强制 isLoopback=true |
| directory-picker-auto | headless Linux 自动采用 browse 后端 | 保留 native/browse 区分；镜像不安装或暴露宿主桌面 chooser |
| http-proxy / sidebar browser loopback allowlist | 防止不受信页面访问本机服务 | 保留；不因 Docker 打包放开 loopback 网络限制 |
| 存档救援、侧边栏新对话直接调用 crypto.randomUUID | 非安全上下文 HTTP 可能缺少 API | bootstrap 在业务模块前统一补充基于 getRandomValues 的 RFC 4122 v4 UUID，保留原生实现 |
| Tavern 其他 UUID、DSH UUID helpers、iframe SHA-256 | 已有 fallback / scoped polyfill | 核查后保留；不伪造 isSecureContext，不移除浏览器安全边界 |
| sandbox="allow-scripts" 的人物卡请求 Origin:null | 原代理误拒绝只读资源 | 精确开放上游已公开的 GET 静态资源；session-resource/helper-history 必须有独立 cap 并由上游验证。公开资源补齐 CORS/CORP 响应头；POST 和一般 API 不适用例外 |
| 浏览器 API / SSE URL 使用 location.origin | 正确使用外部地址 | 非 loopback Chromium 与实际 RPC 测试 |
| 镜像删除安装根目录后仍在旧 WORKDIR 运行构建步骤 | 会重建空 apps 目录，阻止无挂载初始化 | 删除后切换到 / 再执行后续 RUN；独立浏览器容器覆盖无挂载启动 |
| 原 status 输出内部 127.0.0.1 URL | 用户容易复制到错误 IP/端口 | 新增 tavern-url，启动输出与 status helper 显示 PUBLIC_URL，保留 token |
| new URL(req.url, 'http://localhost') | 解析相对路径的基址，没有发起网络访问 | 保留 |
| 系统剪贴板、原生应用/编辑器、用户第三方脚本 | 浏览器/宿主或外部脚本能力，不能等同于 NAS 自带功能 | 保留现有降级和手动操作；不宣称 HTTP 页面拥有 HTTPS 权限，不审计任意用户人物卡/插件代码 |

## 已加入发布检查

1. 固定依赖的浏览器地址策略扫描：已审核的连接事实和原生编辑器开关按精确代码登记；新增或变化的 loopback/secure-context 判断会令构建失败，避免自动发布未经审核的新策略。
2. 原子、幂等的镜像客户端适配：上游设置/引导模块结构变化明确失败；启动后修复升级过程中重新安装的依赖。
3. HTTP proxy 测试：真实 Host/Origin、token/cookie、未登录拒绝、跨源拒绝、WebSocket、公开静态 GET、合法/非法 cap、Origin:null 的普通 API 拒绝。
4. 非安全上下文 UUID 测试：格式、唯一性、原生实现保留、重复初始化。
5. 镜像 smoke：空 bind mount、重启和升级保留数据，真实 Tavern POST、设置目录、浏览器实际 batch 脚本、公开登录 URL、opaque sandbox 路由。
6. 真实 Chromium：`http://tavern.test:3088`（DNS 映射到测试 runner，仅网络目的地为本机；页面 origin 仍为非 loopback，isSecureContext=false），点击模型设置，读取设置/提供方目录，验证 UUID 与 sandbox iframe 请求。此测试不调用付费模型、不使用用户凭证。

## 部署

Compose 保持 `DSH_TAVERN_PUBLIC_URL` 与浏览器 origin 一致。更新镜像后使用 `docker exec dsh-tavern tavern-url` 取得直接可用的登录 URL，无需手动改端口。刷新浏览器缓存以加载新 bootstrap。

## 结论的边界

这些检查覆盖已固定的上游版本和列出的 NAS 功能路径，能防止已发现问题及可识别的新地址策略未经验证进入 latest。不能保证任意未来源码、浏览器版本、模型提供方或用户自定义人物卡/脚本永远没有问题；未检查的未来实现变化需要重新审核。审核文件是可追溯的检查记录，不是无限期兼容承诺。
