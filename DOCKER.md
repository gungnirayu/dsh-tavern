# Docker / TOS 7

本 fork 每 72 小时尝试合并 flizzywine/dsh-tavern 的 main，然后在同一条 Actions 流程中构建、启动测试并发布 GHCR 镜像。以 2026-10-13 为起点，每隔三天北京时间 11:17 执行；工作流每日检查日期，其余日期跳过构建，跨月也保持三天间隔。支持手动运行 `Docker sync, test and publish`；默认分支推送也会构建。GitHub 调度可能延迟，长期无活动的公开仓库可能暂停调度。fork 的 Actions 需要在网页启用。同步保留 fork 的 `.github/workflows`，仅跟随上游程序源码和其他文件，避免 GITHUB_TOKEN 无 workflows 权限导致同步失败；需要更新上游 CI 时单独审核修改。

镜像为 linux/amd64，标签为 `latest`、`sha-<12 位提交号>` 和完整提交号。只有容器通过空目录初始化、HTTP、重启持久化和升级路径测试及 NAS Origin 下的 token 登录、真实 Tavern API POST、未登录和跨站拒绝测试后，才发布镜像。合并冲突时流程失败，保留原分支和旧镜像，不强制覆盖。

## 部署

首次发布后，将 GHCR package 的可见性设为 Public，或在 NAS 上使用有 read:packages 权限的账号登录 GHCR。TOS Compose 项目使用仓库根目录 `docker-compose.example.yml`；请按实际存储路径修改 `/Volume1/docker/dsh-tavern/data`。首次挂载目录必须为空。运行：

```sh
docker compose -f docker-compose.example.yml up -d
docker logs -f dsh-tavern
docker exec dsh-tavern tavern-url
```

`tavern-url` 直接输出配置的 PUBLIC_URL 登录地址，保留 token，无需手动替换 IP 或端口。token 是访问凭证。容器内 HTTP 代理监听 3080；必须设置 `DSH_TAVERN_PUBLIC_URL` 为浏览器访问的完整 origin（例如 `http://192.168.1.10:3088`），并让 Compose 对外端口与之匹配。代理先验证 Host、Origin 和跨站标记，再转换为 DSH 的 loopback 地址；上游的 token/cookie 验证继续保留。对 Tavern 自定义路由也会先通过 DSH 验证 cookie。支持 HTTP 流式响应和 WebSocket。

旧版 socat 镜像升级后，应重新打开当前 token 链接登录：内部 cookie authority 已转换为 loopback，原来的 NAS authority cookie 不再使用。此前手动添加的 web-runtime/connection trustedHosts 覆盖可以删除；不要删除其他用户配置。PUBLIC_URL 变更后需要重新创建容器。代理只接受配置的一个公开地址；如经 NPM 使用 HTTPS 域名，PUBLIC_URL 应为该 HTTPS origin，NPM 应保留浏览器的 Host。

## 更新与备份

```sh
docker compose -f docker-compose.example.yml pull
docker compose -f docker-compose.example.yml up -d
```

首次启动从镜像复制完整安装；同版本重启不重新安装。版本变化时，先把整个 /data（不包含 backups）备份到 `/data/backups/docker-*.tar`，然后更换受管理的 apps/runtime/tools，并调用上游 profile 安装器合并配置。profile-data 和 settings.yaml 不由复制步骤覆盖；上游迁移可能修改数据，所以更新前备份很重要。升级配置阶段可能需要访问 npm，失败时不会写入新版本标记，下次重启会再次尝试。备份需要额外磁盘空间，含 API 配置等敏感内容，应妥善保存并定期清理旧备份。不要在 Web UI 内更新程序，统一通过镜像更新。

回滚：停止容器，将当前数据目录另存，在空目录中解压更新前 tar 备份，并将 Compose 镜像改为备份对应的 `sha-...` 标签后启动。单独换旧镜像不能保证撤销数据迁移。

## 本地构建

```sh
docker build --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" -t dsh-tavern:local .
```

Dockerfile 直接安装 checkout 源码，避免 install.sh 的 Git 路径重新拉 main、覆盖指定目标提交。使用仓库锁文件及上游 CLI/profile 安装模块，不在镜像构建时启动服务。健康检查验证内外两个端口；连续失败会让容器退出并由重启策略恢复。tini 负责回收子进程，退出时通过上游 stop 命令停止服务。

## 模型设置的局域网适配

DSH 0.1.5-rc.2 的设置前端对非 loopback 浏览器地址主动使用 memory 模式，会显示 `settings are unavailable in this browser`。镜像的 settings-adapter 仅修改该客户端的持久化选择，允许已通过 Docker 代理认证的 NAS 页面读取和保存服务端设置。构建和启动时均检查适配；上游实现变化会明确失败，避免静默发布不可用设置页。代理的 Host/Origin 和登录验证继续生效。CI 验证实际提供的客户端模块和 settings describe RPC。

## 局域网兼容审查

完整检查范围、保留与修复的判断、回归测试和实际限制见 [DOCKER-AUDIT.md](DOCKER-AUDIT.md)。Docker bootstrap 统一补上 HTTP 页面可能缺少的 UUID API；不伪造安全上下文。人物卡 Origin:null 仅开放明确的静态 GET 及上游 cap 验证的资源接口，不开放任意设置 API。新增 DSH 客户端地址策略必须经过审核，真实非 loopback Chromium 测试通过才发布。
