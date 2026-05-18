import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { ApiResponse, RemoteRepositoryRefs, ResolvedRemoteRepository, SourceRepository } from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CodeReposService } from "./code-repos.service";
import {
  remoteRepositoryRefsSchema,
  resolveRepositorySchema,
  type RemoteRepositoryRefsDto,
  type ResolveRepositoryDto,
} from "./dto/remote-repository.dto";

@Controller()
export class CodeReposController {
  constructor(@Inject(CodeReposService) private readonly service: CodeReposService) {}

  @Get("api/repositories")
  legacyList(): SourceRepository[] {
    return this.service.list();
  }

  @Post("api/repositories/resolve")
  resolve(
    @Body(new ZodValidationPipe(resolveRepositorySchema)) body: ResolveRepositoryDto,
  ): Promise<ResolvedRemoteRepository> {
    return this.service.resolveRemote(body);
  }

  @Post("api/repositories/refs")
  refs(
    @Body(new ZodValidationPipe(remoteRepositoryRefsSchema)) body: RemoteRepositoryRefsDto,
  ): Promise<RemoteRepositoryRefs> {
    return this.service.listRemoteRefs(body);
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
