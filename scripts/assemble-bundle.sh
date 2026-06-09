#!/usr/bin/env bash
set -euo pipefail
#
# 把已构建的可运行集组装进 <dest>。
# 前置：pnpm -r build 已完成（apps/api/dist、apps/web/.next/standalone、packages/shared/dist 存在）。
# 同时被 deploy-server.sh（机上构建）与 .github/workflows/deploy.yml（CI 构建）调用，
# 保证两条路径产出的 release 结构完全一致。
#
# 用法: assemble-bundle.sh <dest_dir>
DEST="${1:?usage: assemble-bundle.sh <dest_dir>}"
SRC="$(cd "$(dirname "$0")/.." && pwd)" # repo 根

mkdir -p "$DEST"

# copy <relative-path> [required|optional]
copy() {
  local rel="$1" mode="${2:-required}"
  if [ -e "$SRC/$rel" ]; then
    mkdir -p "$DEST/$(dirname "$rel")"
    cp -R "$SRC/$rel" "$DEST/$rel"
  elif [ "$mode" = "required" ]; then
    echo "ERROR: 缺少必需产物 $rel（是否未执行 pnpm -r build？）" >&2
    exit 1
  fi
}

# 根清单（pnpm workspace 装 --prod 依赖需要）
copy package.json
copy pnpm-lock.yaml
copy pnpm-workspace.yaml
copy ecosystem.config.cjs

# 发布/运行脚本：release 内自带，供 CI 经 ssh 调用 activate/rollback。
copy scripts/runtime
copy scripts/lib
copy scripts/activate-release.sh
copy scripts/rollback.sh

# shared（api 经 workspace 消费其 dist）
copy packages/shared/package.json
copy packages/shared/dist

# api（node dist/main.js，运行时依赖由 activate 的 pnpm install --prod 提供）
copy apps/api/package.json
copy apps/api/dist

# web：优先 standalone（自包含最小运行包）
copy apps/web/package.json
copy apps/web/next.config.mjs
if [ -d "$SRC/apps/web/.next/standalone" ]; then
  copy apps/web/.next/standalone
  # Next 文档要求：standalone 不含静态资源与 public，须手动并入，否则 CSS/静态 404。
  mkdir -p "$DEST/apps/web/.next/standalone/apps/web/.next"
  [ -d "$SRC/apps/web/.next/static" ] && cp -R "$SRC/apps/web/.next/static" "$DEST/apps/web/.next/standalone/apps/web/.next/static"
  [ -d "$SRC/apps/web/public" ] && cp -R "$SRC/apps/web/public" "$DEST/apps/web/.next/standalone/apps/web/public"
else
  # 回退：无 standalone 则带完整 .next，run-web.sh 走 next start。
  copy apps/web/.next
fi

# Go bridge 二进制：仅 EXECUTOR=tekton 时构建，存在才带。
copy services/tekton-bridge/tekton-bridge optional

echo "组装完成: $DEST"
