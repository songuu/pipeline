export type ControlPlaneRole = "admin" | "member" | "viewer";

export interface ControlPlanePrincipal {
  actor: string;
  role: ControlPlaneRole;
  authenticated: boolean;
  source: "shared-token" | "jwt" | "dev";
}

export interface HeaderBag {
  [key: string]: string | string[] | undefined;
}

export interface WebhookDeliveryRecord {
  id: string;
  provider: "github" | "gitlab" | "gitcode" | "generic";
  pipelineId: string;
  deliveryId: string;
  event: string;
  status: "accepted" | "completed" | "duplicate" | "failed";
  actor: string;
  runId?: string;
  reason?: string;
  sourceIp?: string;
  createdAt: string;
  expiresAt: string;
}
