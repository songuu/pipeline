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
exports.ArtifactsController = void 0;
const common_1 = require("@nestjs/common");
const api_response_1 = require("../common/api-response");
const artifacts_service_1 = require("./artifacts.service");
let ArtifactsController = class ArtifactsController {
    service;
    constructor(service) {
        this.service = service;
    }
    legacyList() {
        return this.service.list();
    }
    list() {
        const items = this.service.list();
        return (0, api_response_1.ok)(items, { total: items.length });
    }
};
exports.ArtifactsController = ArtifactsController;
__decorate([
    (0, common_1.Get)("api/artifacts"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], ArtifactsController.prototype, "legacyList", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/artifacts"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], ArtifactsController.prototype, "list", null);
exports.ArtifactsController = ArtifactsController = __decorate([
    (0, common_1.Controller)(),
    __param(0, (0, common_1.Inject)(artifacts_service_1.ArtifactsService)),
    __metadata("design:paramtypes", [artifacts_service_1.ArtifactsService])
], ArtifactsController);
//# sourceMappingURL=artifacts.controller.js.map