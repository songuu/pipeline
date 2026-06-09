#!/usr/bin/env bash
#
# 服务器原地部署（机上构建版，break-glass 兜底）：git 同步 -> 构建 -> 组装 release -> 原子激活。
# 正式发布已由 .github/workflows/deploy.yml 离机构建接管（消除 1.8GB 盒子 next build OOM）；
# 本脚本保留用于：CI 不可用、或需在盒子上直接构建排障。
#
# 在服务器上运行。用法:
#   cd /opt/deploy-management/app && ./scripts/deploy-server.sh
# 可选环境变量:
#   BRANCH         部署分支（默认 main）
#   ENV_FILE       首次播种用的环境文件名（默认 .env.production）
#   DEPLOY_ROOT    部署根（默认 /opt/deploy-management）
#   KEEP_RELEASES  保留 release 份数（默认 3）
#   SKIP_GIT       设为 1 跳过 git 同步（仅重建当前工作区）
#
set -euo pipefail

cd "$(dirname "$0")/.." # repo 根（= $DEPLOY_ROOT/app）
REPO_ROOT="$(pwd)"
BRANCH="${BRANCH:-main}"
ENV_FILE="${ENV_FILE:-.env.production}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/deploy-management}"

# shellcheck source=lib/release-common.sh
. "$REPO_ROOT/scripts/lib/release-common.sh"

step() { printf '\n==> %s\n' "$1"; }

# --- 1. 同步代码 ---
if [ "${SKIP_GIT:-0}" != "1" ]; then
  step "同步分支 $BRANCH"
  git fetch --prune origin
  git checkout "$BRANCH"
  # ff-only fail-safe：服务器工作区须保持干净。构建产物已不再入库（见 .gitignore），
  # 正常不会再脏；若仍失败需人工 git reset --hard origin/$BRANCH（destructive，确认后执行）。
  git pull --ff-only origin "$BRANCH"
else
  step "SKIP_GIT=1，跳过 git 同步"
fi

# --- 2. 共享 env（源真值在 $DEPLOY_ROOT/shared/.env；首次从 repo 的 ENV_FILE 播种）---
step "准备共享 env"
mkdir -p "$DEPLOY_ROOT/shared" "$DEPLOY_ROOT/releases"
if [ ! -f "$DEPLOY_ROOT/shared/.env" ] && [ -f "$REPO_ROOT/$ENV_FILE" ]; then
  cp "$REPO_ROOT/$ENV_FILE" "$DEPLOY_ROOT/shared/.env"
  chmod 600 "$DEPLOY_ROOT/shared/.env" || true
fi
# 本地构建阶段也可能读 .env，链到 repo 根（apps 与 run-*.sh 读根 .env）。
ln -sfn "$DEPLOY_ROOT/shared/.env" "$REPO_ROOT/.env" 2>/dev/null || true

# --- 3. 安装 + 构建（机上；CI 路径会接管此步以避 OOM）---
step "安装依赖"
if command -v corepack >/dev/null 2>&1; then corepack enable; fi
pnpm install --frozen-lockfile
step "构建 shared / api / web"
pnpm -r build

# --- 4. 条件构建 Go bridge：仅 EXECUTOR=tekton ---
EXECUTOR_VALUE="$(read_executor "$DEPLOY_ROOT")"
EXECUTOR_VALUE="${EXECUTOR_VALUE:-local-docker}"
if [ "$EXECUTOR_VALUE" = "tekton" ]; then
  step "构建 Tekton bridge (EXECUTOR=tekton)"
  # WHY 显式补 PATH：go 装在 /usr/local/go/bin，非登录 shell（ssh host '...'）PATH 不含它。
  export PATH="/usr/local/go/bin:$PATH"
  command -v go >/dev/null 2>&1 || { echo "ERROR: EXECUTOR=tekton 但未找到 go" >&2; exit 1; }
  ( cd services/tekton-bridge && CGO_ENABLED=0 go build -tags tekton -o tekton-bridge ./cmd/server )
else
  step "跳过 bridge 构建 (EXECUTOR=$EXECUTOR_VALUE，local-docker 不需要)"
fi

# --- 5. 组装 release 包 ---
RELEASE_NAME="$(date +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
RELEASE_DIR="$DEPLOY_ROOT/releases/$RELEASE_NAME"
step "组装 release: $RELEASE_DIR"
bash "$REPO_ROOT/scripts/assemble-bundle.sh" "$RELEASE_DIR"

# --- 6. 原子激活 + 健康门 + 失败自动回滚 ---
if ! command -v pm2 >/dev/null 2>&1; then echo "ERROR: 未安装 pm2（npm i -g pm2）。" >&2; exit 1; fi
step "激活 release"
activate_release "$DEPLOY_ROOT" "$RELEASE_DIR"

step "完成"
pm2 status
