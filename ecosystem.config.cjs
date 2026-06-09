// pm2 进程编排：从 repo 根原地运行三服务。
// 启动: pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save
// 各 run-*.sh 会 source 根 .env（部署脚本把 .env 软链到 .env.production）。
module.exports = {
  apps: [
    {
      name: "dm-api",
      cwd: __dirname,
      script: "./scripts/runtime/run-api.sh",
      interpreter: "bash",
      env: { NODE_ENV: "production" },
    },
    {
      name: "dm-web",
      cwd: __dirname,
      script: "./scripts/runtime/run-web.sh",
      interpreter: "bash",
      env: { NODE_ENV: "production" },
      // 护栏：Next16+Node22 standalone 存在 fetch-cache 内存增长（vercel/next.js #85914）。
      // 1.8GB 盒子内存紧张，超阈值自动重启防 OOM 拖垮控制面。
      max_memory_restart: "400M",
    },
    {
      name: "dm-tekton-bridge",
      cwd: __dirname,
      script: "./scripts/runtime/run-tekton-bridge.sh",
      interpreter: "bash",
      env: { NODE_ENV: "production" },
    },
  ],
};
