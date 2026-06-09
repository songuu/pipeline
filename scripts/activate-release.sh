#!/usr/bin/env bash
set -euo pipefail
#
# 激活一个已落盘的 release（CI 在 scp+untar 后经 ssh 调用，或机上手动调用）。
# 做：链 env -> pnpm install --prod -> 切 current symlink -> pm2 重载 -> 健康门 -> 失败自动回滚。
#
# 用法: activate-release.sh <release_dir>
# 环境: DEPLOY_ROOT(默认 /opt/deploy-management) / KEEP_RELEASES / API_PORT / WEB_PORT
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$HERE/lib/release-common.sh"

RELEASE_DIR="${1:?usage: activate-release.sh <release_dir>}"
RELEASE_DIR="$(cd "$RELEASE_DIR" && pwd)"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/deploy-management}"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: 未安装 pm2（npm i -g pm2）。" >&2
  exit 1
fi

# CI 经 appleboy/ssh-action 以“非登录非交互” shell 调用，不 source ~/.profile，
# 用 corepack/版本管理器装的 pnpm 可能不在 PATH。先尝试 corepack enable，再硬性预检 pnpm 可用，
# 缺失则立即失败（否则 activate_release 内 `pnpm install --prod` 会在切 symlink 前炸，信息更隐晦）。
if command -v corepack >/dev/null 2>&1; then corepack enable >/dev/null 2>&1 || true; fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: 未找到 pnpm（非登录 shell PATH 缺失？请确保 pnpm 全局可用或 corepack 已启用）。" >&2
  exit 1
fi

activate_release "$DEPLOY_ROOT" "$RELEASE_DIR"
pm2 status
