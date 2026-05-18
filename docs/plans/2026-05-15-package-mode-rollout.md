# 打包方式驱动的灰度系统

## 背景

灰度不能只按“流量百分比”建模。不同打包产物的上线控制面不同：

- 容器镜像：按镜像引用、容器/工作负载、流量百分比推进。
- 静态站点包：按 OSS/CDN 目录、分组、缓存 TTL 和回滚版本推进。
- 服务运行包：按主机实例批次、健康检查和回滚包推进。
- Kubernetes YAML：按 Deployment/Ingress/ServiceMesh 等控制器推进。
- Helm Chart：按 release、chart、values 和 namespace 推进。

## 当前落地

1. `PipelineBuildConfig.packageMode` 成为正式配置项。
2. `DeployArtifactRequest.rolloutStrategy` 使用 `packageMode` 做分支配置。
3. Release 记录保留 `rolloutPolicy` 兼容旧 canary，同时新增 `rolloutStrategy` 保存真实打包方式。
4. 页面在流水线配置的构建任务中提供“打包方式”选择。
5. 制品中心按制品类型展示镜像和构建包，并按打包方式显示不同灰度入口。
6. 当前已经接入五类真实执行路径：
   - `container_image`：`local-docker` 真实 `docker pull/run`，`kubernetes` 真实 `kubectl set image + rollout status`。
   - `static_site`：真实解包到 `STATIC_SITE_DEPLOY_ROOT`，生成版本目录并切换 `current`。
   - `server_package`：真实解包到 `SERVER_PACKAGE_DEPLOY_ROOT`，支持 `SERVER_PACKAGE_ACTIVATE_COMMAND` 和 `SERVER_PACKAGE_HEALTHCHECK_URL`。
   - `kubernetes_manifest`：真实 `kubectl apply -f`，Deployment 控制器会继续执行 `rollout status`。
   - `helm_chart`：真实 `helm upgrade --install --wait`，支持 chart、values、namespace。

## 后续执行器边界

- `static_site`：后续从本地发布目录升级到 OSS bucket、prefix、CDN domain、刷新接口和历史版本存储。
- `server_package`：后续从本地 release 目录升级到主机组、SSH/Agent、部署目录、启动命令、健康检查和回滚包。
- `kubernetes_manifest`：继续细化 ServiceMesh/Ingress 级真实流量切分。
- `helm_chart`：继续补 Helm rollback revision、history 查询和差异预览。
