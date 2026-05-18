import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RunsModule } from "../runs/runs.module";
import { RolesGuard } from "./roles.guard";
import { SecretResolverService } from "./secret-resolver.service";
import { WebhookDeliveriesRepository } from "./webhook-deliveries.repository";
import { WebhookSecurityService } from "./webhook-security.service";
import { WebhooksController } from "./webhooks.controller";

@Module({
  imports: [RunsModule],
  controllers: [WebhooksController],
  providers: [
    SecretResolverService,
    WebhookDeliveriesRepository,
    WebhookSecurityService,
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [SecretResolverService, WebhookDeliveriesRepository, WebhookSecurityService],
})
export class SecurityModule {}
