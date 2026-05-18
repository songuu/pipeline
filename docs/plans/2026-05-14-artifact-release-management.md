# 打包制品统一管理与上线闭环

## 目标

当前流水线已经能完成真实代码拉取、包构建、Docker build 和 ACR push。本轮补齐最后一段：

1. 将镜像、包、provenance 统一进入制品中心。
2. 镜像制品可以作为一等对象触发上线。
3. 上线后生成发布记录，并回写目标环境当前版本、镜像和 digest。
4. 本地优先支持 `local-docker` 真实部署；服务器环境可切到 `kubernetes` 执行 `kubectl set image` 与 `rollout status`。

## 已实现

- 新增共享模型：`DeployArtifactRequest`、`ReleaseDeployment`、`ReleaseStatus`、`ReleaseTarget`。
- 新增 API：
  - `GET /api/releases`
  - `POST /api/artifacts/:artifactId/deploy`
  - `GET /oapi/v1/flow/releases`
  - `POST /oapi/v1/flow/artifacts/:artifactId/deploy`
- 新增后端模块：`ReleasesModule`。
- 上线执行：
  - 默认 `local-docker`：`docker pull`、删除旧容器、`docker run -d`、检查容器运行状态、解析本地访问端口。
  - `RELEASE_DEPLOY_TARGET=kubernetes`：需要 `KUBECONFIG`，执行 `kubectl set image` 和 `kubectl rollout status`。
- 环境回写：上线成功后更新 `DeploymentEnvironment.currentVersion/currentImage/currentDigest/lastReleaseId/deployedAt`。
- 前端制品中心：
  - 统一展示镜像制品、构建包、上线记录、环境状态。
  - 镜像支持一键复制 `docker pull` 和镜像引用。
  - 镜像支持按 `test / staging / prod` 触发上线。

## 验证

- `pnpm --filter @deploy-management/shared build`
- `pnpm --filter @deploy-management/api check`
- `pnpm --filter @deploy-management/web check`

## 后续可扩展

- 将 release 记录持久化到数据库。
- 为 Kubernetes target 增加 deployment/container 选择器 UI。
- 增加回滚接口：使用历史 `ReleaseDeployment.imageRef` 重新执行上线。
