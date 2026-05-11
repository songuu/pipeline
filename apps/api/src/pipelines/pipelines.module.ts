import { Module } from "@nestjs/common";
import { ApplicationsModule } from "../applications/applications.module";
import { CodeReposModule } from "../code-repos/code-repos.module";
import { AuditModule } from "../audit/audit.module";
import { PipelinesController } from "./pipelines.controller";
import { PipelinesRepository } from "./pipelines.repository";
import { PipelinesService } from "./pipelines.service";

@Module({
  imports: [ApplicationsModule, CodeReposModule, AuditModule],
  controllers: [PipelinesController],
  providers: [PipelinesService, PipelinesRepository],
  exports: [PipelinesService, PipelinesRepository],
})
export class PipelinesModule {}
