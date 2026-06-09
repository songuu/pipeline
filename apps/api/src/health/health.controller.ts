import { Controller, Get } from "@nestjs/common";

/**
 * 部署存活探针。
 *
 * WHY 无 @RequireRoles：RolesGuard 对无角色要求的路由直接放行
 * （roles.guard.ts: `if (!requiredRoles?.length) return true`），故此端点应用层无鉴权。
 * WHY 挂在根 /healthz：main.ts setGlobalPrefix("")，路由在 /api 前缀之外；
 * 部署脚本以 127.0.0.1:4000/healthz 直连探测，绕过 nginx Basic-auth，仅验证进程存活。
 * 刻意不返回任何配置/密钥/内部状态，避免信息泄露。
 */
@Controller()
export class HealthController {
  @Get("healthz")
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }
}
