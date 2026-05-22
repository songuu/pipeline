// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformSnapshot } from "@deploy-management/shared";
import { FRONTEND_STATIC_TEMPLATE_KEY, emptyFrontendTemplateInput } from "../../data/template-inputs";
import { TemplateModal } from "../template-modal";

const snapshot = {
  applications: [],
  repositories: [],
} as unknown as PlatformSnapshot;

describe("TemplateModal frontend inputs", () => {
  afterEach(() => cleanup());

  it("shows prominent required inputs for the frontend static template", () => {
    const onCreate = vi.fn();

    render(
      <TemplateModal
        snapshot={snapshot}
        canCreate
        selectedTemplateKey={FRONTEND_STATIC_TEMPLATE_KEY}
        onSelectTemplate={vi.fn()}
        activeCategory="Node.js"
        onChangeCategory={vi.fn()}
        templateMode="visual"
        onChangeMode={vi.fn()}
        frontendTemplateInput={emptyFrontendTemplateInput}
        onChangeFrontendTemplateInput={vi.fn()}
        onClose={vi.fn()}
        onCreate={onCreate}
        onCreateCustom={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("前端发布参数")).toBeTruthy();
    expect(screen.getByLabelText("执行命令")).toBeTruthy();
    expect(screen.getByLabelText("命令参数")).toBeTruthy();
    expect(screen.getByLabelText("访问域名")).toBeTruthy();
    expect((screen.getByRole("button", { name: "创建" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("emits input patches when the user types command, args, and domain", () => {
    const onChangeFrontendTemplateInput = vi.fn();

    render(
      <TemplateModal
        snapshot={snapshot}
        canCreate
        selectedTemplateKey={FRONTEND_STATIC_TEMPLATE_KEY}
        onSelectTemplate={vi.fn()}
        activeCategory="Node.js"
        onChangeCategory={vi.fn()}
        templateMode="visual"
        onChangeMode={vi.fn()}
        frontendTemplateInput={emptyFrontendTemplateInput}
        onChangeFrontendTemplateInput={onChangeFrontendTemplateInput}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onCreateCustom={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("执行命令"), { target: { value: "pnpm build" } });
    fireEvent.change(screen.getByLabelText("命令参数"), { target: { value: "--mode staging" } });
    fireEvent.change(screen.getByLabelText("访问域名"), { target: { value: "https://app.company.com" } });

    expect(onChangeFrontendTemplateInput).toHaveBeenCalledWith({ buildCommand: "pnpm build" });
    expect(onChangeFrontendTemplateInput).toHaveBeenCalledWith({ buildArgs: "--mode staging" });
    expect(onChangeFrontendTemplateInput).toHaveBeenCalledWith({ publicBaseUrl: "https://app.company.com" });
  });
});
