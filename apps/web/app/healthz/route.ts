// 部署存活探针（Web 端）。
// WHY 无鉴权且独立路由：部署脚本以 127.0.0.1:3000/healthz 直连，验证 Next 自身存活，
// 而非经 nginx/Basic 或 /api/* 代理（next.config rewrites 只转发 /api/*，此路由由 Next 直接处理）。
// force-dynamic 避免被静态化缓存，确保每次探测都命中运行中的进程。
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok" });
}
