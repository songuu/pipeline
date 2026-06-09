import { Module } from "@nestjs/common";
import { ApplicationsModule } from "./applications/applications.module";
import { ApprovalsModule } from "./approvals/approvals.module";
import { ArtifactsModule } from "./artifacts/artifacts.module";
import { AuditModule } from "./audit/audit.module";
import { CodeReposModule } from "./code-repos/code-repos.module";
import { EnvironmentsModule } from "./environments/environments.module";
import { ExecutorsModule } from "./executors/executors.module";
import { HealthModule } from "./health/health.module";
import { KubernetesModule } from "./kubernetes/kubernetes.module";
import { LifecycleModule } from "./lifecycle/lifecycle.module";
import { MetricsModule } from "./metrics/metrics.module";
import { PipelineLayoutsModule } from "./pipeline-layouts/pipeline-layouts.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { ReleasesModule } from "./releases/releases.module";
import { RunnersModule } from "./runners/runners.module";
import { RunsModule } from "./runs/runs.module";
import { SecurityModule } from "./security/security.module";
import { SnapshotModule } from "./snapshot/snapshot.module";
import { StorageModule } from "./storage/storage.module";
import { VerificationModule } from "./verification/verification.module";

@Module({
  imports: [
    ExecutorsModule,
    HealthModule,
    KubernetesModule,
    LifecycleModule,
    MetricsModule,
    ApplicationsModule,
    ApprovalsModule,
    ArtifactsModule,
    AuditModule,
    CodeReposModule,
    EnvironmentsModule,
    PipelinesModule,
    PipelineLayoutsModule,
    ReleasesModule,
    RunnersModule,
    RunsModule,
    SecurityModule,
    SnapshotModule,
    StorageModule,
    VerificationModule,
  ],
})
export class AppModule {}
