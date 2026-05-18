import { Controller, Get, Inject } from "@nestjs/common";
import { RequireRoles } from "../security/roles.decorator";
import { StorageService, type StorageHealth } from "./storage.service";

@RequireRoles("viewer")
@Controller()
export class StorageController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get("api/storage/health")
  health(): Promise<StorageHealth> {
    return this.storage.health();
  }
}
