import { Controller, Get, Inject } from "@nestjs/common";
import {
  LIFECYCLE_STAGES,
  type ApiResponse,
  type LifecycleStageSpec,
  type PlatformSnapshot,
} from "@deploy-management/shared";
import { ok } from "../common/api-response";
import { RequireRoles } from "../security/roles.decorator";
import { SnapshotService } from "./snapshot.service";

@RequireRoles("viewer")
@Controller()
export class SnapshotController {
  constructor(@Inject(SnapshotService) private readonly snapshot: SnapshotService) {}

  @Get("api/snapshot")
  legacy(): PlatformSnapshot {
    return this.snapshot.build();
  }

  @Get("api/lifecycle")
  legacyLifecycle(): LifecycleStageSpec[] {
    return LIFECYCLE_STAGES;
  }

  @Get("oapi/v1/flow/snapshot")
  read(): ApiResponse<PlatformSnapshot> {
    return ok(this.snapshot.build());
  }

  @Get("oapi/v1/flow/lifecycle")
  lifecycle(): ApiResponse<LifecycleStageSpec[]> {
    return ok(LIFECYCLE_STAGES, { total: LIFECYCLE_STAGES.length });
  }
}
