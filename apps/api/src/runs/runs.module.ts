import { Module } from "@nestjs/common";
import { ApplicationsModule } from "../applications/applications.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { ArtifactsModule } from "../artifacts/artifacts.module";
import { AuditModule } from "../audit/audit.module";
import { CodeReposModule } from "../code-repos/code-repos.module";
import { LifecycleModule } from "../lifecycle/lifecycle.module";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { RunsController } from "./runs.controller";
import { RunsRepository } from "./runs.repository";
import { RunsService } from "./runs.service";

// Seed lifecycle is owned by RunsService.onModuleInit (provider-level), not the
// module class. Module-class constructor DI is unreliable under tsx/esbuild
// because decorator metadata is not emitted for non-provider classes.
@Module({
  imports: [
    ApplicationsModule,
    ApprovalsModule,
    ArtifactsModule,
    AuditModule,
    CodeReposModule,
    LifecycleModule,
    PipelinesModule,
  ],
  controllers: [RunsController],
  providers: [RunsService, RunsRepository],
  exports: [RunsService, RunsRepository],
})
export class RunsModule {}
