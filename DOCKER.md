# Docker / TOS 7

本 fork 每 6 小时尝试合并 flizzywine/dsh-tavern 的 main，然后在同一条 Actions 流程中构建、启动测试并发布 GHCR 镜像。支持手动运行 `Docker sync, test and publish`；默认分支推送也会构建。GitHub 调度可能延迟，长期无活动的公开仓库可能暂停调度。fork 的 Actions 需要在网页启用。

镜像为 linux/amd64，标签为 `latest`、`sha-<12 位提交号>` 和完整提交号。只有容器通过空目录初始化、HTTP、重启持久化和升级路径测试后，才发布镜像。合并冲突时流程失败，保留原分支和旧镜像，不强制覆盖。

## 部署

首次发布后，将 GHCR package 的可见性设为 Public，或在 NAS 上使用有 read:packages 权限的账号登录 GHCR。TOS Compose 项目使用仓库根目录 `docker-compose.example.yml`；请按实际存储路径修改 `/Volume1/docker/dsh-tavern/data`。首次挂载目录必须为空。运行：

```sh
docker compose -f docker-compose.example.yml up -d
docker logs -f dsh-tavern
docker exec dsh-tavern node /data/apps/dsh-tavern/bin/dsh-tavern.mjs status
```

将 status 输出完整 URL 中的 `127.0.0.1:3081` 换成 `NAS-IP:3080`，保留 token。token 是访问凭证。容器内 socat 将 3080 转发到上游固定的 loopback 3081，不修改上游源码。

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
