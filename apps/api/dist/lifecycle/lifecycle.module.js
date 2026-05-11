"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifecycleModule = void 0;
const common_1 = require("@nestjs/common");
const executors_module_1 = require("../executors/executors.module");
const lifecycle_engine_1 = require("./lifecycle.engine");
let LifecycleModule = class LifecycleModule {
};
exports.LifecycleModule = LifecycleModule;
exports.LifecycleModule = LifecycleModule = __decorate([
    (0, common_1.Module)({
        imports: [executors_module_1.ExecutorsModule],
        providers: [lifecycle_engine_1.LifecycleEngine],
        exports: [lifecycle_engine_1.LifecycleEngine],
    })
], LifecycleModule);
//# sourceMappingURL=lifecycle.module.js.map