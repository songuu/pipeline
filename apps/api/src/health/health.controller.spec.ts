import { describe, expect, it } from "vitest";
import { Reflector } from "@nestjs/core";
import { HealthController } from "./health.controller";
import { REQUIRED_ROLES_KEY } from "../security/roles.decorator";

describe("HealthController", () => {
  it("liveness 返回 {status:'ok'}", () => {
    expect(new HealthController().liveness()).toEqual({ status: "ok" });
  });

  it("不带角色要求（不变量：存活探针无鉴权）", () => {
    // RolesGuard 对无 REQUIRED_ROLES 元数据的路由直接放行；此断言守住该不变量。
    const reflector = new Reflector();
    const roles = reflector.getAllAndOverride<string[]>(REQUIRED_ROLES_KEY, [
      HealthController.prototype.liveness,
      HealthController,
    ]);
    expect(roles).toBeFalsy();
  });
});
