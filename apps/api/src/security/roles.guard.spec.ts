import { createHmac } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, afterEach, it } from "vitest";
import type { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import { REQUIRED_ROLES_KEY } from "./roles.decorator";
import type { SecretResolverService } from "./secret-resolver.service";
import type { ControlPlaneRole, HeaderBag, ControlPlanePrincipal } from "./security.types";

describe("RolesGuard", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAuthRequired = process.env.CONTROL_PLANE_AUTH_REQUIRED;

  afterEach(() => {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("CONTROL_PLANE_AUTH_REQUIRED", originalAuthRequired);
  });

  it("allows local dev requests and attaches a principal", () => {
    process.env.NODE_ENV = "development";
    process.env.CONTROL_PLANE_AUTH_REQUIRED = "false";
    const request = requestFor({ "x-devops-actor": "alice" });
    const guard = guardFor(["member"], { CONTROL_PLANE_DEFAULT_ROLE: "member" });

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.principal).toMatchObject({
      actor: "alice",
      role: "member",
      authenticated: false,
      source: "dev",
    });
  });

  it("does not crash when dev runtime misses constructor injection metadata", () => {
    process.env.NODE_ENV = "development";
    process.env.CONTROL_PLANE_AUTH_REQUIRED = "false";
    const request = requestFor({ "x-devops-actor": "hot-reload" });
    const guard = new RolesGuard();
    class GuardedController {}
    Reflect.defineMetadata(REQUIRED_ROLES_KEY, ["member"], GuardedController);

    expect(guard.canActivate(contextFor(request, noopHandler, GuardedController))).toBe(true);
    expect(request.principal).toMatchObject({
      actor: "hot-reload",
      role: "admin",
      authenticated: false,
      source: "dev",
    });
  });

  it("accepts the configured shared token", () => {
    process.env.CONTROL_PLANE_AUTH_REQUIRED = "true";
    const request = requestFor({ authorization: "Bearer shared-secret" });
    const guard = guardFor(["member"], {
      CONTROL_PLANE_API_TOKEN: "shared-secret",
      CONTROL_PLANE_DEFAULT_ROLE: "member",
    });

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.principal?.source).toBe("shared-token");
  });

  it("rejects insufficient roles", () => {
    process.env.CONTROL_PLANE_AUTH_REQUIRED = "true";
    const request = requestFor({ authorization: "Bearer shared-secret" });
    const guard = guardFor(["admin"], {
      CONTROL_PLANE_API_TOKEN: "shared-secret",
      CONTROL_PLANE_DEFAULT_ROLE: "member",
    });

    expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
  });

  it("accepts HS256 JWT roles", () => {
    process.env.CONTROL_PLANE_AUTH_REQUIRED = "true";
    const token = jwtFor({ sub: "user-1", role: "member", exp: Math.floor(Date.now() / 1000) + 60 }, "jwt-secret");
    const request = requestFor({ authorization: `Bearer ${token}` });
    const guard = guardFor(["member"], {
      CONTROL_PLANE_JWT_SECRET: "jwt-secret",
      CONTROL_PLANE_DEFAULT_ROLE: "viewer",
    });

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.principal).toMatchObject({
      actor: "user-1",
      role: "member",
      authenticated: true,
      source: "jwt",
    });
  });
});

function guardFor(requiredRoles: ControlPlaneRole[], env: Record<string, string>): RolesGuard {
  const reflector = {
    getAllAndOverride: () => requiredRoles,
  } as unknown as Reflector;
  const secrets = {
    optional: (name: string) => env[name],
  } as SecretResolverService;
  return new RolesGuard(reflector, secrets);
}

function requestFor(headers: HeaderBag): { headers: HeaderBag; principal?: ControlPlanePrincipal } {
  return { headers };
}

function contextFor(
  request: { headers: HeaderBag; principal?: ControlPlanePrincipal },
  handler: () => unknown = noopHandler,
  controller: Function = RolesGuard,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function noopHandler(): undefined {
  return undefined;
}

function jwtFor(payload: Record<string, unknown>, secret: string): string {
  const encodedHeader = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
