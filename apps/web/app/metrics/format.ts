/**
 * DORA 看板纯展示格式化助手（无副作用，便于单测）。
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 毫秒时长 → 人类可读，null 用占位符 */
export function formatDuration(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return "—";
  if (ms < MINUTE) return `${Math.round(ms / SECOND)} 秒`;
  if (ms < HOUR) return `${(ms / MINUTE).toFixed(1)} 分`;
  if (ms < DAY) return `${(ms / HOUR).toFixed(1)} 小时`;
  return `${(ms / DAY).toFixed(1)} 天`;
}

/** 部署频率：次/天 */
export function formatPerDay(value: number): string {
  return `${value.toFixed(2)} 次/天`;
}

/** 比率 0..1 → 百分比 */
export function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** 趋势条相对高度（0..1），按窗口内单日最大值归一化 */
export function barRatio(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, value / max);
}
