/**
 * Web 端环境配置。
 * 默认走 Next 同源代理，避免 localhost / 127.0.0.1 混用时触发 CORS。
 * 部署到独立域名时可用 NEXT_PUBLIC_API_URL 显式覆盖。
 */
const DEFAULT_API_BASE = "";

export const env = {
  apiBase: (process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE).replace(/\/+$/, ""),
};
