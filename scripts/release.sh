#!/usr/bin/env bash
set -euo pipefail
#
# 本地一键发版派发器（开发机执行；Windows 走 Git Bash，Linux/macOS 原生）。
#
# 子命令：
#   ci        默认（pnpm deploy）   触发 GitHub Actions 离机构建+部署，然后 watch 到结束。
#                                   零本地构建、零漂移——构建在 GitHub runner 上完成（盒子 1.8GB 跑不动 next build）。
#   local     （pnpm deploy:local） 兜底直发：本地构建 → assemble-bundle.sh → scp → ssh activate-release.sh。
#                                   仅用于 CI/GitHub 不可用，或要发未提交的 hotfix。复用与 CI 完全相同的原子激活/健康门/回滚脚本。
#   rollback  （pnpm rollback）     ssh 盒子回滚到上一份（或指定 release）。
#   status    （pnpm deploy:status）CI 最近运行 + 盒子 current 指向 + pm2 状态。
#   logs                            ssh 盒子 pm2 logs。
#   watch                           gh run watch 最近一次 CI run。
#   help                            打印用法。
#
# 通用 flag（可出现在任意位置）：
#   -y, --yes        跳过确认（非交互/脚本化用）。
#   -n, --dry-run    只打印将执行的变更动作（gh workflow run / scp / ssh 激活/回滚），不真正执行。
#
# 连接配置（仅 local/rollback/status/logs 需要 SSH 参数；ci 仅需 gh 已登录）：
#   优先读环境变量；若存在 scripts/.release.env（已 gitignore）则先 source 它。
#   见 scripts/release.env.example。
#     DEPLOY_HOST      盒子地址（必需，SSH 类命令）
#     DEPLOY_USER      SSH 用户（必需，SSH 类命令）
#     DEPLOY_PORT      SSH 端口（默认 22）
#     DEPLOY_IDENTITY  私钥文件路径（可选，默认走 ssh-agent/默认 key）
#     DEPLOY_ROOT      盒子部署根（默认 /opt/deploy-management）
#     DEPLOY_BRANCH    CI 部署分支（默认 main）
#     DEPLOY_WORKFLOW  workflow 文件名（默认 deploy.yml）

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 可选本地连接配置（gitignore；放 SSH host/user 等，避免硬编码进入跟踪源码）。
if [ -f "$REPO_ROOT/scripts/.release.env" ]; then
  # shellcheck disable=SC1091
  . "$REPO_ROOT/scripts/.release.env"
fi

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/deploy-management}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_WORKFLOW="${DEPLOY_WORKFLOW:-deploy.yml}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
ASSUME_YES="${ASSUME_YES:-0}"
DRY_RUN="${DRY_RUN:-0}"

