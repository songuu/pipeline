import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SecretResolverService } from "./secret-resolver.service";
import { REQUIRED_ROLES_KEY } from "./roles.decorator";
import type { ControlPlanePrincipal, ControlPlaneRole, HeaderBag } from "./security.types";

const ROLE_RANK: Record<ControlPlaneRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly secrets: SecretResolverService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<ControlPlaneRole[]>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<{ headers: HeaderBag; principal?: ControlPlanePrincipal }>();
    const principal = this.resolvePrincipal(request.headers);
    request.principal = principal;

    if (!requiredRoles.some((role) => ROLE_RANK[principal.role] >= ROLE_RANK[role])) {
      throw new ForbiddenException(`角色 ${principal.role} 无权访问，需要 ${requiredRoles.join(" / ")}`);
    }
    return true;
  }

  private resolvePrincipal(headers: HeaderBag): ControlPlanePrincipal {
    const configuredToken = this.secrets.optional("CONTROL_PLANE_API_TOKEN");
    const jwtSecret = this.secrets.optional("CONTROL_PLANE_JWT_SECRET");
    const authRequired = Boolean(configuredToken) || Boolean(jwtSecret) || process.env.CONTROL_PLANE_AUTH_REQUIRED === "true" || process.env.NODE_ENV === "production";
    const actor = headerValue(headers, "x-devops-actor") ?? "RO";
    const configuredRole = parseRole(this.secrets.optional("CONTROL_PLANE_DEFAULT_ROLE")) ?? "admin";

    if (!authRequired) {
      return {
        actor,
        role: configuredRole,
        authenticated: false,
        source: "dev",
      };
    }

    if (!configuredToken && !jwtSecret) {
      throw new UnauthorizedException("CONTROL_PLANE_API_TOKEN 或 CONTROL_PLANE_JWT_SECRET 未配置，无法启用受保护操作");
    }

    const suppliedBearerToken = bearerToken(headers);
    if (jwtSecret && suppliedBearerToken?.includes(".")) {
      const jwtPrincipal = principalFromJwt(suppliedBearerToken, jwtSecret, configuredRole);
      if (jwtPrincipal) {
        return {
          ...jwtPrincipal,
          actor: headerValue(headers, "x-devops-actor") ?? jwtPrincipal.actor,
        };
      }
    }

    const suppliedToken = suppliedBearerToken ?? headerValue(headers, "x-control-plane-token");
    if (!configuredToken || !suppliedToken || !constantTimeEqual(suppliedToken, configuredToken)) {
      throw new UnauthorizedException("控制面访问令牌无效或缺失");
    }

    const requestedRole = parseRole(headerValue(headers, "x-devops-role"));
    const role = requestedRole && ROLE_RANK[requestedRole] < ROLE_RANK[configuredRole] ? requestedRole : configuredRole;
    return {
      actor,
      role,
      authenticated: true,
      source: "shared-token",
    };
  }
}

function bearerToken(headers: HeaderBag): string | undefined {
  const authorization = headerValue(headers, "authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length).trim();
}

function headerValue(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseRole(value: string | undefined): ControlPlaneRole | undefined {
  if (value === "admin" || value === "member" || value === "viewer") return value;
  return undefined;
}

function principalFromJwt(token: string, secret: string, fallbackRole: ControlPlaneRole): ControlPlanePrincipal | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [encodedHeader, encodedPayload, signature] = parts;
  const header = parseJson(base64UrlDecode(encodedHeader));
  if (header?.alg !== "HS256") return undefined;
  const expectedSignature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  if (!constantTimeEqual(signature, expectedSignature)) return undefined;

  const payload = parseJson(base64UrlDecode(encodedPayload));
  if (!payload) return undefined;
  const expiresAt = typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
  if (expiresAt && Date.now() >= expiresAt) return undefined;

  const claimedRole =
    parseRole(stringFrom(payload.role)) ??
    parseRole(stringFrom(recordFrom(payload.app_metadata)?.role)) ??
    parseRole(stringFrom(recordFrom(payload.user_metadata)?.role)) ??
    fallbackRole;
  return {
    actor: stringFrom(payload.sub) ?? stringFrom(payload.email) ?? "jwt-user",
    role: claimedRole,
    authenticated: true,
    source: "jwt",
  };
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function parseJson(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return recordFrom(parsed);
  } catch {
    return undefined;
  }
}

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
