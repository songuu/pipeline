/** @type {import('next').NextConfig} */
const nextConfig = {
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
