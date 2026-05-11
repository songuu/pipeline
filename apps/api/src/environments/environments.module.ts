import { Module } from "@nestjs/common";
import { EnvironmentsController } from "./environments.controller";
import { EnvironmentsRepository } from "./environments.repository";
import { EnvironmentsService } from "./environments.service";

@Module({
  controllers: [EnvironmentsController],
  providers: [EnvironmentsService, EnvironmentsRepository],
  exports: [EnvironmentsService, EnvironmentsRepository],
})
export class EnvironmentsModule {}
