# 2026-05-18 区域百分比灰度发布

## 目标

打包和上传完成后，制品中心触发上线时，不再只有单一灰度百分比。灰度发布必须携带区域维度，例如 `cn-hangzhou 10%`、`cn-shanghai 5%`，并在 release、rollout step、页面展示和后续推进日志中保持一致。

## 数据契约

- `CanaryTrafficRegion`：灰度目标区域配置，包含 `id`、`name`、`percent`、`enabled`。
- `CanaryRolloutPolicy.regions`：发布策略保存用户选择的区域目标百分比。
- `CanaryRolloutStep.regions`：每个灰度批次保存该批次实际切入的区域流量。
- `ReleaseDeployment.currentRegionTraffic`：当前 release 的区域流量快照，用于页面展示和后续 k8s/网关执行器接入。

## 执行语义

- 用户在制品中心选择区域和百分比后触发灰度上线。
- API 会把区域配置写入 rollout policy，并为每个 step 生成区域流量快照。
- 每个 step 的总百分比仍然表示当前批次上限；区域百分比表示区域内切入比例。
- 推进灰度时，release 会更新 `currentTrafficPercent` 和 `currentRegionTraffic`。
- 全量发布后，已启用区域都会记录为 `100%`。

## 当前边界

本地 `local-docker` 没有真实流量网关，因此区域百分比是发布门禁和审计状态。接入 Kubernetes、Ingress、Service Mesh 或云厂商网关后，执行器应读取 `currentRegionTraffic` 并将其转换为真实流量规则。
