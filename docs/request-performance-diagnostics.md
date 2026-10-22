# 页面同步慢请求诊断

更新插件并重启服务、刷新页面后自动启用。再次卡顿时先导出当前会话诊断包，再重启；无需打开开发者工具。内存记录有容量上限，刷新页面会清空浏览器记录，重启服务会清空服务端记录。

在 `performance/summary.json` 查看：

- `requests.recent`：最近 120 次被跟踪的服务端请求（会话同步及下述开局 RPC）。
- `requests.slow`：最近 60 次服务端耗时至少 1 秒的上述请求。
- `browser.requests`：最后一个上报页面最近 60 次被跟踪的请求，导出诊断包时主动上报。

使用 `id` 对齐两侧记录。`active` 是各侧正在处理的被跟踪请求数，不是所有 HTTP 连接数。浏览器的 `headersMs`、`parsedMs`、`durationMs` 均从请求发起算起；解析失败等情况可能没有 `parsedMs`，失败时标记 `failed`。

服务端 `receivedAt` 是进入插件分发层的时间，不包含此前的网络传输和宿主请求解析。`stages` 标记存档读取、人物卡读取、设置、扩展、远程资源、历史投影、整体视图投影、剧本预览或候选同步；整体视图投影包含部分子阶段，不能把所有阶段直接相加。`activity` 是采样时的前后台运行状态。

`eventLoopDelayMaxMs` 是请求期间 100 毫秒定时器观测到的最大延迟，`eventLoopUtilization` 是同一时段进程事件循环利用率；均不能直接归因于该请求自身。高延迟可能来自同时运行的其他任务。

浏览器很慢而服务端较快时，进一步检查传输、宿主排队和浏览器处理；某个服务端阶段慢时，再沿该阶段定位。跨设备时钟可能不同，不要直接将 `sentAt` 和 `receivedAt` 的差解释为网络延迟。

新计时记录不保存正文、请求参数、响应内容、文件路径或密钥。诊断包原有的会话和人物卡附件仍按原规则导出。

## 开局性能

更新并重启服务、刷新浏览器后，重现一次开局慢，再从酒馆的“导出 → 日志”下载诊断包。查看同一个 `performance/summary.json`；单独导出的原生 Session 文件不会包含这些数据。开局前记录也会随之后建立的会话一起导出，不需要打开开发者工具。

- `browser.openings`：最近 120 条浏览器阶段记录。`preparePreview` 从点击人物卡到预览数据准备完毕；`startClick` 从点击开始到启动流程返回；`claimPrewarm` 是等待工作区预热；`startGame` 及其子阶段涵盖清理空会话、解析工作区、连接、等待 Session、设置预设、写入开场和打开会话。若开场按钮自动发送消息，另有 `submitInitialMessage`，其耗时由宿主命令返回时机决定，不能当作模型首 token 延迟。预览数据就绪和打开会话均不等于 iframe 所有资源加载完成或首帧已绘制。
- `browser.openingRequests`：单独保留最近 60 次开局 RPC，包括 `getCardOpenings`、`initializeOpeningTemplate`、`preparePlayStart`、`startChat`。`headersMs` 为收到响应头，`parsedMs` 为读取并解析完成，均从请求发起计时。`bodyChars` 是解码后的字符串长度，不是网络字节数；`responseBytes` 只在服务端提供 Content-Length 时存在，可能是压缩后大小。
- `requests.openings`：服务端对应的最近 60 次开局 RPC，包含阶段耗时。`getCardOpenings` 拆分 `readCard`、`readExtensions`、`resources`、`preview`、`prepare`；`initializeOpeningTemplate` 拆分 `templateInitialize`；预设预热为 `preparePreset`。`startChat` 包含需要时的 `openingDraft` 和 `initializeConversation`：`openingDraft` 内部为 `prepCard`、`prepWorldbook`、`prepExtensions`、`prepSettings`；`initializeConversation` 内部为 `settings`、`card`、`cardDefaults`、`script`、`preset`、`extensions`、`snapshot`、`publish`、`nativeAppend`、`present`，等待原生会话可写为 `waitSession`，设置新游戏默认模型为 `selectModel`；复用已有会话时只有 `session` 和 `reopen`。`snapshot` 含常驻世界书投影与场景世界书捕获，`publish` 为首次写入对话存档，`present` 为返回页面前的整份视图投影。阶段记录只保留名称与毫秒数。`startChat`、`openingDraft`、`initializeConversation` 为嵌套范围，父子耗时不要相加。

两侧 RPC 使用同一个 `id` 对照。浏览器点击阶段的 `id` 用于组合一次动作的子阶段，是独立的动作 ID；不能直接与 RPC ID 匹配。可结合浏览器时间顺序判断动作发出了哪些 RPC。`startClick` 和 `startGame` 为嵌套范围，父子耗时不要相加。跨设备时钟不同，仍不要直接相减两侧绝对时间。

浏览器阶段保留 `running/completed/failed`，导出时仍在等待的阶段会显示当前耗时；失败记录不保存错误文本。RPC 分段在请求结束后归档，正在挂起的 RPC 可能尚未出现，结合浏览器 `running` 阶段判断。开局 RPC 单独留存，不会被普通会话同步挤出；同一服务进程和最后上报浏览器共享这些有界记录，并非仅当前会话。刷新浏览器或重启服务会分别清空各侧记录，请先导出再重启。
