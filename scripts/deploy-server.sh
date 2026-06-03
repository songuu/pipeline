#!/usr/bin/env bash
#
# 服务器原地部署：git 拉取 -> 构建 -> pm2 重载。
# 在服务器上运行（不在本地）。首次部署见下方“一次性 bootstrap”。
#
# 用法:
#   cd /opt/deploy-management/app && ./scripts/deploy-server.sh
# 可选环境变量:
#   BRANCH    部署分支（默认 main）
#   ENV_FILE  环境文件名（默认 .env.production，软链为根 .env）
#   SKIP_GIT  设为 1 跳过 git 拉取（仅重新构建当前工作区）
#
set -euo pipefail

cd "$(dirname "$0")/.."   # repo 根
REPO_ROOT="$(pwd)"
BRANCH="${BRANCH:-main}"
ENV_FILE="${ENV_FILE:-.env.production}"

step() { printf '\n==> %s\n' "$1"; }

# --- 1. 拉取最新代码 ---
if [ "${SKIP_GIT:-0}" != "1" ]; then
  step "拉取分支 $BRANCH"
  git fetch --prune origin
  git checkout "$BRANCH"
  # ff-only：若服务器工作区有本地提交/改动会在此失败（fail-safe），
  # 部署 checkout 应保持干净。需强制对齐远端时手动跑 git reset --hard origin/$BRANCH。
  git pull --ff-only origin "$BRANCH"
else
  step "SKIP_GIT=1，跳过 git 拉取"
fi

# --- 2. 准备 .env（apps 读根 .env；run-*.sh 也 source 它）---
step "链接环境文件 $ENV_FILE -> .env"
if [ -f "$REPO_ROOT/$ENV_FILE" ]; then
  ln -sfn "$ENV_FILE" "$REPO_ROOT/.env"
else
  echo "WARN: $ENV_FILE 不存在；服务可能缺少必需配置。" >&2
fi

# --- 3. 安装依赖（含 devDeps：构建需要 tsc / next）---
step "安装依赖"
if command -v corepack >/dev/null 2>&1; then
  corepack enable
fi
pnpm install --frozen-lockfile

# --- 4. 构建 shared / api / web ---
step "构建 shared / api / web"
pnpm -r build

# --- 5. 构建 Go Tekton bridge（原生编译，-tags tekton 启用真实后端）---
step "构建 Tekton bridge"
( cd services/tekton-bridge && CGO_ENABLED=0 go build -tags tekton -o tekton-bridge ./cmd/server )

# --- 6. 启动 / 重载 pm2 ---
step "pm2 启动/重载"
if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: 未安装 pm2（npm i -g pm2）。" >&2
  exit 1
fi
pm2 startOrReload "$REPO_ROOT/ecosystem.config.cjs" --update-env
pm2 save

step "完成"
pm2 status
