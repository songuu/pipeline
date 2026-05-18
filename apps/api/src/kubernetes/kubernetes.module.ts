import { Module } from "@nestjs/common";
import { KubernetesController } from "./kubernetes.controller";
import { KubernetesService } from "./kubernetes.service";

@Module({
  controllers: [KubernetesController],
  providers: [KubernetesService],
  exports: [KubernetesService],
})
export class KubernetesModule {}
