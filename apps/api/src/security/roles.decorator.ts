import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { ControlPlanePrincipal, ControlPlaneRole } from "./security.types";

export const REQUIRED_ROLES_KEY = "deploy-management:required-roles";

export const RequireRoles = (...roles: ControlPlaneRole[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ControlPlanePrincipal => {
    const request = context.switchToHttp().getRequest<{ principal?: ControlPlanePrincipal }>();
    return request.principal ?? {
      actor: "RO",
      role: "admin",
      authenticated: false,
      source: "dev",
    };
  },
);
