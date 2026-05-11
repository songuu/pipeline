import { Module } from "@nestjs/common";
import { ExecutorsModule } from "../executors/executors.module";
import { LifecycleEngine } from "./lifecycle.engine";

@Module({
  imports: [ExecutorsModule],
  providers: [LifecycleEngine],
  exports: [LifecycleEngine],
})
export class LifecycleModule {}
