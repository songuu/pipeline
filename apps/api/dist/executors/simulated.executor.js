"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulatedExecutor = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@deploy-management/shared");
const stage_templates_1 = require("./stage-templates");
/**
 * 内存版执行器。把"模拟推进 stage"作为唯一职责，
 * 业务面（pipeline run 的状态机、审批门控）由 RunsService 协调。
 *
 * 这是 ExecutorAdapter 的默认实现，无外部依赖。
 */
let SimulatedExecutor = class SimulatedExecutor {
    backend = "simulated";
    records = new Map();
    async start(input) {
        const stages = this.materializeStages(input.stages);
        const record = {
            runId: input.pipelineRunId,
            input,
            stages,
            startedAt: new Date().toISOString(),
            canceled: false,
            events: [
                {
                    runId: input.pipelineRunId,
                    type: "status",
                    timestamp: new Date().toISOString(),
                    payload: { status: "RUNNING" },
                },
            ],
        };
        this.records.set(input.pipelineRunId, record);
        return { runId: input.pipelineRunId, backend: this.backend };
    }
    async status(handle) {
        const record = this.requireRecord(handle.runId);
        return {
            runId: record.runId,
            status: this.derivedStatus(record),
            stages: record.stages,
            startedAt: record.startedAt,
            finishedAt: record.finishedAt,
        };
    }
    async cancel(handle) {
        const record = this.records.get(handle.runId);
        if (!record)
            return;
        record.canceled = true;
        record.finishedAt = new Date().toISOString();
        record.stages = record.stages.map((stage) => ["INIT", "QUEUED", "RUNNING"].includes(stage.status)
            ? { ...stage, status: "CANCELED" }
            : stage);
        record.events.push({
            runId: record.runId,
            type: "status",
            timestamp: record.finishedAt,
            payload: { status: "CANCELED" },
        });
    }
    async *events(handle) {
        const record = this.requireRecord(handle.runId);
        for (const event of record.events) {
            yield event;
        }
    }
    /** 控制面专用：标记 stage 完成 / 失败，对外保持 ExecutorAdapter 接口。 */
    finishStage(runId, stageKey, status) {
        const record = this.requireRecord(runId);
        record.stages = record.stages.map((stage) => stage.name === stageKey
            ? {
                ...stage,
                status,
                jobs: stage.jobs.map((job) => ({
                    ...job,
                    status,
                    durationMs: stage_templates_1.STAGE_DURATIONS[stageKey],
                    finishedAt: new Date().toISOString(),
                })),
            }
            : stage);
        record.events.push({
            runId,
            type: "stage",
            timestamp: new Date().toISOString(),
            payload: { stageKey, status },
        });
    }
    markRunFinished(runId, status) {
        const record = this.records.get(runId);
        if (!record)
            return;
        record.finishedAt = new Date().toISOString();
        record.events.push({
            runId,
            type: "status",
            timestamp: record.finishedAt,
            payload: { status },
        });
    }
    /** Test/dev helper: clear all simulated run state. */
    reset() {
        this.records.clear();
    }
    materializeStages(keys) {
        return keys.map((key, index) => ({
            index,
            name: key,
            status: (0, shared_1.toYunxiaoJobStatus)("pending"),
            jobs: [
                {
                    id: `${key}-job`,
                    name: key,
                    taskRef: key,
                    status: (0, shared_1.toYunxiaoJobStatus)("pending"),
                    steps: [],
                },
            ],
        }));
    }
    requireRecord(runId) {
        const record = this.records.get(runId);
        if (!record) {
            throw new Error(`Simulated run ${runId} not found`);
        }
        return record;
    }
    derivedStatus(record) {
        if (record.canceled)
            return "CANCELED";
        const allSuccess = record.stages.every((stage) => stage.status === "SUCCESS" || stage.status === "SKIPPED");
        if (allSuccess)
            return "SUCCESS";
        const anyFail = record.stages.some((stage) => stage.status === "FAIL");
        if (anyFail)
            return "FAIL";
        const anyRunning = record.stages.some((stage) => stage.status === "RUNNING");
        if (anyRunning)
            return "RUNNING";
        return "QUEUED";
    }
};
exports.SimulatedExecutor = SimulatedExecutor;
exports.SimulatedExecutor = SimulatedExecutor = __decorate([
    (0, common_1.Injectable)()
], SimulatedExecutor);
//# sourceMappingURL=simulated.executor.js.map