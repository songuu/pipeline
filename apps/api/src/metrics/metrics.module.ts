import { Module } from "@nestjs/common";
import { ArtifactsModule } from "../artifacts/artifacts.module";
import { ReleasesModule } from "../releases/releases.module";
import { DoraController } from "./dora.controller";
import { DoraService } from "./dora.service";

@Module({
  imports: [ReleasesModule, ArtifactsModule],
  controllers: [DoraController],
  providers: [DoraService],
  exports: [DoraService],
})
export class MetricsModule {}
