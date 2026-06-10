#!/usr/bin/env bash
# 发布公共函数库 —— 被 deploy-server.sh / activate-release.sh / rollback.sh source 复用。
# 不直接执行；source 后调用其中函数。约定调用方已 set -euo pipefail。

# 健康探针：轮询 url 直到 HTTP 2xx 或超时。返回 0 成功 / 1 失败。
# 用法: health_check <url> [retries=15] [delay_sec=2]
health_check() {
  local url="$1" retries="${2:-15}" delay="${3:-2}" i
  for ((i = 1; i <= retries; i++)); do
    if curl -fsS -o /dev/null --max-time 5 "$url"; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

# 分服务健康门：分别探 api / web 并各自打印 PASS/FAIL（运维可立即定位是哪一端挂了），
# 两端皆 PASS 返回 0，否则非 0。调用方须用 `|| x=0` 或置于 if 条件中（其内含 health_check 失败属预期）。
# 用法: health_gate <api_port> <web_port>
health_gate() {
  local api_port="$1" web_port="$2" api_ok web_ok
  if health_check "http://127.0.0.1:$api_port/healthz"; then api_ok=PASS; else api_ok=FAIL; fi
  if health_check "http://127.0.0.1:$web_port/healthz"; then web_ok=PASS; else web_ok=FAIL; fi
  echo "==> 健康门: api=$api_ok web=$web_ok"
  [ "$api_ok" = PASS ] && [ "$web_ok" = PASS ]
}

# pm2 激活控制面服务。
# WHY 用 delete+start：pm2 startOrReload 已存在进程时可能保留旧 release 的 script path / cwd；
# 重新注册 dm-api/dm-web 可确保每次发布都对齐 current。bridge 保持 stop 待命，不在 local-docker 模式拉起。
pm2_reload_all() {
  local ecosystem="$1"
  pm2 delete dm-api dm-web >/dev/null 2>&1 || true
  pm2 start "$ecosystem" --only dm-api,dm-web --update-env && pm2 save
}

# 把共享 env 链接进 release（源真值在 $DEPLOY_ROOT/shared/.env，git pull 不覆盖、长期保留）。
link_env() {
  local deploy_root="$1" release_dir="$2"
  local shared_env="$deploy_root/shared/.env"
  if [ -f "$shared_env" ]; then
    ln -sfn "$shared_env" "$release_dir/.env"
  else
    echo "WARN: $shared_env 不存在；运行时可能缺少必需配置。" >&2
  fi
}

# 从共享 env 读取 EXECUTOR（决定是否需要构建 Go bridge）。空则返回空，调用方兜底 local-docker。
read_executor() {
  local deploy_root="$1" shared_env="$1/shared/.env"
  if [ -f "$shared_env" ]; then
    grep -E '^EXECUTOR=' "$shared_env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'" || true
  fi
}

# 保留最近 keep_n 份 release，删除其余。WHY：40G/80% 盘，每份含 node_modules+.next 较大，必须限量防撑爆。
prune_releases() {
  local releases_dir="$1" keep_n="${2:-3}" olds
  [ -d "$releases_dir" ] || return 0
  olds="$(ls -1dt "$releases_dir"/*/ 2>/dev/null | tail -n "+$((keep_n + 1))" || true)"
  [ -n "$olds" ] || return 0
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    echo "prune 旧 release: ${old%/}"
    rm -rf "${old%/}"
  done <<< "$olds"
}

# 原子激活 release：装依赖 -> 记录上一份 -> 切 current -> 重载 -> 健康门；失败自动回滚到上一份并 return 1。
# 用法: activate_release <deploy_root> <release_dir>（release_dir 须为绝对路径）
activate_release() {
  local deploy_root="$1" release_dir="$2"
  local current_link="$deploy_root/current"
  local api_port="${API_PORT:-4000}" web_port="${WEB_PORT:-3000}"

  link_env "$deploy_root" "$release_dir"

  echo "==> 安装生产依赖"
  ( cd "$release_dir" && pnpm install --prod --frozen-lockfile )

  # 记录回滚目标：当前 current 指向的旧 release（先于切换捕获）。
  local previous=""
  if [ -L "$current_link" ]; then
    previous="$(readlink -f "$current_link" 2>/dev/null || true)"
  fi

  echo "==> 切换 current -> $release_dir"
  ln -sfn "$release_dir" "$current_link"
  chmod +x "$current_link/scripts/runtime/"*.sh 2>/dev/null || true
  chmod +x "$current_link/services/tekton-bridge/tekton-bridge" 2>/dev/null || true

  # WHY 用 ok 标志而非裸调用：切 symlink 之后若 pm2 重载或健康门失败，set -e 会在“到达回滚块之前”
  # 中止函数，把 current 永久留在坏 release。用 `|| ok=0` 抑制 set -e，让所有失败统一汇到下方回滚路径。
  local ok=1
  echo "==> pm2 重载"
  pm2_reload_all "$current_link/ecosystem.config.cjs" || ok=0
  if [ "$ok" = 1 ]; then
    health_gate "$api_port" "$web_port" || ok=0
  else
    echo "ERROR: pm2 重载失败" >&2
  fi

  if [ "$ok" = 1 ]; then
    echo "==> 发布成功"
    prune_releases "$deploy_root/releases" "${KEEP_RELEASES:-3}"
    return 0
  fi

  # ---- 自动回滚 ----
  echo "ERROR: 发布失败，触发自动回滚" >&2
  if [ -n "$previous" ] && [ -d "$previous" ] && [ "$previous" != "$release_dir" ]; then
    echo "==> 自动回滚 current -> $previous" >&2
    ln -sfn "$previous" "$current_link"
    # 回滚后必须复检：上一份也可能已损坏（坏 .env / 缺文件），否则会把坏态当“已恢复”。
    if pm2_reload_all "$current_link/ecosystem.config.cjs" && health_gate "$api_port" "$web_port"; then
      echo "==> 回滚后健康门通过（系统已恢复到上一份）" >&2
    else
      echo "CRITICAL: 回滚后健康门仍未通过，需立即人工介入！current=$previous" >&2
    fi
  else
    echo "WARN: 无可回滚的上一份（首次发布？）；current 仍指向失败的 release，需人工介入。" >&2
  fi
  return 1
}
