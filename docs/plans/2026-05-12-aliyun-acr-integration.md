# 阿里云 ACR deploy 仓库接入

status: completed

## 需求分析

- 将已在阿里云容器镜像服务中创建的 `deploy` 仓库接入流水线。
- 默认镜像仓库必须是真实可推送地址，不再使用示例或占位 registry。
- 构建、打包、上传、运行详情产物复制都要沿用同一条镜像引用。
- 密码不进入源码；真实推送通过 Kubernetes docker-registry Secret 注入 Kaniko。

## 技术方案

- 共享模型新增阿里云 ACR 默认配置：
  - 公网地址：`crpi-yjy3pqx1wqed2s2s.cn-hangzhou.personal.cr.aliyuncs.com`
  - VPC 地址：`crpi-yjy3pqx1wqed2s2s-vpc.cn-hangzhou.personal.cr.aliyuncs.com`
  - 命名空间：`company_sy`
  - 镜像仓库：`deploy`
  - 登录用户：`songyu19960525`
  - Secret：`aliyun-acr-deploy-secret`
- 共享模型同时提供镜像托管 preset 配置：
  - 默认 provider 是 `aliyun-acr`，保持当前阿里云 deploy 仓库即开即用。
  - 可切换 provider：`harbor`、`docker-hub`、`tencent-tcr`、`aws-ecr`、`custom`。
  - 新增镜像托管只需要补充 preset 默认 registry、namespace、service connection 和 Secret 名称。
- API 创建/更新流水线时保留并规范化 ACR 元数据。
- 运行时向 Tekton bridge 传递 `REGISTRY_PROVIDER`、`IMAGE_REF`、`REGISTRY_USERNAME`、`REGISTRY_DOCKER_SECRET` 等参数。
- Tekton bridge 优先使用 PipelineRun 参数中的 `REGISTRY_DOCKER_SECRET` 挂载 `docker-config` workspace，兜底使用 `TEKTON_DOCKER_SECRET`。
- UI 上传配置默认展示阿里云 ACR，并支持公网/VPC 地址切换。

## 任务拆解

- [x] 共享类型和默认 ACR 配置
- [x] 镜像托管 provider preset 配置
- [x] API DTO / normalize / run params
- [x] Web 配置页 provider 选择和表单字段
- [x] Tekton bridge per-run docker secret 挂载
- [x] README / bridge README 操作说明
- [x] 验证构建与解析结果

## 验证

- `pnpm --filter @deploy-management/shared build` passed
- `pnpm --filter @deploy-management/api check` passed
- `pnpm --filter @deploy-management/web check` passed
- `pnpm --filter @deploy-management/api build` passed
- `go build -tags tekton ./...` passed
- `go test -tags tekton ./...` passed
- `pnpm --filter @deploy-management/web build` passed with elevated filesystem permission for `.next`
- `node -e ... resolveImageArtifact(...)` produced `crpi-yjy3pqx1wqed2s2s.cn-hangzhou.personal.cr.aliyuncs.com/company_sy/deploy:run-1-f045fad1`

## 审查结果

- P0/P1: none.
- 风险：真实推送仍要求目标 Tekton namespace 中存在 docker-registry Secret，且 Secret 密码需使用阿里云 ACR 登录密码或 RAM 用户凭据。

## 复利记录

- 阿里云 ACR 接入不要把 registry URL 当浏览器 URL；复制给用户时应优先提供 `docker pull <image-ref>` 或 Kubernetes `image:` 字段可用的 OCI 引用。
- 镜像仓库凭据在代码层只保存 Secret 名称，实际密码由集群 Secret 管理。
