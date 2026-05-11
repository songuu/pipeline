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
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const audit_repository_1 = require("./audit.repository");
let AuditService = class AuditService {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    list() {
        return this.repo.snapshot();
    }
    async record(actor, action, target) {
        const event = {
            id: `audit-${this.repo.snapshot().length + 1}`,
            actor,
            action,
            target,
            createdAt: new Date().toISOString(),
        };
        await this.repo.prepend(event);
        return event;
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(audit_repository_1.AuditRepository)),
    __metadata("design:paramtypes", [audit_repository_1.AuditRepository])
], AuditService);
//# sourceMappingURL=audit.service.js.map