"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeReposModule = void 0;
const common_1 = require("@nestjs/common");
const code_repos_controller_1 = require("./code-repos.controller");
const code_repos_repository_1 = require("./code-repos.repository");
const code_repos_service_1 = require("./code-repos.service");
let CodeReposModule = class CodeReposModule {
};
exports.CodeReposModule = CodeReposModule;
exports.CodeReposModule = CodeReposModule = __decorate([
    (0, common_1.Module)({
        controllers: [code_repos_controller_1.CodeReposController],
        providers: [code_repos_service_1.CodeReposService, code_repos_repository_1.CodeReposRepository],
        exports: [code_repos_service_1.CodeReposService, code_repos_repository_1.CodeReposRepository],
    })
], CodeReposModule);
//# sourceMappingURL=code-repos.module.js.map