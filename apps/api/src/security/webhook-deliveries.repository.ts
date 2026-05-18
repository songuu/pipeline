import { Injectable } from "@nestjs/common";
import { InMemoryRepository } from "../common/in-memory.repository";
import type { WebhookDeliveryRecord } from "./security.types";

@Injectable()
export class WebhookDeliveriesRepository extends InMemoryRepository<WebhookDeliveryRecord> {
  constructor() {
    super([], "webhook-deliveries");
  }
}
