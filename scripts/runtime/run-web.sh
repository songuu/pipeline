#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
exec pnpm --filter @deploy-management/web exec next start --hostname "${WEB_HOST:-127.0.0.1}" --port "${WEB_PORT:-3000}"
