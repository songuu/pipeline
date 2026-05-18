import { Module } from "@nestjs/common";
import { ArtifactsModule } from "../artifacts/artifacts.module";
import { AuditModule } from "../audit/audit.module";
import { EnvironmentsModule } from "../environments/environments.module";
import { RunsModule } from "../runs/runs.module";
import { ReleaseEventsRepository } from "./release-events.repository";
import { ReleaseExecutionsRepository } from "./release-executions.repository";
import { ReleasePlansRepository } from "./release-plans.repository";
import { ReleasesController } from "./releases.controller";
import { ReleasesRepository } from "./releases.repository";
import { ReleasesService } from "./releases.service";

@Module({
  imports: [ArtifactsModule, AuditModule, EnvironmentsModule, RunsModule],
  controllers: [ReleasesController],
  providers: [ReleasesService, ReleasesRepository, ReleasePlansRepository, ReleaseExecutionsRepository, ReleaseEventsRepository],
  exports: [ReleasesService, ReleasesRepository, ReleasePlansRepository, ReleaseExecutionsRepository, ReleaseEventsRepository],
})
export class ReleasesModule {}
