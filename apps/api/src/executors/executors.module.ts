import { Module, type Provider } from "@nestjs/common";
import { EXECUTOR_ADAPTER } from "../lifecycle/executor-adapter";
import { LocalDockerExecutor } from "./local-docker.executor";
import { SimulatedExecutor } from "./simulated.executor";
import { TektonBridgeExecutor } from "./tekton.executor";

const executorProvider: Provider = {
  provide: EXECUTOR_ADAPTER,
  inject: [SimulatedExecutor, TektonBridgeExecutor, LocalDockerExecutor],
  useFactory: (simulated: SimulatedExecutor, tekton: TektonBridgeExecutor, localDocker: LocalDockerExecutor) => {
    if (process.env.EXECUTOR === "tekton") return tekton;
    if (process.env.EXECUTOR === "local-docker") return localDocker;
    return simulated;
  },
};

@Module({
  providers: [SimulatedExecutor, TektonBridgeExecutor, LocalDockerExecutor, executorProvider],
  exports: [EXECUTOR_ADAPTER, SimulatedExecutor, TektonBridgeExecutor, LocalDockerExecutor],
})
export class ExecutorsModule {}
