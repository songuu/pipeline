#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Go 进程无 .env 加载器，必须由本脚本注入 TEKTON_* / KUBECONFIG / TEKTON_BRIDGE_ADDR 等
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
exec ./services/tekton-bridge/tekton-bridge
