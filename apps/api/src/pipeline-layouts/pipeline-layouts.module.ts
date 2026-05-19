import { Module } from "@nestjs/common";
import { PipelineLayoutsController } from "./pipeline-layouts.controller";
import { PipelineLayoutsRepository } from "./pipeline-layouts.repository";
import { PipelineLayoutsService } from "./pipeline-layouts.service";

@Module({
  controllers: [PipelineLayoutsController],
  providers: [PipelineLayoutsService, PipelineLayoutsRepository],
  exports: [PipelineLayoutsService],
})
export class PipelineLayoutsModule {}
