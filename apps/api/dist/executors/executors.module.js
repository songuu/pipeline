"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutorsModule = void 0;
const common_1 = require("@nestjs/common");
const executor_adapter_1 = require("../lifecycle/executor-adapter");
const local_docker_executor_1 = require("./local-docker.executor");
const simulated_executor_1 = require("./simulated.executor");
const tekton_executor_1 = require("./tekton.executor");
const executorProvider = {
    provide: executor_adapter_1.EXECUTOR_ADAPTER,
    inject: [simulated_executor_1.SimulatedExecutor, tekton_executor_1.TektonBridgeExecutor, local_docker_executor_1.LocalDockerExecutor],
    useFactory: (simulated, tekton, localDocker) => {
        if (process.env.EXECUTOR === "tekton")
            return tekton;
        if (process.env.EXECUTOR === "local-docker")
            return localDocker;
        return simulated;
    },
};
let ExecutorsModule = class ExecutorsModule {
};
exports.ExecutorsModule = ExecutorsModule;
exports.ExecutorsModule = ExecutorsModule = __decorate([
    (0, common_1.Module)({
        providers: [simulated_executor_1.SimulatedExecutor, tekton_executor_1.TektonBridgeExecutor, local_docker_executor_1.LocalDockerExecutor, executorProvider],
        exports: [executor_adapter_1.EXECUTOR_ADAPTER, simulated_executor_1.SimulatedExecutor, tekton_executor_1.TektonBridgeExecutor, local_docker_executor_1.LocalDockerExecutor],
    })
], ExecutorsModule);
//# sourceMappingURL=executors.module.js.map