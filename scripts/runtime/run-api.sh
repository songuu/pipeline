#!/usr/bin/env bash
set -euo pipefail
# 从 repo 根运行；scripts/runtime/ -> ../.. = repo 根
cd "$(dirname "$0")/../.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
exec pnpm --filter @deploy-management/api start
