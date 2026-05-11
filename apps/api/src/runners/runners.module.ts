import { Module } from "@nestjs/common";
import { RunnersController } from "./runners.controller";
import { RunnersRepository } from "./runners.repository";
import { RunnersService } from "./runners.service";

@Module({
  controllers: [RunnersController],
  providers: [RunnersService, RunnersRepository],
  exports: [RunnersService, RunnersRepository],
})
export class RunnersModule {}
