"use client";

import { CheckCircle2, CircleDot, Clock3, Database, PauseCircle, Rocket, RotateCcw, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { ReleaseDeployment, ReleaseEvent, ReleaseEventType } from "@deploy-management/shared";

interface ReleaseEventTimelineProps {
  events: ReleaseEvent[];
  release?: ReleaseDeployment;
  maxEvents?: number;
  compact?: boolean;
  emptyText?: string;
}

export function ReleaseEventTimeline({
  events,
  release,
  maxEvents,
  compact = false,
  emptyText = "发布事件会在灰度、全量、回滚和环境锁变更时写入。",
}: ReleaseEventTimelineProps) {
  const visibleEvents = sortReleaseEvents(events).slice(-(maxEvents ?? events.length));

  if (visibleEvents.length === 0) {
    return (
      <div className={compact ? "release-event-empty compact" : "release-event-empty"}>
        <Database size={16} />
        <strong>{release ? release.applicationName : "暂无发布事件"}</strong>
        <span>{emptyText}</span>
      </div>
    );
  }

  return (
    <div className={compact ? "release-event-timeline compact" : "release-event-timeline"}>
      {release && (
        <header className="release-event-head">
          <span>
            <Rocket size={15} />
            发布事件流
          </span>
          <strong>{release.applicationName}</strong>
          <em>
            {release.environment} · {release.status} · {release.currentTrafficPercent ?? release.canaryPercent}%
          </em>
        </header>
      )}
      <div className="release-event-list">
        {visibleEvents.map((event) => (
          <article key={event.id} className={`release-event-item ${releaseEventTone(event.type)}`}>
            <div className="release-event-icon">{releaseEventIcon(event.type)}</div>
            <div className="release-event-main">
              <div className="release-event-title">
                <span>
                  <strong>{releaseEventLabel(event.type)}</strong>
                  <em>#{event.sequence} · {event.actor}</em>
                </span>
                <time>{formatReleaseEventTime(event.createdAt)}</time>
              </div>
              <p>{event.message}</p>
              <div className="release-event-meta">
                <span>{event.environment}</span>
                {event.releasePlanId && <span>Plan {shortId(event.releasePlanId)}</span>}
                {event.releaseExecutionId && <span>Execution {shortId(event.releaseExecutionId)}</span>}
                {event.runId && <span>Run {shortId(event.runId)}</span>}
              </div>
              {Object.keys(event.payload ?? {}).length > 0 && (
                <details className="release-event-payload">
                  <summary>查看 payload</summary>
                  <pre>{formatReleaseEventPayload(event.payload)}</pre>
                </details>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function ReleaseEventMiniTimeline({ events, max = 5 }: { events: ReleaseEvent[]; max?: number }) {
  const visibleEvents = sortReleaseEvents(events).slice(-max);
  if (visibleEvents.length === 0) return null;
  return (
    <div className="release-event-mini" aria-label="发布事件摘要">
      {visibleEvents.map((event) => (
        <span key={event.id} className={releaseEventTone(event.type)} title={`${releaseEventLabel(event.type)} · ${event.message}`}>
          <i />
          <em>{releaseEventLabel(event.type)}</em>
        </span>
      ))}
    </div>
  );
}

export function sortReleaseEvents(events: ReleaseEvent[]): ReleaseEvent[] {
  return [...events].sort((left, right) => {
    if (left.releaseId === right.releaseId && left.sequence !== right.sequence) return left.sequence - right.sequence;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function releaseEventLabel(type: ReleaseEventType): string {
  const labels: Record<ReleaseEventType, string> = {
    release_plan_created: "计划创建",
    deployment_target_resolved: "目标解析",
    environment_lock_acquired: "环境锁定",
    deploy_started: "部署开始",
    deploy_succeeded: "部署成功",
    deploy_failed: "部署失败",
    canary_advanced: "灰度推进",
    canary_paused: "灰度暂停",
    canary_resumed: "灰度继续",
    canary_promoted: "全量发布",
    release_rolled_back: "发布回滚",
    environment_lock_released: "环境解锁",
  };
  return labels[type];
}

function releaseEventTone(type: ReleaseEventType): string {
  if (type === "deploy_failed" || type === "release_rolled_back") return "danger";
  if (type === "canary_paused") return "warning";
  if (type === "deploy_succeeded" || type === "canary_promoted" || type === "environment_lock_released") return "success";
  if (type === "deploy_started" || type === "canary_advanced" || type === "canary_resumed") return "active";
  return "neutral";
}

function releaseEventIcon(type: ReleaseEventType): ReactNode {
  if (type === "deploy_failed") return <XCircle size={15} />;
  if (type === "release_rolled_back") return <RotateCcw size={15} />;
  if (type === "canary_paused") return <PauseCircle size={15} />;
  if (type === "deploy_succeeded" || type === "canary_promoted" || type === "environment_lock_released") {
    return <CheckCircle2 size={15} />;
  }
  if (type === "deploy_started" || type === "canary_advanced" || type === "canary_resumed") return <Clock3 size={15} />;
  return <CircleDot size={15} />;
}

function formatReleaseEventTime(value: string): string {
  return value.replace("T", " ").slice(5, 19);
}

function formatReleaseEventPayload(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function shortId(value: string): string {
  return value.replace(/^(release-|run-|plan-|execution-)/, "").slice(0, 10);
}
