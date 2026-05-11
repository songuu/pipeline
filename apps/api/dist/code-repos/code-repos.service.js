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
exports.CodeReposService = void 0;
const common_1 = require("@nestjs/common");
const code_repos_repository_1 = require("./code-repos.repository");
let CodeReposService = class CodeReposService {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    list() {
        return this.repo.snapshot();
    }
    get(id) {
        const repository = this.repo.snapshot().find((item) => item.id === id);
        if (!repository) {
            throw new common_1.NotFoundException(`Repository ${id} not found`);
        }
        return repository;
    }
    assertReference(repository, refType, refName) {
        const refs = refType === "branch" ? repository.branches : repository.tags;
        if (!refs.includes(refName)) {
            throw new common_1.BadRequestException(`${repository.name} does not contain ${refType} ${refName}`);
        }
    }
};
exports.CodeReposService = CodeReposService;
exports.CodeReposService = CodeReposService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(code_repos_repository_1.CodeReposRepository)),
    __metadata("design:paramtypes", [code_repos_repository_1.CodeReposRepository])
], CodeReposService);
//# sourceMappingURL=code-repos.service.js.map