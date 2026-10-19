# CLI 独立运行时与宿主版本策略

> 后续交付方向以 [ADR 0007：内置固定 DSH、独立发行](../adr/0007-bundle-and-pin-dsh-runtime.md) 为准。本文记录既有 CLI 实现及历史验证，不代表桌面、安卓仍长期依附官方宿主。

本版 CLI 固定安装 DSH 0.1.2-rc.1。Desktop 推荐 2.0.5（发布说明对应 DSH 0.1.2-rc.1），DSHA 推荐 1.2.0-rc1.4（预览版，发布说明对应相同 DSH 版本）；两个宿主均只提示、不阻止其他版本，也不自动更换宿主。

Desktop 下载：https://www.deepseek.com/harness/ 。选择对应平台的安装包。

DSHA 下载：https://github.com/DSH-APP/DSHA/releases 。找到 v1.2.0-rc1.4，展开 Assets，选择 APK。

## CLI 边界

默认根目录为 `~/.dsh-tavern/`，可用 `DSH_TAVERN_CLI_HOME` 指定。源目录的 `.dsh-tavern-local.json` 保存安装宿主和数据根目录，让新终端启动及更新沿用原位置。CLI 子进程显式接收该目录作为 `DSH_HOME`。

- `runtime/`：安装和更新先检查私有 DSH 的版本及 `--version` 启动结果；匹配且可启动时直接复用。缺失、版本不同、启动失败或设置 `DSH_TAVERN_REINSTALL_RUNTIME=1` 时，在临时目录下载精确版本，再替换私有运行时。不会复用全局 DSH，也不会把旧依赖目录增量混入。npm 可以复用下载缓存。
- `tools/`：安装器需要的 pnpm；不加入 Desktop 的搜索路径。
- `profiles/tavern/`、`profile-data/tavern/`：独立插件配置、原生 Session 历史及游戏资源。
- `settings.yaml`、`.credentials.yaml` 等：独立模型配置和认证信息。
- `logs/`、`apps/`、`source-cache/`：本安装的服务记录、程序及下载缓存。

启动只寻找私有 DSH，缺失时要求重新安装，不回退全局版本。仍使用系统 Node.js，当前不打包 Node.js。指定 DSH 顶层版本不等于冻结 npm 所有传递依赖；新安装仍需通过依赖与接口检查。

## 旧安装迁移

仅当原 `DSH_HOME/profiles/tavern/package.json` 标记宿主为 CLI 时，首次复制该 Profile 的原生数据、配置、凭据及附件。复制前停止旧 CLI，原件保留，不复制宿主 node_modules。完成标记使后续重装不覆盖新目录中的游戏进度。Desktop/Android 数据不会自动迁入。

新建 CLI 无旧 CLI 数据可迁移时，需要单独配置模型。源码手动安装仍须先安装项目依赖；CLI 安装步骤负责安装 DSH。

## 失败与更新

私有 DSH 下载失败保留原运行时；配置校验失败恢复原私有运行时。该恢复不表示整个程序更新是原子事务。更新仍采用既有源码更新流程。安装入口先停止本安装服务，再替换文件；Desktop 与 DSHA 按原宿主管理方式重启。

## 验证（2026-09-10）

- 使用实际下载的私有 DSH 0.1.2-rc.1 运行全量测试：1870 项通过。
- macOS 临时目录真实安装：在 PATH 放入故意失败的全局 dsh，仍完成独立下载、宿主依赖检查和 Profile 配置校验。
- 不传安装时的 CLI_HOME，使用保存的安装信息真实启动、检查服务就绪并停止；进程来自私有 runtime，模拟的外部 DSH 目录未被改动。
- 迁移与运行时恢复覆盖原生历史复制、重装不覆盖、拒绝迁入 Desktop/Android 数据、下载失败保留旧运行时及配置失败回退。
- Windows 中文、空格和 shell 字符路径通过跨平台夹具检查；本次未在 Windows 或 Android 实机重新安装验证。
