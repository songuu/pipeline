#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# 优先用 Next standalone 产物：自带最小 node_modules，无需机上装 web 依赖，运行内存更低。
# outputFileTracingRoot=repo根 时，standalone 内镜像仓库结构，入口在 apps/web/server.js。
STANDALONE_SERVER="apps/web/.next/standalone/apps/web/server.js"
if [ -f "$STANDALONE_SERVER" ]; then
  cd apps/web/.next/standalone
  exec env PORT="${WEB_PORT:-3000}" HOSTNAME="${WEB_HOST:-127.0.0.1}" node apps/web/server.js
fi

# 回退：未启用/未拷贝 standalone 时仍用 next start，保证向后兼容。
exec pnpm --filter @deploy-management/web exec next start --hostname "${WEB_HOST:-127.0.0.1}" --port "${WEB_PORT:-3000}"
