import { Inject, Injectable } from "@nestjs/common";
import type { AuditEvent } from "@deploy-management/shared";
import { AuditRepository } from "./audit.repository";

@Injectable()
export class AuditService {
  constructor(@Inject(AuditRepository) private readonly repo: AuditRepository) {}

  list(): AuditEvent[] {
    return this.repo.snapshot();
  }

  async record(actor: string, action: string, target: string): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: `audit-${this.repo.snapshot().length + 1}`,
      actor,
      action,
      target,
      createdAt: new Date().toISOString(),
    };
    await this.repo.prepend(event);
    return event;
  }
}