# ---------- 小工具 ----------
die() { echo "ERROR: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "缺少命令 '$1'，请先安装并加入 PATH。"; }

confirm() {
  # DRY_RUN 不做真实变更，无需确认；-y 跳过；否则交互询问。
  [ "$DRY_RUN" = 1 ] && return 0
  [ "$ASSUME_YES" = 1 ] && return 0
  local reply
  printf '%s [y/N] ' "$1" >&2
  read -r reply || return 1
  case "$reply" in
    y | Y | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

# 仅校验 SSH 类命令所需的连接参数；缺失则给出可操作的提示。
require_ssh() {
  need ssh
  [ -n "${DEPLOY_HOST:-}" ] || die "未设置 DEPLOY_HOST。复制 scripts/release.env.example 到 scripts/.release.env 并填写，或 export DEPLOY_HOST=..."
  [ -n "${DEPLOY_USER:-}" ] || die "未设置 DEPLOY_USER（同上）。"
}

ssh_target() { printf '%s@%s' "$DEPLOY_USER" "$DEPLOY_HOST"; }

# 构造 ssh/scp 选项数组（端口、可选私钥）。scp 端口用大写 -P。
# WHY 末尾显式 return 0：末行 `[ test ] && cmd` 在 test 为假（端口=22/无私钥）时返回非0，
# 作为函数最后命令会让函数返回非0，set -e 下直接拖垮调用方（静默退出）。同 set -e 不可逆点那族坑。
ssh_opts() {
  local -n _out="$1"
  _out=()
  [ "$DEPLOY_PORT" != "22" ] && _out+=(-p "$DEPLOY_PORT")
  [ -n "${DEPLOY_IDENTITY:-}" ] && _out+=(-i "$DEPLOY_IDENTITY")
  return 0
}
scp_opts() {
  local -n _out="$1"
  _out=()
  [ "$DEPLOY_PORT" != "22" ] && _out+=(-P "$DEPLOY_PORT")
  [ -n "${DEPLOY_IDENTITY:-}" ] && _out+=(-i "$DEPLOY_IDENTITY")
  return 0
}

# ---------- ci：触发离机构建+部署 ----------
cmd_ci() {
  need gh
  need git
  gh auth status >/dev/null 2>&1 || die "gh 未登录，先运行 gh auth login。"

  # 关键 UX：CI 构建的是 GitHub 上 origin/$DEPLOY_BRANCH 的代码，不是你本地工作区。
  # 本地有未提交改动 / 本地 HEAD 落后或领先远端时必须显式告警，否则会误以为"发了本地改动"。
  git -C "$REPO_ROOT" fetch --quiet origin "$DEPLOY_BRANCH" 2>/dev/null || true
  local local_sha remote_sha dirty
  local_sha="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  remote_sha="$(git -C "$REPO_ROOT" rev-parse "origin/$DEPLOY_BRANCH" 2>/dev/null || echo '')"
  dirty="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null || true)"

  if [ -n "$remote_sha" ]; then
    echo "==> CI 将构建 origin/$DEPLOY_BRANCH @ ${remote_sha:0:12}"
  else
    echo "WARN: 无法解析 origin/$DEPLOY_BRANCH，请确认已 push。"
  fi
  if [ -n "$dirty" ]; then
    echo "WARN: 本地有未提交改动 —— 不会进入 CI 构建（CI 只构建已 push 到远端的提交）。"
  fi
  if [ -n "$remote_sha" ] && [ "$local_sha" != "$remote_sha" ]; then
    echo "WARN: 本地 HEAD(${local_sha:0:12}) != origin/$DEPLOY_BRANCH(${remote_sha:0:12})；CI 用远端那份。如要发本地改动，先 git push。"
  fi

  confirm "确认触发 CI 离机构建+部署（$DEPLOY_BRANCH）？" || { echo "已取消。"; return 0; }

  local before after rid i
  before="$(gh run list --workflow "$DEPLOY_WORKFLOW" -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo '')"

  if [ "$DRY_RUN" = 1 ]; then
    echo "[dry-run] gh workflow run $DEPLOY_WORKFLOW --ref $DEPLOY_BRANCH"
    return 0
  fi
  gh workflow run "$DEPLOY_WORKFLOW" --ref "$DEPLOY_BRANCH"

  # gh workflow run 不返回 run id；轮询直到 list 顶部出现一个新 id（避免 watch 错上一次的 run）。
  echo "==> 已触发，等待新 run 出现..."
  for i in $(seq 1 20); do
    sleep 3
    after="$(gh run list --workflow "$DEPLOY_WORKFLOW" -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo '')"
    if [ -n "$after" ] && [ "$after" != "$before" ]; then
      rid="$after"
      break
    fi
  done
  if [ -z "${rid:-}" ]; then
    echo "WARN: 未捕获到新 run（可能尚未排队）。用 'pnpm deploy:watch' 或 gh run list 查看。"
    gh run list --workflow "$DEPLOY_WORKFLOW" -L 3 || true
    return 0
  fi
  echo "==> watch run $rid（Ctrl-C 仅停止本地 watch，不影响 CI）"
  gh run watch "$rid" --exit-status || die "CI run 失败（run $rid）。盒子上 CI 会自动健康门+回滚，请用 'pnpm deploy:status' 复核。"
  echo "==> CI 发布成功。"
}

# ---------- local：兜底本地构建直发（复用 CI 同套激活/健康门/回滚）----------
cmd_local() {
  need pnpm
  need tar
  need scp
  require_ssh

  # dry-run 在真正构建前短路：打印完整计划即返回，避免为"看一眼"而触发整轮（Windows 上偏 flaky 的）构建。
  if [ "$DRY_RUN" = 1 ]; then
    local _tgt
    _tgt="$(ssh_target)"
    echo "[dry-run] cd $REPO_ROOT && pnpm install --frozen-lockfile && pnpm -r build"
    echo "[dry-run] bash scripts/assemble-bundle.sh <stage>（复用 CI 同源；不打包 .env）"
    echo "[dry-run] tar 打包 + scp 到 $_tgt:$DEPLOY_ROOT/releases/incoming/"
    echo "[dry-run] ssh $_tgt: untar -> activate-release.sh（原子切换 + 健康门 + 失败自动回滚）"
    return 0
  fi

  echo "WARN: [兜底] 本地构建直发。常规发布请用 'pnpm deploy'（触发 CI 离机构建）。"
  echo "==> 本地构建 shared/api/web（Windows 上 next build 偶发 worker crash，失败可重试）"
  ( cd "$REPO_ROOT" && pnpm install --frozen-lockfile && pnpm -r build )

  local name stage tarball
  name="local-$(date +%Y%m%d%H%M%S)-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
  stage="$REPO_ROOT/.codex-tmp/release-bundles/$name"
  tarball="$REPO_ROOT/.codex-tmp/release-bundles/$name.tar.gz"
  rm -rf "$stage"
  mkdir -p "$stage"

  echo "==> 组装 bundle（复用 assemble-bundle.sh，与 CI 同源；不打包 .env，密钥用盒子 shared/.env）"
  bash "$REPO_ROOT/scripts/assemble-bundle.sh" "$stage"
  tar -czf "$tarball" -C "$stage" .

  local tgt sopts copts
  tgt="$(ssh_target)"
  ssh_opts sopts
  scp_opts copts

  confirm "确认把本地构建产物直发到 $tgt:$DEPLOY_ROOT？" || { echo "已取消（bundle 仍在 $tarball）。"; return 0; }

  echo "==> scp 到盒子 incoming"
  ssh "${sopts[@]}" "$tgt" "mkdir -p '$DEPLOY_ROOT/releases/incoming'"
  scp "${copts[@]}" "$tarball" "$tgt:$DEPLOY_ROOT/releases/incoming/$name.tar.gz"

  # 远端激活：untar -> chmod -> activate-release.sh。镜像 .github/workflows/deploy.yml 的激活块，
  # 真正的原子切换/健康门/自动回滚逻辑全在 activate-release.sh 内（两条路径同源）。
  echo "==> ssh 激活（untar -> activate-release.sh）"
  ssh "${sopts[@]}" "$tgt" "bash -s" <<REMOTE
set -euo pipefail
DEPLOY_ROOT='$DEPLOY_ROOT'
NAME='$name'
export DEPLOY_ROOT
REL="\$DEPLOY_ROOT/releases/\$NAME"
mkdir -p "\$REL"
tar -xzf "\$DEPLOY_ROOT/releases/incoming/\$NAME.tar.gz" -C "\$REL"
find "\$REL/scripts" -name '*.sh' -exec chmod +x {} + 2>/dev/null || true
bash "\$REL/scripts/activate-release.sh" "\$REL"
rm -f "\$DEPLOY_ROOT/releases/incoming/\$NAME.tar.gz"
REMOTE
  echo "==> 兜底发布完成: $name"
}

# ---------- rollback：ssh 盒子回滚 ----------
cmd_rollback() {
  require_ssh
  local target_arg="${1:-}"
  local tgt sopts
  tgt="$(ssh_target)"
  ssh_opts sopts

  if [ "$DRY_RUN" = 1 ]; then
    echo "[dry-run] ssh $tgt rollback.sh ${target_arg:-（上一份）}"
    return 0
  fi
  confirm "确认在盒子上回滚 ${target_arg:-到上一份 release}？" || { echo "已取消。"; return 0; }

  # 调用盒子上 current 自带的 rollback.sh（每份 release 都含同一份脚本）；不带参数=回滚到上一份。
  if [ -n "$target_arg" ]; then
    ssh "${sopts[@]}" "$tgt" "DEPLOY_ROOT='$DEPLOY_ROOT' bash '$DEPLOY_ROOT/current/scripts/rollback.sh' '$target_arg'"
  else
    ssh "${sopts[@]}" "$tgt" "DEPLOY_ROOT='$DEPLOY_ROOT' bash '$DEPLOY_ROOT/current/scripts/rollback.sh'"
  fi
}

# ---------- status：CI + 盒子 ----------
cmd_status() {
  echo "== CI 最近运行 =="
  if command -v gh >/dev/null 2>&1; then
    gh run list --workflow "$DEPLOY_WORKFLOW" -L 5 2>/dev/null || echo "(无法读取 CI 运行列表)"
  else
    echo "(未安装 gh)"
  fi
  echo ""
  echo "== 盒子状态 =="
  if [ -n "${DEPLOY_HOST:-}" ] && [ -n "${DEPLOY_USER:-}" ]; then
    local tgt sopts
    tgt="$(ssh_target)"
    ssh_opts sopts
    ssh "${sopts[@]}" "$tgt" "echo 'current ->' \$(readlink -f '$DEPLOY_ROOT/current' 2>/dev/null || echo '(无)'); pm2 status 2>/dev/null || echo '(pm2 不可用)'" \
      || echo "(ssh 失败，检查 DEPLOY_HOST/DEPLOY_USER/网络)"
  else
    echo "(未配置 DEPLOY_HOST/DEPLOY_USER，跳过盒子状态；见 scripts/release.env.example)"
  fi
}

# ---------- logs：盒子 pm2 日志 ----------
cmd_logs() {
  require_ssh
  local n="${1:-100}"
  local tgt sopts
  tgt="$(ssh_target)"
  ssh_opts sopts
  ssh "${sopts[@]}" "$tgt" "pm2 logs --lines '$n' --nostream"
}

# ---------- watch：盯最近一次 CI run ----------
cmd_watch() {
  need gh
  local rid
  rid="$(gh run list --workflow "$DEPLOY_WORKFLOW" -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo '')"
  [ -n "$rid" ] || die "没有可 watch 的 run。"
  gh run watch "$rid" --exit-status
}

usage() {
  cat <<'USAGE'
本地一键发版 —— scripts/release.sh <子命令> [flag]

子命令：
  ci         触发 GitHub Actions 离机构建+部署并 watch（默认；= pnpm deploy）
  local      兜底：本地构建直发，复用 CI 同套原子激活/健康门/回滚（= pnpm deploy:local）
  rollback   盒子回滚到上一份/指定 release（= pnpm rollback [release_dir]）
  status     CI 最近运行 + 盒子 current/pm2（= pnpm deploy:status）
  logs       盒子 pm2 日志（= pnpm deploy:logs [行数]）
  watch      盯最近一次 CI run（= pnpm deploy:watch）
  help       本帮助

通用 flag（任意位置）：
  -y, --yes       跳过确认
  -n, --dry-run   只打印将执行的变更动作，不真正执行

连接配置：复制 scripts/release.env.example -> scripts/.release.env 并填写（已 gitignore）。
常规发布用 'pnpm deploy'（走 CI，盒子不构建）；'pnpm deploy:local' 仅作兜底。
USAGE
}

# ---------- 参数解析：通用 flag 可出现在任意位置，首个非 flag 作子命令 ----------
CMD=""
ARGS=()
for arg in "$@"; do
  case "$arg" in
    -y | --yes) ASSUME_YES=1 ;;
    -n | --dry-run) DRY_RUN=1 ;;
    -h | --help) CMD="help" ;;
    -*) die "未知 flag: $arg（见 help）" ;;
    *)
      if [ -z "$CMD" ]; then CMD="$arg"; else ARGS+=("$arg"); fi
      ;;
  esac
done
CMD="${CMD:-ci}"

case "$CMD" in
  ci) cmd_ci ;;
  local) cmd_local ;;
  rollback) cmd_rollback "${ARGS[@]}" ;;
  status) cmd_status ;;
  logs) cmd_logs "${ARGS[@]}" ;;
  watch) cmd_watch ;;
  help | "") usage ;;
  *) die "未知子命令: $CMD（见 help）" ;;
esac
