# 独立 Android APK

APK 内置 DSHA v0.2.0-rc2 的 Ubuntu、Node 和 DSH 0.2.0-rc.2 运行环境。首次启动通过联网下载
`flizzywine/dsh-tavern` 的 `main`，执行仓库中的 Android 安装器；安装完成后原生层固定启动
`tavern` profile（端口 3080），不再拉起 DSHA 的 `web` profile，所以手机上只有一个 DSH 服务。
用户无需输入命令。安装成功才写入完成标记，失败可点击启动重试；日志保存在容器的
`/root/.dsh/logs/tavern-install.log`。

包名为 `io.github.flizzywine.dshtavern.standalone`，与上游 v2.1 APK（DSH 0.1.5）及原版 DSHA
可同时安装，数据彼此独立。它**不能覆盖升级 v2.1**：两者签名不同。切换时先在旧包导出存档与
人物卡，再按 [数据导入](../docs/data-import.md) 导入。现阶段只构建标准版，要求 Android 11+、
ARM64。Tavern 的源码更新继续由酒馆管理，安装更新后返回原生界面重启即可。独立 APK 禁用 DSHA
官方 APK 更新源，避免安装回原版；宿主更新通过重新发布此 APK。

版本号独立于 DSHA：`versionCode = major*10000 + minor*100 + patch`（3.0.0 为 `30000`），
后续发布必须递增；`versionName` 与酒馆版本一致。

## 构建

需要 Git、Python 3.9+、Node.js 22+、npm、curl、JDK 17+，以及 Android SDK 平台 `android-37.0`
和 Build Tools `37.0.0`。设置 `JAVA_HOME`、`ANDROID_HOME` 后：

```sh
bash android/apk/build.sh
```

脚本下载并验证锁定版本的 DSHA 官方 APK，将其中已经生成的运行环境资产原样复用，补齐旧
WebView 的 `structuredClone` 后重新编译原生程序。兼容代码使用上游锁文件中的 core-js，并在
构建时验证循环引用、Map、Date 和二进制数据的克隆结果。默认输出
`output/android-apk-020/dsh-tavern-android-debug.apk` 及 SHA-256。

## 首装离线包

构建会先用 `android/apk/build-offline-bundle.sh <commit>` 采集当前提交的离线包
（`tavern-offline-<commit>.tar.gz`，约 120 MB）：源码快照 + pnpm store（287 个依赖）+
pnpm 运行时。它作为 `assets/tavern-offline.bin` 打进 APK，首装时只需解包，不必逐包下载。

> 资产后缀必须是 `.bin`：aapt 会把 `.tar.gz` 静默解成 `.tar`，112 MB 的包会摊成 478 MB。
> 内容仍是 gzip 压缩的 tar，容器内落地为 `/root/tavern-offline.tar`。

- 采集命令可单独运行，结果按 commit 缓存；重复运行直接命中。
- 采集结束会做一次「空目录 `--offline` 安装」自检，依赖不全直接失败，不会产出坏包。
- 依赖全是纯 JS/wasm（锁文件里唯一平台限定包是 darwin 的 `fsevents`），x64 构建机采的
  store 可直接给 arm64 手机用。
- `TAVERN_APK_OFFLINE=0` 可关掉，恢复到联网首装；`TAVERN_OFFLINE_PKG` 可指定已有包。

首装逻辑在 `android/setup.sh`（选源码）与 `android/install.sh`（装依赖）：内置包命中时先走
`--offline`，缺包再联网补齐；源码快照没有被 Git 跟踪的历史，因此写 tarball 标记。

首装成功后，内置包里的 pnpm store/cache 会转存到 `~/.dsh/runtime/tavern-pnpm-store`（和
`tavern-pnpm-cache`），供后续更新直接复用；更新时只按运行清单增量下载有变化的源码文件，
不再整包重下源码和 287 个依赖。缓存可随时删除，下次更新会重新下载。

覆盖安装 APK **不会**无条件重装酒馆。`TavernBootstrap` 只在两种情况下在启动阶段用内置快照
离线替换源码和依赖（不联网）：

- APK 内置的源码版本（`package.json` 的 version）高于已装版本——即真正的酒馆版本升级；
- 上次离线安装被中断（`upgradePending` 标记还在）——下次启动续装，最多两次，换 APK 后重置计数。

同版本重打包（只改安装器、签名或 APK 侧逻辑）直接跳过，不会让用户再等一次安装。安装没完成时
源码会回滚，应用继续用旧版本，不会打不开。

上游的 `prepareStandardAssets` / `prepareRecoveryAssets` 会从源码重建整个 rootfs；这里跳过
它们，直接使用官方 APK 中已验证的产物。上游的依赖校验清单没有收录 Linux 版 aapt2，
构建使用 `--dependency-verification=lenient`：缺失条目放行，摘要不符仍然失败。

发布时设置 `TAVERN_APK_MODE=Release`、`DSHA_KEYSTORE`、`DSHA_KEYSTORE_PASSWORD`、
`DSHA_KEY_ALIAS`、`DSHA_KEY_PASSWORD`。上游 `verifyPublishCertificate` 只接受 DSHA 的
E7E3 发布证书，因此 Release 先产出未签名包，再由构建脚本用酒馆独立、长期保留的签名密钥
签名；密钥不要提交到仓库，发布前确认离线备份。后续 APK 更新必须沿用同一密钥。

## 更新内置 DSHA

1. 修改 `prepare.py` 的 `COMMIT`、`APK_SHA256`（从 DSHA release 下载后计算并与发布页核对）。
2. 修改 `build.sh` 的 `VERSION`、`COMMIT`、APK 地址。
3. 逐个核对补丁锚点；`replace()` 要求锚点唯一，失配会直接失败，不会产出坏包。
4. 重新走一遍首次安装、单进程检查（`ps -ef | grep -E "dsh|node"`）、应用内更新和存档导入。

DSHA 来源：<https://github.com/DSH-APP/DSHA>，MIT 授权。
锁定提交、官方 APK 摘要见 `prepare.py`，许可证随 APK 一起打包。
