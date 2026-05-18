import { Module } from "@nestjs/common";
import { DeploymentTargetsRepository } from "./deployment-targets.repository";
import { EnvironmentLocksRepository } from "./environment-locks.repository";
import { EnvironmentsController } from "./environments.controller";
import { EnvironmentsRepository } from "./environments.repository";
import { EnvironmentsService } from "./environments.service";

@Module({
  controllers: [EnvironmentsController],
  providers: [EnvironmentsService, EnvironmentsRepository, DeploymentTargetsRepository, EnvironmentLocksRepository],
  exports: [EnvironmentsService, EnvironmentsRepository, DeploymentTargetsRepository, EnvironmentLocksRepository],
})
export class EnvironmentsModule {}
