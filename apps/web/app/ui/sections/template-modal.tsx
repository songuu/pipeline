"use client";

import { CheckCircle2, X } from "lucide-react";
import { LIFECYCLE_STAGES, type PlatformSnapshot } from "@deploy-management/shared";
import { Field, MiniFlow } from "../components/primitives";
import {
  categoryIcon,
  pipelineTemplates,
  templateCategories,
  type TemplateMode,
} from "../data/templates";

interface TemplateModalProps {
  snapshot: PlatformSnapshot;
  selectedTemplateKey: string;
  onSelectTemplate: (key: string) => void;
  activeCategory: string;
  onChangeCategory: (category: string) => void;
  templateMode: TemplateMode;
  onChangeMode: (mode: TemplateMode) => void;
  onClose: () => void;
  onCreate: () => void;
  onCreateCustom: () => void;
}

export function TemplateModal({
  snapshot,
  selectedTemplateKey,
  onSelectTemplate,
  activeCategory,
  onChangeCategory,
  templateMode,
  onChangeMode,
  onClose,
  onCreate,
  onCreateCustom,
}: TemplateModalProps) {
  const visibleTemplates = pipelineTemplates.filter((template) => template.category === activeCategory);
  const selectedTemplate =
    visibleTemplates.find((template) => template.key === selectedTemplateKey) ??
    visibleTemplates[0] ??
    pipelineTemplates.find((template) => template.key === selectedTemplateKey) ??
    pipelineTemplates[0];
  const selectedRepository = snapshot.repositories.find((repo) => repo.id === selectedTemplate.repositoryId);

  const selectCategory = (category: string) => {
    onChangeCategory(category);
    const firstTemplate = pipelineTemplates.find((template) => template.category === category);
    if (firstTemplate) {
      onSelectTemplate(firstTemplate.key);
    }
  };

  return (
    <div className="modal-backdrop">
      <section
        className="template-modal"
        role="dialog"
        aria-modal="true"
        aria-label="选择流水线模板"
      >
        <header className="template-modal-head">
          <span>选择流水线模板</span>
          <button className="plain-icon" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        <div className="template-modal-body">
          <aside className="template-category-nav">
            {templateCategories.map((category) => (
              <button
                key={category}
                className={category === activeCategory ? "active" : ""}
                onClick={() => selectCategory(category)}
              >
                <span>{categoryIcon(category)}</span>
                {category}
              </button>
            ))}
          </aside>
          <div className="template-picker">
            <div className="create-mode-row">
              <span>
                创建方式 <small>?</small>
              </span>
              <button
                className={templateMode === "visual" ? "create-mode-card active" : "create-mode-card"}
                onClick={() => onChangeMode("visual")}
              >
                <strong>可视化编排</strong>
              </button>
              <button
                className={templateMode === "yaml" ? "create-mode-card active" : "create-mode-card"}
                onClick={() => onChangeMode("yaml")}
              >
                <strong>YAML 化编排</strong>
                <CheckCircle2 size={16} />
              </button>
            </div>
            <div className="custom-template-note">
              <strong>组织自定义模板</strong>
              <span>暂无组织模板，请新建组织模板</span>
            </div>
            <div className="recommended-title">推荐模板</div>
            <div className="template-list">
              {visibleTemplates.length > 0 ? (
                visibleTemplates.map((template) => (
                  <button
                    key={template.key}
                    className={
                      template.key === selectedTemplate.key ? "template-option selected" : "template-option"
                    }
                    onClick={() => onSelectTemplate(template.key)}
                    onDoubleClick={() => onSelectTemplate(template.key)}
                  >
                    <div className="template-option-head">
                      <span className="template-icon">{template.icon}</span>
                      <span>
                        <strong>{template.title}</strong>
                        <small>{template.subtitle}</small>
                      </span>
                      {template.badge && <em>{template.badge}</em>}
                    </div>
                    <MiniFlow chips={template.chips} />
                  </button>
                ))
              ) : (
                <div className="template-empty-state">
                  <strong>{activeCategory} 模板暂未接入</strong>
                  <span>当前阶段优先实现 Node.js 流水线模板，后续语言模板可沿用同一创建协议扩展。</span>
                </div>
              )}
            </div>
            <div className="template-config-preview">
              <Field label="将创建">
                <span>
                  {selectedTemplate.title} · {selectedRepository?.url ?? "未绑定仓库"}
                </span>
              </Field>
              <Field label="默认代码源">
                <span>
                  {selectedRepository?.provider}/{selectedRepository?.name} · branch/{selectedRepository?.defaultBranch}
                </span>
              </Field>
              <Field label="可选 Tag">
                <span>{selectedRepository?.tags.join(" / ") || "暂无 Tag"}</span>
              </Field>
              <Field label="默认触发">
                <span>{selectedTemplate.triggers.join(" / ")}</span>
              </Field>
              <Field label="完整生命周期">
                <span>
                  {selectedTemplate.stages
                    .map((stage) => LIFECYCLE_STAGES.find((item) => item.key === stage)?.title)
                    .join(" → ")}
                </span>
              </Field>
            </div>
          </div>
        </div>
        <footer className="template-modal-footer">
          <button className="cloud-secondary" onClick={onCreateCustom}>
            自定义空白流水线
          </button>
          <button className="cloud-secondary" onClick={onClose}>
            取消
          </button>
          <button className="yunxiao-primary" onClick={onCreate}>
            创建
          </button>
        </footer>
      </section>
    </div>
  );
}
