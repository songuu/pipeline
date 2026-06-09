#!/usr/bin/env bash
set -euo pipefail
#
# 一键回滚：把 current 指回上一份（或指定）release 并重载 pm2。
# 用法: rollback.sh [target_release_dir]
#   不带参数 = 回滚到“当前之外、最近修改”的那一份。
# 环境: DEPLOY_ROOT(默认 /opt/deploy-management) / API_PORT / WEB_PORT
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$HERE/lib/release-common.sh"

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/deploy-management}"
current_link="$DEPLOY_ROOT/current"
releases_dir="$DEPLOY_ROOT/releases"
target="${1:-}"

if [ -z "$target" ]; then
  cur="$(readlink -f "$current_link" 2>/dev/null || true)"
  # 取最近修改且不等于当前的第一份
  while IFS= read -r d; do
    d="${d%/}"
    [ -n "$d" ] || continue
    if [ "$(readlink -f "$d" 2>/dev/null)" != "$cur" ]; then
      target="$d"
      break
    fi
  done < <(ls -1dt "$releases_dir"/*/ 2>/dev/null || true)
fi

if [ -z "$target" ] || [ ! -d "$target" ]; then
  echo "ERROR: 找不到可回滚的 release（releases_dir=$releases_dir）。" >&2
  exit 1
fi
target="$(cd "$target" && pwd)"

# 切换前校验目标结构完整：避免把 current 指向一个残缺/半截 release（pm2 随后必然起不来）。
if [ ! -f "$target/ecosystem.config.cjs" ]; then
  echo "ERROR: 目标 release 缺少 ecosystem.config.cjs，结构不完整，拒绝回滚: $target" >&2
  exit 1
fi

echo "==> 回滚 current -> $target"
ln -sfn "$target" "$current_link"
pm2_reload_all "$current_link/ecosystem.config.cjs"

if health_gate "${API_PORT:-4000}" "${WEB_PORT:-3000}"; then
  echo "==> 回滚后健康门通过"
else
  echo "WARN: 回滚后健康门未通过，请人工介入。" >&2
  exit 1
fi
pm2 status
