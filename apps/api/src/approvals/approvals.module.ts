import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { ApprovalsRepository } from "./approvals.repository";
import { ApprovalsService } from "./approvals.service";

@Module({
  imports: [NotificationsModule],
  providers: [ApprovalsService, ApprovalsRepository],
  exports: [ApprovalsService, ApprovalsRepository],
})
export class ApprovalsModule {}
