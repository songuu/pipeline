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
