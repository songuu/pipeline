import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone：产出自包含的最小运行包（node server.js），免在 1.8GB 盒子上装 web 依赖、降运行内存。
  output: "standalone",
  // WHY 必填：pnpm monorepo 下默认 tracing root 为 app 目录，会漏掉 workspace 依赖；
  // 指向 repo 根才能把 @deploy-management/shared 等正确纳入 standalone 追踪。
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  transpilePackages: ["@deploy-management/shared"],
  async rewrites() {
    const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiTarget.replace(/\/+$/, "")}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
