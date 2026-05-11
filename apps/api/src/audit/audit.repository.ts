import { Injectable } from "@nestjs/common";
import type { AuditEvent } from "@deploy-management/shared";
import { InMemoryRepository } from "../common/in-memory.repository";

@Injectable()
export class AuditRepository extends InMemoryRepository<AuditEvent> {
  constructor() {
    super([]);
  }
}
