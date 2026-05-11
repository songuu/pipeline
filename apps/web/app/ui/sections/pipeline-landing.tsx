"use client";

import { ChevronDown } from "lucide-react";
import { landingTemplates } from "../data/templates";

interface PipelineLandingProps {
  showCreateMenu: boolean;
  onToggleMenu: () => void;
  onOpenTemplates: () => void;
  onAutoCreate: () => void;
}

export function PipelineLanding({
  showCreateMenu,
  onToggleMenu,
  onOpenTemplates,
  onAutoCreate,
}: PipelineLandingProps) {
  return (
    <section className="pipeline-landing">
      <div className="page-caption">流水线</div>
      <div className="landing-center">
        <h1>自动化流水线，测试构建一触即发</h1>
        <div className="split-button-wrap">
          <button className="yunxiao-split-main" onClick={onOpenTemplates}>
            创建流水线
          </button>
          <button className="yunxiao-split-arrow" onClick={onToggleMenu} aria-label="展开创建方式">
            <ChevronDown size={15} />
          </button>
          {showCreateMenu && (
            <div className="create-dropdown">
              <button onClick={onAutoCreate}>自动创建流水线</button>
              <button onClick={onOpenTemplates}>从模板创建流水线</button>
            </div>
          )}
        </div>
        <div className="landing-flow-strip" aria-label="推荐流水线模板">
          {landingTemplates.map(([icon, title, group]) => (
            <div className="landing-template-card" key={title}>
              <strong>{icon}</strong>
              <span>{title}</span>
              <small>{group}</small>
            </div>
          ))}
          <div className="landing-track">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </section>
  );
}
