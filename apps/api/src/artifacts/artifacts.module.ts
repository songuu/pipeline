import { Module } from "@nestjs/common";
import { ArtifactsController } from "./artifacts.controller";
import { ArtifactsRepository } from "./artifacts.repository";
import { ArtifactsService } from "./artifacts.service";

@Module({
  controllers: [ArtifactsController],
  providers: [ArtifactsService, ArtifactsRepository],
  exports: [ArtifactsService, ArtifactsRepository],
})
export class ArtifactsModule {}
