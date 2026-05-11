import { Module } from "@nestjs/common";
import { CodeReposController } from "./code-repos.controller";
import { CodeReposRepository } from "./code-repos.repository";
import { CodeReposService } from "./code-repos.service";

@Module({
  controllers: [CodeReposController],
  providers: [CodeReposService, CodeReposRepository],
  exports: [CodeReposService, CodeReposRepository],
})
export class CodeReposModule {}
