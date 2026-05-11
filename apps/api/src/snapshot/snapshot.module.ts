import { Module } from "@nestjs/common";
import { ApplicationsModule } from "../applications/applications.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { ArtifactsModule } from "../artifacts/artifacts.module";
import { AuditModule } from "../audit/audit.module";
import { CodeReposModule } from "../code-repos/code-repos.module";
import { EnvironmentsModule } from "../environments/environments.module";
import { PipelinesModule } from "../pipelines/pipelines.module";
import { RunnersModule } from "../runners/runners.module";
import { RunsModule } from "../runs/runs.module";
import { SnapshotController } from "./snapshot.controller";
import { SnapshotService } from "./snapshot.service";

@Module({
  imports: [
    ApplicationsModule,
    ApprovalsModule,
    ArtifactsModule,
    AuditModule,
    CodeReposModule,
    EnvironmentsModule,
    PipelinesModule,
    RunnersModule,
    RunsModule,
  ],
  controllers: [SnapshotController],
  providers: [SnapshotService],
})
export class SnapshotModule {}
