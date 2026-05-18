"use client";

import type { Dispatch, SetStateAction } from "react";
import { Archive } from "lucide-react";
import type { EnvironmentType, PipelineDefinition, SourceRepository } from "@deploy-management/shared";
import { Field } from "../components/primitives";
import type { PipelineConfigTab } from "../data/templates";
import { environmentOptions } from "../data/templates";
import type { RunConfig } from "./model";

interface BasicPanelProps {
  basicSide: string;
  setBasicSide: Dispatch<SetStateAction<string>>;
  pipelineName: string;
  setPipelineName: Dispatch<SetStateAction<string>>;
  pipeline: PipelineDefinition;
  runConfig: RunConfig;
  setRunConfig: (config: RunConfig) => void;
  tagValue: string;
  setTagValue: Dispatch<SetStateAction<string>>;
  groupValue: string;
  setGroupValue: Dispatch<SetStateAction<string>>;
  repository: SourceRepository;
  setActiveTab: (tab: PipelineConfigTab) => void;
  deletePipeline: () => Promise<void>;
  onCopy: (value: string, label: string) => void;
}

export function BasicPanel({
  basicSide,
  setBasicSide,
  pipelineName,
  setPipelineName,
  pipeline,
  runConfig,
  setRunConfig,
  tagValue,
  setTagValue,
  groupValue,
  setGroupValue,
  repository,
  setActiveTab,
  deletePipeline,
  onCopy,
}: BasicPanelProps) {
  return (
    <div className="pipeline-config-layout">
      <aside className="pipeline-config-side">
        <button className={basicSide === "basic" ? "active" : ""} onClick={() => setBasicSide("basic")}>
          基本配置
        </button>
        <button className={basicSide === "members" ? "active" : ""} onClick={() => setBasicSide("members")}>
          成员信息
        </button>
      </aside>
      <main className="pipeline-config-content">
        {basicSide === "basic" ? (
          <>
            <h2>基本配置</h2>
            <div className="config-section-bar">流水线信息</div>
            <div className="basic-form">
              <Field label="流水线名称">
                <div className="counted-input">
                  <input value={pipelineName} maxLength={60} onChange={(event) => setPipelineName(event.target.value)} />
                  <span>{pipelineName.length}/60</span>
                </div>
              </Field>
              <Field label="流水线 ID">
                <div className="disabled-copy-input">
                  <input value={pipeline.id.replace("pipe-", "w4wmfxgwbgbe8wp9").slice(0, 16)} readOnly />
                  <button type="button" aria-label="复制流水线 ID" onClick={() => void onCopy(pipeline.id, "流水线 ID")}>
                    <Archive size={16} />
                  </button>
                </div>
              </Field>
              <Field label="环境">
                <select
                  value={runConfig.environment}
                  onChange={(event) => setRunConfig({ ...runConfig, environment: event.target.value as EnvironmentType })}
                >
                  <option value="dev">无</option>
                  {environmentOptions.map((environment) => (
                    <option key={environment} value={environment}>
                      {environment}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="标签">
                <select value={tagValue} onChange={(event) => setTagValue(event.target.value)}>
                  <option value="">请选择</option>
                  <option value="prod">prod</option>
                  <option value="nodejs">nodejs</option>
                </select>
              </Field>
              <Field label="分组">
                <select value={groupValue} onChange={(event) => setGroupValue(event.target.value)}>
                  <option value="ungrouped">未分组</option>
                  <option value="backend">后端发布</option>
                </select>
              </Field>
              <Field label="流水线源">
                <button type="button" className="source-summary-button" onClick={() => setActiveTab("source")}>
                  <strong>{repository.provider}/{repository.name}</strong>
                  <span>{runConfig.refType} / {runConfig.refName}</span>
                </button>
              </Field>
            </div>
            <div className="config-section-bar danger">删除流水线</div>
            <button className="delete-pipeline-button" onClick={() => void deletePipeline()}>
              删除流水线
            </button>
          </>
        ) : (
          <div className="members-panel">
            <h2>成员信息</h2>
            <div className="member-row">
              <strong>拥有者</strong>
              <span>{pipeline.owner}</span>
              <em>可编辑和运行</em>
            </div>
            <div className="member-row">
              <strong>RO</strong>
              <span>当前用户</span>
              <em>可保存并运行</em>
            </div>
            <div className="member-row">
              <strong>SRE-王林</strong>
              <span>审批人</span>
              <em>生产全量门禁</em>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
