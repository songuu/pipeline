import type { EnvironmentType } from "../platform";

/**
 * DORA 四指标聚合契约（纯 TS，业务规则/类型放 shared，边界校验放 apps/api）。
 * 数据源是 release-events 事件流 + artifacts，只读派生，不写回。
 */

export type DoraWindow = {
  /** 统计窗口天数 */
  days: number;
  /** 窗口起点 ISO8601（含），= now - days */
  from: string;
  /** 窗口终点 ISO8601，= now */
  to: string;
};

export type DoraTrendPoint = {
  /** UTC 日桶，YYYY-MM-DD */
  date: string;
  /** 当日成功部署数 */
  deployments: number;
  /** 当日失败数（deploy_failed + release_rolled_back） */
  failures: number;
};

/**
 * 样本量透明披露：所有"跳过/未匹配"都显式计数，避免静默丢数据导致指标失真。
 */
export type DoraSampleSizes = {
  succeeded: number;
  failed: number;
  rolledBack: number;
  /** 成功部署中成功关联到 artifact.uploadedAt 的数量（前置时间分母） */
  leadTimeMatched: number;
  /** 成功部署中缺 artifactId 或 artifact 不可解析、被前置时间统计跳过的数量 */
  leadTimeUnmatched: number;
  /** 回滚中在窗口内找到后继恢复部署的数量（MTTR 分母） */
  mttrResolved: number;
  /** 回滚中窗口内无后继恢复部署、被 MTTR 统计跳过的数量 */
  mttrUnresolved: number;
};

export type DoraMetrics = {
  window: DoraWindow;
  environment?: EnvironmentType;
  applicationId?: string;
  /** 部署频率：窗口内成功部署数 / 窗口天数（次/天） */
  deploymentFrequencyPerDay: number;
  /** 窗口内成功部署总数 */
  totalDeployments: number;
  /** 变更前置时间：median(deploy_succeeded.createdAt − 关联 artifact.uploadedAt)，毫秒；无匹配样本为 null */
  leadTimeForChangesMs: number | null;
  /** 变更失败率：(deploy_failed + release_rolled_back) / (deploy_succeeded + deploy_failed)，0..1 */
  changeFailureRate: number;
  /** 恢复时间：median(release_rolled_back → 同 (env, app) 下一个 deploy_succeeded)，毫秒；无解析样本为 null（取中位数更抗离群，字段名沿用 DORA 习惯 MTTR） */
  timeToRestoreMs: number | null;
  sampleSizes: DoraSampleSizes;
  /** 按 UTC 日升序的趋势序列，覆盖整个窗口（含 0 值日） */
  trend: DoraTrendPoint[];
};

export type DoraQuery = {
  /** 窗口天数（已由边界层校验为正整数） */
  windowDays: number;
  environment?: EnvironmentType;
  applicationId?: string;
};
