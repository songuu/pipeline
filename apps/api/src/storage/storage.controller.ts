import { Controller, Get, Inject } from "@nestjs/common";
import { StorageService, type StorageHealth } from "./storage.service";

@Controller()
export class StorageController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get("api/storage/health")
  health(): Promise<StorageHealth> {
    return this.storage.health();
  }
}
