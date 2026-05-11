import { Module } from "@nestjs/common";
import { ApplicationsModule } from "./applications/applications.module";
import { ApprovalsModule } from "./approvals/approvals.module";
import { ArtifactsModule } from "./artifacts/artifacts.module";
import { AuditModule } from "./audit/audit.module";
import { CodeReposModule } from "./code-repos/code-repos.module";
import { EnvironmentsModule } from "./environments/environments.module";
import { ExecutorsModule } from "./executors/executors.module";
import { LifecycleModule } from "./lifecycle/lifecycle.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { RunnersModule } from "./runners/runners.module";
import { RunsModule } from "./runs/runs.module";
import { SnapshotModule } from "./snapshot/snapshot.module";

@Module({
  imports: [
    ExecutorsModule,
    LifecycleModule,
    ApplicationsModule,
    ApprovalsModule,
    ArtifactsModule,
    AuditModule,
    CodeReposModule,
    EnvironmentsModule,
    PipelinesModule,
    RunnersModule,
    RunsModule,
    SnapshotModule,
  ],
})
export class AppModule {}
