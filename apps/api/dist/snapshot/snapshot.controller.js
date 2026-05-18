"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnapshotController = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@deploy-management/shared");
const api_response_1 = require("../common/api-response");
const roles_decorator_1 = require("../security/roles.decorator");
const snapshot_service_1 = require("./snapshot.service");
let SnapshotController = class SnapshotController {
    snapshot;
    constructor(snapshot) {
        this.snapshot = snapshot;
    }
    legacy() {
        return this.snapshot.build();
    }
    legacyLifecycle() {
        return shared_1.LIFECYCLE_STAGES;
    }
    read() {
        return (0, api_response_1.ok)(this.snapshot.build());
    }
    lifecycle() {
        return (0, api_response_1.ok)(shared_1.LIFECYCLE_STAGES, { total: shared_1.LIFECYCLE_STAGES.length });
    }
};
exports.SnapshotController = SnapshotController;
__decorate([
    (0, common_1.Get)("api/snapshot"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], SnapshotController.prototype, "legacy", null);
__decorate([
    (0, common_1.Get)("api/lifecycle"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], SnapshotController.prototype, "legacyLifecycle", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/snapshot"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], SnapshotController.prototype, "read", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/lifecycle"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], SnapshotController.prototype, "lifecycle", null);
exports.SnapshotController = SnapshotController = __decorate([
    (0, roles_decorator_1.RequireRoles)("viewer"),
    (0, common_1.Controller)(),
    __param(0, (0, common_1.Inject)(snapshot_service_1.SnapshotService)),
    __metadata("design:paramtypes", [snapshot_service_1.SnapshotService])
], SnapshotController);
//# sourceMappingURL=snapshot.controller.js.map