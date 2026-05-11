import { BadRequestException, Inject, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import {
  type ApprovalRequest,
  type ApprovalStatus,
  type LifecycleStageKey,
  type PipelineDefinition,
  type PipelineRun,
  type SourceRepository,
  type StartPipelineRunParams,
  type TriggerRunRequest,
} from "@deploy-management/shared";
import { ApplicationsService } from "../applications/applications.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { ArtifactsService } from "../artifacts/artifacts.service";
import { AuditService } from "../audit/audit.service";
import { buildStageLogs } from "../executors/stage-templates";
import { CodeReposService } from "../code-repos/code-repos.service";
import { LifecycleEngine } from "../lifecycle/lifecycle.engine";
import { PipelinesService } from "../pipelines/pipelines.service";
import { RunsRepository } from "./runs.repository";
import type { TriggerRunDto } from "./dto/trigger-run.dto";

const LIVE_STAGE_DURATIONS: Record<LifecycleStageKey, number> = {
  source: 1_100,
  test: 1_600,
  build: 1_700,
  env: 950,
  package: 1_050,
  upload: 1_050,
  deploy: 1_500,
  canary: 1_900,
  approval: 650,
  promote: 1_300,
};

@Injectable()
export class RunsService implements OnModuleInit {
  private sequence = 23844;
  private seeded = false;
  private readonly liveTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>();

  async onModuleInit(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    await this.seedInitialRuns();
  }


  constructor(
    @Inject(RunsRepository) private readonly repo: RunsRepository,
    @Inject(PipelinesService) private readonly pipelines: PipelinesService,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
    @Inject(CodeReposService) private readonly codeRepos: CodeReposService,
    @Inject(LifecycleEngine) private readonly lifecycle: LifecycleEngine,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(ArtifactsService) private readonly artifacts: ArtifactsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(): PipelineRun[] {
    return this.repo.snapshot();
  }

  get(id: string): PipelineRun {
    const run = this.repo.snapshot().find((item) => item.id === id);
    if (!run) {
      throw new NotFoundException(`Pipeline run ${id} not found`);
    }
    return run;
  }

  getLogs(id: string): string[] {
    return this.get(id).stages.flatMap((stage) => stage.logs.map((line) => `[${stage.title}] ${line}`));
  }

  /**
   * Trigger a pipeline run. The platform-native shape (TriggerRunRequest) is
   * used; controllers translate Yunxiao-shaped StartPipelineRunParams to this
   * shape before calling.
   */
  async trigger(
    pipelineId: string,
    request: TriggerRunRequest,
    options: { mode?: "realtime" | "instant" } = {},
  ): Promise<PipelineRun> {
    const pipeline = this.pipelines.get(pipelineId);
    const application = this.applications.get(pipeline.applicationId);
    const repository = this.codeRepos.get(request.repositoryId ?? pipeline.repositoryId);
    const refType = request.refType ?? pipeline.defaultRefType;
    const refName =
      request.refName ??
      request.branch ??
      request.tag ??
      pipeline.defaultRef ??
      (refType === "branch" ? repository.defaultBranch : repository.tags[0]);
    if (!refName) {
      throw new BadRequestException(`Pipeline ${pipelineId} 缺少有效的 refName`);
    }
    this.codeRepos.assertReference(repository, refType, refName);

    const runPipeline: PipelineDefinition = {
      ...pipeline,
      repositoryId: repository.id,
      repository: repository.url,
      defaultRefType: refType,
      defaultRef: refName,
      defaultBranch: refType === "branch" ? refName : repository.defaultBranch,
      targetEnvironment: request.environment ?? pipeline.targetEnvironment,
      canaryPercent: request.canaryPercent ?? pipeline.canaryPercent,
      stages: request.stages ? this.pipelines.normalizeStages(request.stages) : pipeline.stages,
    };
    this.assertSourcePolicy(pipeline, refType, refName, request.commitSha);

    const run = this.lifecycle.createRun({
      pipeline: runPipeline,
      applicationName: application.name,
      request: {
        ...request,
        repositoryId: repository.id,
        refType,
        refName,
        branch: refType === "branch" ? refName : repository.defaultBranch,
        tag: refType === "tag" ? refName : undefined,
        commitSha: request.commitSha,
      },
      runNumber: this.sequence++,
    });

    if (options.mode === "instant") {
      this.lifecycle.simulateUntilGate(run);
    }

    await this.repo.prepend(run);

    if (options.mode === "instant") {
      await this.artifacts.upsertFromRun(run);
    } else {
      this.scheduleRealtimeRun(run);
    }

    if (options.mode === "instant" && run.status === "waiting_approval") {
      await this.approvals.createForRun(run);
    }

    await this.audit.record(
      run.actor,
      "trigger_pipeline",
      `${runPipeline.name}/${run.id}/${refType}:${refName}`,
    );
    return run;
  }

  async cancel(runId: string): Promise<PipelineRun> {
    const run = this.get(runId);
    this.clearRunTimers(runId);
    this.lifecycle.cancel(run);
    await this.audit.record(run.actor, "cancel_run", run.id);
    return run;
  }

  async promote(runId: string): Promise<PipelineRun> {
    const run = this.get(runId);
    this.clearRunTimers(runId);
    this.lifecycle.completePromotion(run);
    await this.artifacts.upsertFromRun(run, "provenance");
    await this.audit.record("system", "promote_run", run.id);
    return run;
  }

  async decideApproval(
    approvalId: string,
    decision: ApprovalStatus,
    actor: string,
  ): Promise<{ approval: ApprovalRequest; run: PipelineRun }> {
    if (!["approved", "rejected"].includes(decision)) {
      const approval = this.approvals.get(approvalId);
      const run = this.get(approval.runId);
      return { approval, run };
    }

    const approval = await this.approvals.decide(approvalId, decision, actor);
    const run = this.get(approval.runId);
    this.lifecycle.markApproval(run, decision === "approved", actor);
    if (decision === "approved") {
      await this.artifacts.upsertFromRun(run, "provenance");
    }
    await this.audit.record(actor, `approval_${decision}`, approval.runId);
    return { approval, run };
  }

  /**
   * Translate a Yunxiao-style StartPipelineRunParams payload into a platform
   * TriggerRunRequest, picking the first matching repository / ref.
   */
  toTriggerRequest(pipeline: PipelineDefinition, params: StartPipelineRunParams, actor: string): TriggerRunRequest {
    const repository = this.codeRepos.get(pipeline.repositoryId);
    const branch = this.findFirstRef(repository, params.runningBranchs);
    const tag = this.findFirstRef(repository, params.runningTags);
    const refType: TriggerRunRequest["refType"] = tag ? "tag" : "branch";
    const refName = tag ?? branch ?? pipeline.defaultRef;
    return {
      repositoryId: pipeline.repositoryId,
      refType,
      refName,
      actor,
    };
  }

  private findFirstRef(repository: SourceRepository, mapping?: Record<string, string>): string | undefined {
    if (!mapping) return undefined;
    const exact = mapping[repository.url];
    if (exact) return exact;
    const first = Object.values(mapping)[0];
    return typeof first === "string" ? first : undefined;
  }

  private assertSourcePolicy(
    pipeline: PipelineDefinition,
    refType: TriggerRunRequest["refType"],
    refName: string,
    commitSha?: string,
  ): void {
    const policy = pipeline.sourcePolicy;
    if (!policy) return;

    const isDefaultRef = refType === pipeline.defaultRefType && refName === pipeline.defaultRef;
    if (refType === "branch") {
      if (!isDefaultRef && !policy.allowRuntimeBranch) {
        throw new BadRequestException(`Pipeline ${pipeline.id} does not allow runtime branch selection`);
      }
      if (!matchesAnyPattern(refName, policy.allowedBranchPatterns)) {
        throw new BadRequestException(`Branch ${refName} is not allowed by source policy`);
      }
    }

    if (refType === "tag") {
      if (!isDefaultRef && !policy.allowRuntimeTag) {
        throw new BadRequestException(`Pipeline ${pipeline.id} does not allow runtime tag selection`);
      }
      if (!matchesAnyPattern(refName, policy.allowedTagPatterns)) {
        throw new BadRequestException(`Tag ${refName} is not allowed by source policy`);
      }
    }

    if (commitSha && !policy.allowRuntimeCommit) {
      throw new BadRequestException(`Pipeline ${pipeline.id} does not allow runtime commit override`);
    }
  }

  /** Initial seed runs (replaces former CicdService.seedRuns). */
  async seedInitialRuns(): Promise<void> {
    const mallRun = await this.trigger("pipe-mall-prod", {
      actor: "RO",
      refType: "branch",
      refName: "main",
      canaryPercent: 20,
    }, { mode: "instant" });
    const mallApproval = this.approvals.pendingForRun(mallRun.id);
    if (mallApproval) {
      await this.decideApproval(mallApproval.id, "approved", "SRE-王林");
    }

    await this.trigger("pipe-admin-staging", { actor: "林青", branch: "release/2026.05" }, { mode: "instant" });

    const paymentRun = await this.trigger("pipe-payment-prod", {
      actor: "陈澄",
      refType: "branch",
      refName: "hotfix/risk-gate",
      canaryPercent: 10,
    }, { mode: "instant" });
    paymentRun.updatedAt = new Date().toISOString();

    const adminPipeline = this.pipelines.get("pipe-admin-staging");
    const application = this.applications.get(adminPipeline.applicationId);
    const failed = this.lifecycle.createRun({
      pipeline: adminPipeline,
      applicationName: application.name,
      request: { actor: "系统", branch: "develop", environment: "test" },
      runNumber: this.sequence++,
    });
    this.lifecycle.simulateUntilGate(failed, "build" satisfies LifecycleStageKey);
    await this.repo.prepend(failed);
    await this.audit.record("system", "nightly_pipeline_failed", failed.id);
  }

  private scheduleRealtimeRun(run: PipelineRun): void {
    this.clearRunTimers(run.id);
    let stageIndex = 0;

    const advance = () => {
      if (this.isTerminal(run)) return;
      const stage = run.stages[stageIndex];
      if (!stage) {
        this.finishRealtimeRun(run);
        return;
      }
      stageIndex += 1;

      if (stage.key === "approval" && run.definitionSnapshot.requiresApproval) {
        this.lifecycle.waitForApproval(run);
        void this.artifacts.upsertFromRun(run);
        void this.ensureApproval(run);
        this.clearRunTimers(run.id);
        return;
      }

      this.lifecycle.startStage(stage, run);
      const duration = LIVE_STAGE_DURATIONS[stage.key];
      const logs = buildStageLogs(stage.key, run, "success");

      this.trackTimer(
        run.id,
        setTimeout(() => {
          if (stage.status === "running" && !this.isTerminal(run)) {
            this.lifecycle.appendStageLog(stage, run, logs[1] ?? `${stage.title} 正在执行。`);
          }
        }, Math.max(250, Math.floor(duration * 0.45))),
      );

      this.trackTimer(
        run.id,
        setTimeout(() => {
          if (stage.status !== "running" || this.isTerminal(run)) return;
          this.lifecycle.succeedStage(stage, run);
          this.trackTimer(run.id, setTimeout(advance, 260));
        }, duration),
      );
    };

    this.trackTimer(run.id, setTimeout(advance, 350));
  }

  private async ensureApproval(run: PipelineRun): Promise<void> {
    if (this.approvals.pendingForRun(run.id)) return;
    await this.approvals.createForRun(run);
  }

  private finishRealtimeRun(run: PipelineRun): void {
    if (!this.isTerminal(run)) {
      run.status = "success";
      run.progress = 100;
      run.updatedAt = new Date().toISOString();
      void this.artifacts.upsertFromRun(run);
    }
    this.clearRunTimers(run.id);
  }

  private isTerminal(run: PipelineRun): boolean {
    return ["success", "failed", "canceled"].includes(run.status);
  }

  private trackTimer(runId: string, timer: ReturnType<typeof setTimeout>): void {
    this.liveTimers.set(runId, [...(this.liveTimers.get(runId) ?? []), timer]);
  }

  private clearRunTimers(runId: string): void {
    const timers = this.liveTimers.get(runId) ?? [];
    timers.forEach((timer) => clearTimeout(timer));
    this.liveTimers.delete(runId);
  }
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
