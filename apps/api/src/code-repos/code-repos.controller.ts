import { Controller, Get, Inject, Param } from "@nestjs/common";
import type { ApiResponse, SourceRepository } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { CodeReposService } from "./code-repos.service";

@Controller()
export class CodeReposController {
  constructor(@Inject(CodeReposService) private readonly service: CodeReposService) {}

  @Get("api/repositories")
  legacyList(): SourceRepository[] {
    return this.service.list();
  }

  @Get("oapi/v1/flow/repositories")
  list(): ApiResponse<SourceRepository[]> {
    const items = this.service.list();
    return ok(items, { total: items.length });
  }

  @Get("oapi/v1/flow/repositories/:id")
  get(@Param("id") id: string): ApiResponse<SourceRepository> {
    return ok(this.service.get(id));
  }
}
