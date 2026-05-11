"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const parseOrigins = (raw) => {
    if (!raw)
        return [];
    return raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
};
const LOCAL_WEB_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
];
const resolveWebOrigins = () => {
    const configured = parseOrigins(process.env.WEB_ORIGIN);
    if (configured.length > 0)
        return configured;
    return process.env.NODE_ENV === "production" ? [] : LOCAL_WEB_ORIGINS;
};
async function bootstrap() {
    // WEB_ORIGIN remains the production allowlist. Local dev defaults include
    // the Next.js ports this workspace commonly uses.
    const allowed = resolveWebOrigins();
    const corsOptions = allowed.length > 0
        ? { origin: allowed, credentials: true }
        : false;
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { cors: corsOptions });
    app.setGlobalPrefix("");
    await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000, "0.0.0.0");
}
bootstrap().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start CI/CD API", error);
    process.exitCode = 1;
});
//# sourceMappingURL=main.js.map