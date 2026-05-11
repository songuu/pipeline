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
exports.ApplicationsController = void 0;
const common_1 = require("@nestjs/common");
const api_response_1 = require("../common/api-response");
const applications_service_1 = require("./applications.service");
let ApplicationsController = class ApplicationsController {
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
    get(id) {
        return (0, api_response_1.ok)(this.service.get(id));
    }
};
exports.ApplicationsController = ApplicationsController;
__decorate([
    (0, common_1.Get)("api/applications"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], ApplicationsController.prototype, "legacyList", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/applications"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], ApplicationsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("oapi/v1/flow/applications/:id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], ApplicationsController.prototype, "get", null);
exports.ApplicationsController = ApplicationsController = __decorate([
    (0, common_1.Controller)(),
    __param(0, (0, common_1.Inject)(applications_service_1.ApplicationsService)),
    __metadata("design:paramtypes", [applications_service_1.ApplicationsService])
], ApplicationsController);
//# sourceMappingURL=applications.controller.js.map