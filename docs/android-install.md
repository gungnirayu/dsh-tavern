# Android 安装与更新

## 独立 APK（Android 11+ / ARM64）

[下载 DSH Tavern Android APK](https://github.com/flizzywine/dsh-tavern/releases/latest/download/dsh-tavern-android-release.apk) · [下载 SHA-256 校验文件](https://github.com/flizzywine/dsh-tavern/releases/latest/download/dsh-tavern-android-release.apk.sha256)

独立 APK 内置 DSHA v0.2.0-rc2 与 DSH 0.2.0-rc.2，只启动酒馆自己的 `tavern` Profile（端口 3080）。手机上只运行这一个 DSH 服务。

1. 下载 APK（约 480 MB，内含酒馆源码与全部依赖），按 Android 提示允许当前浏览器或文件管理器安装应用，然后安装。
2. 打开「DSH Tavern」，按首次引导完成内置环境部署（离线解压，不需联网）；随后应用会就地解包内置的酒馆与依赖并完成安装，**全程不需要联网**，通常 1–3 分钟。
3. 安装完成后会自动进入酒馆；在酒馆设置中配置文字模型，再导入人物卡。
4. 以后直接打开此应用；酒馆源码更新在应用内完成（更新时才联网），更新后返回启动页重启。安装新 APK 时，如果之前没在应用内更新过酒馆源码，启动阶段会直接用新 APK 内置的快照离线升级源码和依赖，不必再等一次联网全量更新。

APK 内置首装所需的源码快照、pnpm 依赖仓库与 pnpm 运行时，首次启动只做本地解包，不再逐包下载。首装完成后源码快照会被清理，依赖缓存则转存到 `~/.dsh/runtime/tavern-pnpm-store`：以后的应用内更新按运行清单只下载有变化的源码文件，依赖直接从本地缓存链接，不再整包重下。缓存占用约一两百 MB，空间紧张时可以删除，下次更新会重新下载。内置依赖缺项（例如源码版本比 APK 新）时会自动改用 npmmirror 联网补齐，失败再用官方源 registry.npmjs.org 重试一次；仍失败时保留错误日志，再点击启动重试。

应用内更新会在侧栏显示安装器当前步骤（下载源码、安装依赖、写入配置等）；手机网络较慢时可能停留较久，但只要有新输出就不会被判定为卡住，整个过程最多 30 分钟。

安装日志位于容器内 `/root/.dsh/logs/tavern-install.log`，每一步都有 `== [步骤 N] …（已用 Xs）==` 抬头和 pnpm 逐行进度，可以直接看出卡在哪一步。

APK 使用独立包名 `io.github.flizzywine.dshtavern.standalone`，可以与旧版 v2.1 APK（DSH 0.1.5）和原版 DSHA 同时安装，数据各自独立。旧版 v2.1 APK 与本包签名不同，不能覆盖升级：先在旧包里导出存档和人物卡，装好本包后按 [数据导入](data-import.md) 导入。两个应用不要同时运行。

Android 安装包不从应用内自更新：新版本从 [Releases](https://github.com/flizzywine/dsh-tavern/releases) 下载，直接覆盖安装同一包名的新 APK。不要为了更新先卸载应用，以免删除应用数据。

Android 仅提供独立 APK，要求 Android 11 及以上、ARM64；不再提供通过 DSHA 安装的方式。

> 不同手机系统、网络和后台限制都可能导致安装或运行失败；当前安装脚本只能修复项目已知问题。
