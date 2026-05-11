import { Module, type Provider } from "@nestjs/common";
import { EXECUTOR_ADAPTER } from "../lifecycle/executor-adapter";
import { SimulatedExecutor } from "./simulated.executor";
import { TektonBridgeExecutor } from "./tekton.executor";

const executorProvider: Provider = {
  provide: EXECUTOR_ADAPTER,
  inject: [SimulatedExecutor, TektonBridgeExecutor],
  useFactory: (simulated: SimulatedExecutor, tekton: TektonBridgeExecutor) =>
    process.env.EXECUTOR === "tekton" ? tekton : simulated,
};

@Module({
  providers: [SimulatedExecutor, TektonBridgeExecutor, executorProvider],
  exports: [EXECUTOR_ADAPTER, SimulatedExecutor, TektonBridgeExecutor],
})
export class ExecutorsModule {}
