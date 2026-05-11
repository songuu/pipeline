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
var TektonBridgeExecutor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TektonBridgeExecutor = void 0;
const common_1 = require("@nestjs/common");
const simulated_executor_1 = require("./simulated.executor");
const DEFAULT_BRIDGE_URL = "http://127.0.0.1:5050";
/**
 * Tekton 执行器：通过 HTTP 调用 services/tekton-bridge (Go) 推进运行。
 * 当 bridge 不可达时退化到 SimulatedExecutor，保证本地 dev 不被中断。
 */
let TektonBridgeExecutor = TektonBridgeExecutor_1 = class TektonBridgeExecutor {
    fallback;
    backend = "tekton";
    logger = new common_1.Logger(TektonBridgeExecutor_1.name);
    bridgeUrl = process.env.TEKTON_BRIDGE_URL ?? DEFAULT_BRIDGE_URL;
    constructor(fallback) {
        this.fallback = fallback;
    }
    async start(input) {
        try {
            const response = await this.post("/v1/runs", input);
            return { runId: response.runId, backend: this.backend };
        }
        catch (error) {
            this.logger.warn(`Tekton bridge unreachable, falling back to simulated: ${describe(error)}`);
            return this.fallback.start(input);
        }
    }
    async status(handle) {
        if (handle.backend !== this.backend)
            return this.fallback.status(handle);
        try {
            return await this.get(`/v1/runs/${handle.runId}`);
        }
        catch (error) {
            this.logger.warn(`status fallback for ${handle.runId}: ${describe(error)}`);
            return this.fallback.status(handle);
        }
    }
    async cancel(handle) {
        if (handle.backend !== this.backend) {
            await this.fallback.cancel(handle);
            return;
        }
        try {
            await this.post(`/v1/runs/${handle.runId}/cancel`, {});
        }
        catch (error) {
            this.logger.warn(`cancel fallback for ${handle.runId}: ${describe(error)}`);
            await this.fallback.cancel(handle);
        }
    }
    async *events(handle) {
        if (handle.backend !== this.backend) {
            for await (const event of this.fallback.events(handle))
                yield event;
            return;
        }
        try {
            const url = `${this.bridgeUrl}/v1/runs/${handle.runId}/events`;
            const response = await fetch(url, { headers: { Accept: "text/event-stream" } });
            if (!response.ok || !response.body) {
                throw new Error(`bridge events ${response.status}`);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const messages = buffer.split("\n\n");
                buffer = messages.pop() ?? "";
                for (const raw of messages) {
                    const line = raw.replace(/^data:\s*/, "");
                    if (!line)
                        continue;
                    try {
                        yield JSON.parse(line);
                    }
                    catch (error) {
                        this.logger.debug(`bad SSE payload skipped: ${describe(error)}`);
                    }
                }
            }
        }
        catch (error) {
            this.logger.warn(`events fallback for ${handle.runId}: ${describe(error)}`);
            for await (const event of this.fallback.events(handle))
                yield event;
        }
    }
    async post(path, body) {
        const response = await fetch(`${this.bridgeUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`bridge ${path} -> ${response.status}`);
        }
        return (await response.json());
    }
    async get(path) {
        const response = await fetch(`${this.bridgeUrl}${path}`);
        if (!response.ok) {
            throw new Error(`bridge ${path} -> ${response.status}`);
        }
        return (await response.json());
    }
};
exports.TektonBridgeExecutor = TektonBridgeExecutor;
exports.TektonBridgeExecutor = TektonBridgeExecutor = TektonBridgeExecutor_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(simulated_executor_1.SimulatedExecutor)),
    __metadata("design:paramtypes", [simulated_executor_1.SimulatedExecutor])
], TektonBridgeExecutor);
const describe = (error) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
//# sourceMappingURL=tekton.executor.js.map