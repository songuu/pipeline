"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DoraMetrics, EnvironmentType } from "@deploy-management/shared";
import { ApiError, fetchDoraMetrics } from "../lib/api";
import { barRatio, formatDuration, formatPerDay, formatRate } from "./format";

const WINDOW_OPTIONS = [7, 30, 90] as const;
const ENV_OPTIONS: Array<{ value: "" | EnvironmentType; label: string }> = [
  { value: "", label: "全部环境" },
  { value: "dev", label: "dev" },
  { value: "test", label: "test" },
  { value: "staging", label: "staging" },
  { value: "prod", label: "prod" },
];

export default function MetricsPage() {
  const [windowDays, setWindowDays] = useState<number>(7);
  const [environment, setEnvironment] = useState<"" | EnvironmentType>("");
  const [metrics, setMetrics] = useState<DoraMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchDoraMetrics(
          { window: windowDays, ...(environment ? { environment } : {}) },
          { signal },
        );
        if (!signal.aborted) setMetrics(data);
      } catch (caught) {
        if (signal.aborted) return;
        setError(caught instanceof ApiError ? caught.message : "加载 DORA 指标失败");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [windowDays, environment],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const maxBar = metrics
    ? Math.max(1, ...metrics.trend.map((point) => Math.max(point.deployments, point.failures)))
    : 1;

  return (
    <main className="dora-page">
      <header className="dora-header">
        <div>
          <Link href="/" className="dora-back">
            ← 返回工作台
          </Link>
          <h1>DORA 部署度量</h1>
        </div>
        <div className="dora-filters">
          <label>
            窗口
            <select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
              {WINDOW_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days} 天
                </option>
              ))}
            </select>
          </label>
          <label>
            环境
            <select
              value={environment}
              onChange={(event) => setEnvironment(event.target.value as "" | EnvironmentType)}
            >
              {ENV_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error ? (
        <div className="dora-error" role="alert">
          {error}
        </div>
      ) : null}
      {loading && !metrics ? <div className="dora-empty">加载中…</div> : null}

      {metrics ? (
        <>
          <section className="dora-grid">
            <DoraCard
              label="部署频率"
              value={formatPerDay(metrics.deploymentFrequencyPerDay)}
              hint={`共 ${metrics.totalDeployments} 次成功部署`}
            />
            <DoraCard
              label="变更前置时间"
              value={formatDuration(metrics.leadTimeForChangesMs)}
              hint={`样本 ${metrics.sampleSizes.leadTimeMatched}（未匹配 ${metrics.sampleSizes.leadTimeUnmatched}）`}
            />
            <DoraCard
              label="变更失败率"
              value={formatRate(metrics.changeFailureRate)}
              hint={`失败 ${metrics.sampleSizes.failed + metrics.sampleSizes.rolledBack} / 尝试 ${metrics.sampleSizes.succeeded + metrics.sampleSizes.failed}`}
            />
            <DoraCard
              label="恢复时间(中位)"
              value={formatDuration(metrics.timeToRestoreMs)}
              hint={`已恢复 ${metrics.sampleSizes.mttrResolved}（未恢复 ${metrics.sampleSizes.mttrUnresolved}）`}
            />
          </section>

          <section className="dora-trend">
            <h2>每日部署 / 失败趋势</h2>
            <div className="dora-trend-bars">
              {metrics.trend.map((point) => (
                <div
                  className="dora-trend-col"
                  key={point.date}
                  title={`${point.date}：部署 ${point.deployments} / 失败 ${point.failures}`}
                >
                  <div className="dora-bar-stack">
                    <span
                      className="dora-bar deploy"
                      style={{ height: `${barRatio(point.deployments, maxBar) * 100}%` }}
                    />
                    <span
                      className="dora-bar fail"
                      style={{ height: `${barRatio(point.failures, maxBar) * 100}%` }}
                    />
                  </div>
                  <em>{point.date.slice(5)}</em>
                </div>
              ))}
            </div>
            <div className="dora-legend">
              <span>
                <i className="deploy" /> 成功部署
              </span>
              <span>
                <i className="fail" /> 失败/回滚
              </span>
            </div>
          </section>

          <footer className="dora-foot">
            窗口 {metrics.window.from.slice(0, 10)} ~ {metrics.window.to.slice(0, 10)}（{metrics.window.days} 天）
            {metrics.environment ? ` · 环境 ${metrics.environment}` : ""}
          </footer>
        </>
      ) : null}
    </main>
  );
}

function DoraCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="dora-card">
      <strong>{value}</strong>
      <span className="dora-card-label">{label}</span>
      <span className="dora-card-hint">{hint}</span>
    </article>
  );
}
