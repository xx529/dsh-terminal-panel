#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy/publish-and-install.sh — dsh-terminal-panel 一键「发布 + 安装」
#
#  阶段 A [push]    ：把当前仓库以 fast-forward 方式推送到 GitHub（绝不 force）
#  阶段 B [install] ：把插件以 link: 依赖安装进本机 DSH profile，并选入 bundle
#
# 设计原则：可重复执行（幂等）、失败可回滚（--rollback）、先演算再动手（--dry-run）。
#
# 平台取证（2026-10-26，本机 macOS，DSH 0.1.2-alpha.2 / pnpm 11.22.0 / node v22.22.2）：
#   [FACT] `dsh plugin --profile <name> [pnpm args...]` 存在，语义是「把剩余参数转发给
#          profile 目录里的 pnpm」（实测 `dsh plugin --profile desktop --help` 输出 pnpm 的
#          usage 文本）。它**没有** bundle 选择子命令，因此选入 `dsh.profile.bundles`
#          这一步只能由本脚本用 node 直接改 profile package.json 完成。
#   [FACT] profile 结构：~/.dsh/profiles/<name>/package.json 的 dependencies +
#          dsh.profile.bundles[]，同目录有 node_modules/ 与 pnpm-lock.yaml。
#   [FACT] `command -v dsh` / `command -v pnpm` 均存在（nvm 前缀）；本插件无任何运行时
#          依赖，link: 指向本地目录，不需要 registry，因此离线安装可行。
#   [ASSUMPTION] 「手工写 link 依赖 + pnpm install」这条兼容路径见 docs/install.md §1.2，
#          未在真机实测；如果可用性存疑，优先用 plugin_manager 的 install_bundle。
#          本脚本在没有 dsh CLI 时走该路径，且强制要求 --yes 才动手。
#
# 安全边界：不 sudo、不改任何全局配置、不 force push、不 rm -rf、所有写入前校验绝对路径。
# ---------------------------------------------------------------------------
set -euo pipefail

# --- 常量与默认值 ----------------------------------------------------------
readonly SCRIPT_PATH="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd -P)"
readonly SCRIPT_DIR
DEFAULT_REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly DEFAULT_REPO_ROOT

REPO_ROOT="${REPO_ROOT:-$DEFAULT_REPO_ROOT}"
REPO_URL="https://github.com/xx529/dsh-terminal-panel.git"
BRANCH="main"
PROFILE="desktop"
PLUGIN_PKG="dsh-terminal-panel"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
TIMEOUT_SECS=120

SKIP_TESTS=0
DRY_RUN=0
ASSUME_YES=0
DO_ROLLBACK=0
DO_PUSH=1
DO_INSTALL=1

readonly EXIT_OK=0
readonly EXIT_USAGE=2
readonly EXIT_PREFLIGHT=3
readonly EXIT_PUSH=4
readonly EXIT_INSTALL=5
readonly EXIT_TIMEOUT=6

# --- 日志（tty 才上色） ----------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'
else
  C_RESET=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""
fi

log()      { printf '%s[%s]%s %s\n' "$C_CYAN" "$1" "$C_RESET" "$2"; }
log_pre()  { printf '%s[preflight]%s %s\n' "$C_BLUE" "$C_RESET" "$1"; }
log_ver()  { printf '%s[verify]%s %s\n'    "$C_BLUE" "$C_RESET" "$1"; }
log_push() { printf '%s[push]%s %s\n'      "$C_CYAN" "$C_RESET" "$1"; }
log_inst() { printf '%s[install]%s %s\n'   "$C_CYAN" "$C_RESET" "$1"; }
log_done() { printf '%s[done]%s %s\n'      "$C_GREEN" "$C_RESET" "$1"; }
log_warn() { printf '%s[warn]%s %s\n'      "$C_YELLOW" "$C_RESET" "$1" >&2; }
log_plan() { printf '%s[dry-run]%s would: %s\n' "$C_DIM" "$C_RESET" "$1"; }

die() { # die <message> [exit-code] [next-step]
  local msg="$1" code="${2:-$EXIT_PREFLIGHT}" hint="${3:-}"
  printf '%s[error]%s %s\n' "$C_RED" "$C_RESET" "$msg" >&2
  [[ -n "$hint" ]] && printf '%s        next: %s%s\n' "$C_RED" "$hint" "$C_RESET" >&2
  exit "$code"
}

# 执行（dry-run 时只打印，不执行）
run() {
  if (( DRY_RUN )); then
    log_plan "$*"
    return 0
  fi
  "$@"
}

# 超时命令检测：GNU timeout > gtimeout(coreutils) > perl alarm > 无保护
_timeout_cmd() { # _timeout_cmd <seconds> <command...>：直接执行，超时以 124 返回
  local secs="${1:?}"; shift
  if have_cmd timeout; then
    timeout "$secs" "$@"
  elif have_cmd gtimeout; then
    gtimeout "$secs" "$@"
  elif have_cmd perl; then
    perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
  else
    "$@"
  fi
}

# 在超时保护下执行命令（dry-run 只打印）；超时统一返回 124
run_with_timeout() { # run_with_timeout <seconds> <label> <command...>
  local secs="${1:?run_with_timeout: seconds required}" label="${2:?run_with_timeout: label required}"
  shift 2
  if (( DRY_RUN )); then
    log_plan "timeout ${secs}s: $*"
    return 0
  fi
  local rc=0
  _timeout_cmd "$secs" "$@" || rc=$?
  if [[ $rc -eq 124 || $rc -eq 142 ]]; then
    log_warn "${label} 超时（${secs}s），已终止（如需放宽：--timeout <秒>）"
    return 124
  fi
  return $rc
}

# 同 run_with_timeout，但在指定目录执行
run_with_timeout_in() { # run_with_timeout_in <dir> <seconds> <label> <command...>
  local dir="${1:?run_with_timeout_in: dir required}" secs="${2:?}" label="${3:?}"
  shift 3
  if (( DRY_RUN )); then
    log_plan "(cd ${dir} && timeout ${secs}s: $*)"
    return 0
  fi
  local rc=0
  ( cd "$dir" && _timeout_cmd "$secs" "$@" ) || rc=$?
  if [[ $rc -eq 124 || $rc -eq 142 ]]; then
    log_warn "${label} 超时（${secs}s），已终止（如需放宽：--timeout <秒>）"
    return 124
  fi
  return $rc
}

usage() {
  cat <<'EOF'
dsh-terminal-panel — 一键发布 + 安装（publish & install）

用法:
  deploy/publish-and-install.sh [选项]

选项:
  --repo <url>      推送到哪个远端仓库（默认 https://github.com/xx529/dsh-terminal-panel.git）
  --branch <name>   要推送的分支（默认 main；当前分支不是它时直接报错，脚本不会自动改分支名）
  --profile <name>  安装到哪个 DSH profile（默认 desktop，即 ~/.dsh/profiles/desktop）
  --timeout <秒>    pnpm / dsh plugin 调用的超时秒数（默认 120，范围 10-3600；超时 exit 6）
  --skip-tests      跳过 `npm run verify`（收窄门禁，仅限已确认 CI 跑过时使用）
  --dry-run         只打印将执行的命令与变更摘要：不推送、不安装、不改任何文件
  --yes             允许走「兼容回退路径」（无 dsh CLI / CLI 安装失败时的 profile 手工改写）
  --rollback        回滚最近一次安装：恢复 profile package.json（+ pnpm-lock.yaml）备份、
                    从 dsh.profile.bundles 移除插件名、重新安装以清理 node_modules（幂等）
  --no-push         只安装，不推送
  --no-install      只推送，不安装
  -h, --help        显示本帮助并退出

环境变量:
  DSH_HOME          DSH 主目录（默认 ~/.dsh）
  REPO_ROOT         仓库根（默认 = 本脚本所在目录的上一级）

示例:
  ./deploy/publish-and-install.sh --dry-run                 # 先看计划（安全，不改任何东西）
  ./deploy/publish-and-install.sh --dry-run --profile desktop
  ./deploy/publish-and-install.sh                            # 推送到 origin/main 并安装到 desktop profile
  ./deploy/publish-and-install.sh --no-push                  # 只装到本机 profile
  ./deploy/publish-and-install.sh --rollback                 # 撤销最近一次安装
  ./deploy/publish-and-install.sh --profile web --no-push    # 装到 web profile

风险与边界:
  * 推送阶段绝不使用 --force；远端有并发提交（非 fast-forward）时直接失败，转人工处理。
  * 安装阶段会写 profile 的 package.json（先备份为 package.json.bak.<UTC时间戳>）。
    「profile 手工改写 + pnpm install」兼容路径在 docs/install.md §1.2 标为 ASSUMPTION
    （未真机实测）；可用时优先用官方 plugin_manager 的 install_bundle，或本脚本探测到的
    `dsh plugin --profile <name> ...` 转发路径。
  * 安装后需要重启 DSH 桌面版（替换已安装代码不免重启）+ 刷新页面。
  * pnpm / dsh plugin 调用有超时保护（默认 120s，可用 --timeout 放宽；超时 exit 6）。
    本机无 GNU timeout 时用 perl alarm 终止子进程，shell 可能打印一行
    「Alarm clock: 14」——属正常现象，不是脚本错误。
  * 不 sudo、不改全局配置、不 rm -rf。

退出码:
  0 成功   2 用法错误   3 前置检查失败（脏树/分支/远端）
  4 推送失败（含非 fast-forward）   5 安装/回滚失败
  6 安装/回滚超时（pnpm / dsh plugin 超过 --timeout 秒；可用 --timeout 覆盖）
EOF
}

# --- 参数解析 --------------------------------------------------------------
while (( $# )); do
  case "$1" in
    --repo)       [[ $# -ge 2 ]] || die "--repo 需要一个值" "$EXIT_USAGE"; REPO_URL="$2"; shift 2 ;;
    --repo=*)     REPO_URL="${1#--repo=}"; shift ;;
    --branch)     [[ $# -ge 2 ]] || die "--branch 需要一个值" "$EXIT_USAGE"; BRANCH="$2"; shift 2 ;;
    --branch=*)   BRANCH="${1#--branch=}"; shift ;;
    --profile)    [[ $# -ge 2 ]] || die "--profile 需要一个值" "$EXIT_USAGE"; PROFILE="$2"; shift 2 ;;
    --profile=*)  PROFILE="${1#--profile=}"; shift ;;
    --timeout)    [[ $# -ge 2 ]] || die "--timeout 需要一个值（秒）" "$EXIT_USAGE"; TIMEOUT_SECS="$2"; shift 2 ;;
    --timeout=*)  TIMEOUT_SECS="${1#--timeout=}"; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --yes)        ASSUME_YES=1; shift ;;
    --rollback)   DO_ROLLBACK=1; shift ;;
    --no-push)    DO_PUSH=0; shift ;;
    --no-install) DO_INSTALL=0; shift ;;
    -h|--help)    usage; exit "$EXIT_OK" ;;
    *)            die "未知参数: $1（用 --help 查看用法）" "$EXIT_USAGE" ;;
  esac
done

# 参数合法性
[[ -n "$REPO_URL" ]] || die "--repo 不能为空" "$EXIT_USAGE"
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "--branch 非法: $BRANCH" "$EXIT_USAGE"
[[ "$PROFILE" =~ ^[A-Za-z0-9._-]+$ ]] || die "--profile 非法: $PROFILE" "$EXIT_USAGE"
[[ "$TIMEOUT_SECS" =~ ^[0-9]+$ ]] || die "--timeout 必须是整数秒: $TIMEOUT_SECS" "$EXIT_USAGE"
(( TIMEOUT_SECS >= 10 && TIMEOUT_SECS <= 3600 )) || die "--timeout 必须在 10..3600 秒之间: $TIMEOUT_SECS" "$EXIT_USAGE"
[[ "$REPO_ROOT" == /* ]] || die "REPO_ROOT 必须是绝对路径: $REPO_ROOT" "$EXIT_USAGE"

if (( DO_ROLLBACK )); then
  DO_PUSH=0
fi
if (( ! DO_PUSH && ! DO_INSTALL && ! DO_ROLLBACK )); then
  die "--no-push 与 --no-install 不能同时使用（没有可执行阶段）" "$EXIT_USAGE"
fi

# --- 通用工具 --------------------------------------------------------------

# 校验一个绝对路径确实位于给定目录之下（用于覆盖/恢复前的安全闸门）
assert_under_dir() { # assert_under_dir <dir> <path> <label>
  local dir="${1:?}" path="${2:?}" label="${3:?}"
  [[ "$path" == "$dir"/* ]] || die "$label 不在 $dir 之下，拒绝继续: $path" "$EXIT_PREFLIGHT"
  [[ "$path" != *"/../"* ]] || die "$label 含 ../，拒绝继续: $path" "$EXIT_PREFLIGHT"
}

# 校验覆盖目标：必须是目标目录直下、basename 精确匹配的文件
assert_overwrite_target() { # assert_overwrite_target <dir> <path> <basename>
  local dir="${1:?}" path="${2:?}" want="${3:?}"
  assert_under_dir "$dir" "$path" "写入目标"
  [[ "$(dirname -- "$path")" == "$dir" ]] || die "写入目标必须在 $dir 直下: $path" "$EXIT_PREFLIGHT"
  [[ "$(basename -- "$path")" == "$want" ]] || die "写入目标文件名必须是 $want: $path" "$EXIT_PREFLIGHT"
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# --- profile 读写（node -e，避免依赖 jq） ----------------------------------

profile_dir() { printf '%s/profiles/%s' "${DSH_HOME:?DSH_HOME 未设置}" "${PROFILE:?PROFILE 未设置}"; }

# 打印 4 行（每行一个字段，避免 IFS 折叠空字段）:
#   1=hasDep(0/1)  2=depValue  3=hasBundle(0/1)  4=bundleCount
profile_probe() { # profile_probe <dir>
  local dir="${1:?}"
  PROFILE_DIR_ENV="$dir" PLUGIN_NAME_ENV="$PLUGIN_PKG" node -e '
const fs = require("fs"), path = require("path");
const dir = process.env.PROFILE_DIR_ENV, name = process.env.PLUGIN_NAME_ENV;
const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
const deps = pkg.dependencies || {};
const bundles = (((pkg.dsh || {}).profile || {}).bundles) || [];
const has = Object.prototype.hasOwnProperty.call(deps, name);
process.stdout.write([
  has ? "1" : "0",
  has ? String(deps[name]) : "",
  Array.isArray(bundles) && bundles.includes(name) ? "1" : "0",
  Array.isArray(bundles) ? String(bundles.length) : "0",
].join("\n") + "\n");
'
}

# 写入 link 依赖 + 选入 bundles（幂等；保持 2 空格缩进；tmp+rename 原子写入）
profile_patch_add() { # profile_patch_add <dir> <link-spec>
  local dir="${1:?}" spec="${2:?}"
  PROFILE_DIR_ENV="$dir" PLUGIN_NAME_ENV="$PLUGIN_PKG" LINK_SPEC_ENV="$spec" node -e '
const fs = require("fs"), path = require("path");
const dir = process.env.PROFILE_DIR_ENV, name = process.env.PLUGIN_NAME_ENV, spec = process.env.LINK_SPEC_ENV;
const file = path.join(dir, "package.json");
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
const changes = [];
pkg.dependencies = pkg.dependencies || {};
if (pkg.dependencies[name] !== spec) { pkg.dependencies[name] = spec; changes.push("dependencies." + name + "=" + spec); }
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
if (!bundles.includes(name)) { bundles.push(name); pkg.dsh.profile.bundles = bundles; changes.push("dsh.profile.bundles+=" + name); }
if (changes.length) {
  const tmp = file + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(pkg, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}
process.stdout.write(JSON.stringify({ changes, bundleCount: bundles.length }));
'
}

# 移除 link 依赖 + 从 bundles 摘除（幂等）
profile_patch_remove() { # profile_patch_remove <dir>
  local dir="${1:?}"
  PROFILE_DIR_ENV="$dir" PLUGIN_NAME_ENV="$PLUGIN_PKG" node -e '
const fs = require("fs"), path = require("path");
const dir = process.env.PROFILE_DIR_ENV, name = process.env.PLUGIN_NAME_ENV;
const file = path.join(dir, "package.json");
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
const changes = [];
if (pkg.dependencies && Object.prototype.hasOwnProperty.call(pkg.dependencies, name)) {
  delete pkg.dependencies[name]; changes.push("dependencies-" + name);
}
const bundles = (((pkg.dsh || {}).profile || {}).bundles);
if (Array.isArray(bundles)) {
  const next = bundles.filter((x) => x !== name);
  if (next.length !== bundles.length) { pkg.dsh.profile.bundles = next; changes.push("dsh.profile.bundles-=" + name); }
}
if (changes.length) {
  const tmp = file + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(pkg, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}
process.stdout.write(JSON.stringify({ changes }));
'
}

# 安装后核对：dep 必须是 link: 且 bundle 已选入 → 打印 ok/bad
profile_verify_installed() { # profile_verify_installed <dir>
  local dir="${1:?}"
  PROFILE_DIR_ENV="$dir" PLUGIN_NAME_ENV="$PLUGIN_PKG" node -e '
const fs = require("fs"), path = require("path");
const dir = process.env.PROFILE_DIR_ENV, name = process.env.PLUGIN_NAME_ENV;
const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
const deps = pkg.dependencies || {};
const bundles = (((pkg.dsh || {}).profile || {}).bundles) || [];
const dep = deps[name];
const ok = typeof dep === "string" && dep.startsWith("link:") && Array.isArray(bundles) && bundles.includes(name);
process.stdout.write(ok ? "ok" : "bad");
'
}

# pnpm 运行器：优先进 dsh CLI 转发（官方入口），否则直接 pnpm
resolve_pnpm_runner() {
  if have_cmd dsh && dsh plugin --profile "$PROFILE" --version >/dev/null 2>&1; then
    printf 'dsh'
  elif have_cmd pnpm; then
    printf 'pnpm'
  else
    printf ''
  fi
}

# pnpm 安装（offline 优先，失败回退联网）；dry-run 只打印
pnpm_install_profile() { # pnpm_install_profile <profile-dir> <runner> <allow-network 0|1>
  local dir="${1:?}" runner="${2:?}" allow_net="${3:-0}"
  if (( DRY_RUN )); then
    if [[ "$runner" == "dsh" ]]; then
      log_plan "dsh plugin --profile $PROFILE install --offline   # cwd=$dir"
      (( allow_net )) && log_plan "（offline 失败时回退）dsh plugin --profile $PROFILE install"
    else
      log_plan "(cd $dir && timeout ${TIMEOUT_SECS}s: pnpm install --offline)"
      (( allow_net )) && log_plan "（offline 失败时回退）(cd $dir && pnpm install)"
    fi
    return 0
  fi

  local rc=0
  if [[ "$runner" == "dsh" ]]; then
    run_with_timeout "$TIMEOUT_SECS" "offline 安装（dsh plugin install）" \
      dsh plugin --profile "$PROFILE" install --offline || rc=$?
  else
    run_with_timeout_in "$dir" "$TIMEOUT_SECS" "offline 安装（pnpm install）" \
      pnpm install --offline || rc=$?
  fi
  if (( rc == 0 )); then return 0; fi
  if (( rc == 124 )); then
    die "安装超时（${TIMEOUT_SECS}s）" "$EXIT_TIMEOUT" \
      "放宽超时重试：--timeout 300；或先用 plugin_manager 的 install_bundle"
  fi

  (( allow_net )) || die "offline 安装失败（profile=${PROFILE}）" "$EXIT_INSTALL" \
    "确认 registry 可达后重跑；或加 --yes 允许回退联网；或改用 plugin_manager install_bundle"
  log_warn "offline 安装失败，回退到联网 pnpm install（可能需要网络与 registry 访问）"
  rc=0
  if [[ "$runner" == "dsh" ]]; then
    run_with_timeout "$TIMEOUT_SECS" "联网安装（dsh plugin install）" \
      dsh plugin --profile "$PROFILE" install || rc=$?
  else
    run_with_timeout_in "$dir" "$TIMEOUT_SECS" "联网安装（pnpm install）" \
      pnpm install || rc=$?
  fi
  if (( rc == 124 )); then
    die "联网安装超时（${TIMEOUT_SECS}s）" "$EXIT_TIMEOUT" \
      "放宽超时重试：--timeout 300；确认网络/registry 后重试"
  fi
  return $rc
}

# --- 阶段 A：推送 ----------------------------------------------------------

push_stage() {
  log_push "repo=$REPO_ROOT branch=$BRANCH remote=$REPO_URL"
  [[ -d "$REPO_ROOT" ]] || die "仓库根不存在: $REPO_ROOT" "$EXIT_PREFLIGHT"
  have_cmd git || die "未找到 git" "$EXIT_PREFLIGHT"

  local toplevel=""
  toplevel="$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null)" \
    || die "$REPO_ROOT 不是 git 仓库" "$EXIT_PREFLIGHT" "在仓库根执行 git init / 检查 REPO_ROOT"
  [[ "$toplevel" == "$REPO_ROOT" ]] || die "脚本必须位于仓库根的 deploy/ 下（toplevel=${toplevel}）" "$EXIT_PREFLIGHT"

  # 分支必须是期望分支：脚本不自动改名/切分支
  local cur_branch=""
  cur_branch="$(git -C "$REPO_ROOT" branch --show-current)"
  [[ -n "$cur_branch" ]] || die "当前处于 detached HEAD，拒绝推送" "$EXIT_PREFLIGHT" "先 git switch $BRANCH"
  [[ "$cur_branch" == "$BRANCH" ]] || die "当前分支是 '$cur_branch'，不是 '$BRANCH'" "$EXIT_PREFLIGHT" \
    "手动切换：git switch ${BRANCH}（或用 --branch ${cur_branch}）"

  # 工作树必须干净（含未跟踪文件：脏树意味着待提交状态不确定）
  local dirty=""
  dirty="$(git -C "$REPO_ROOT" status --porcelain -uall)"
  if [[ -n "$dirty" ]]; then
    printf '%s\n' "$dirty" | sed 's/^/    /' >&2
    die "工作树不干净，拒绝推送（脚本绝不推未提交状态）" "$EXIT_PREFLIGHT" \
      "先提交或 stash；推送只允许发生在 clean HEAD 上"
  fi

  local local_sha=""
  local_sha="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  log_push "local HEAD = $local_sha"

  # 门禁：verify（只读，不改仓库文件）
  if (( SKIP_TESTS )); then
    log_ver "跳过 npm run verify（--skip-tests）"
  elif (( DRY_RUN )); then
    log_ver "dry-run：不执行 npm run verify（真实运行要求 exit 0 才继续）"
    log_plan "(cd $REPO_ROOT && npm run --silent verify)"
  else
    log_ver "运行 npm run verify ..."
    ( cd "$REPO_ROOT" && npm run --silent verify ) \
      || die "npm run verify 失败，拒绝推送" "$EXIT_PREFLIGHT" "先修复：cd $REPO_ROOT && npm run verify"
    log_ver "verify 通过（exit 0）"
  fi

  # 远端：不存在则添加；已存在但 URL 不符则报错（不静默改写）
  local origin_url="" origin_ready=0
  if origin_url="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null)"; then
    if [[ "$origin_url" != "$REPO_URL" ]]; then
      die "origin 已存在但 URL 不匹配: ${origin_url}（期望 ${REPO_URL}）" "$EXIT_PREFLIGHT" \
        "人工确认后执行：git remote set-url origin $REPO_URL"
    fi
    log_push "origin 已存在且匹配: $origin_url"
    origin_ready=1
  else
    log_push "origin 不存在，准备添加: $REPO_URL"
    run git -C "$REPO_ROOT" remote add origin "$REPO_URL"
    (( DRY_RUN )) || origin_ready=1
  fi

  # fast-forward 检查（绝不 force）
  local remote_sha=""
  if (( origin_ready )); then
    remote_sha="$(git -C "$REPO_ROOT" ls-remote --heads origin "refs/heads/$BRANCH" | awk '{print $1}')"
  else
    log_warn "dry-run：origin 尚未真实添加，按「首次推送」演算"
  fi

  if [[ -z "$remote_sha" ]]; then
    log_push "远端没有分支 ${BRANCH}（将首次推送）"
  elif [[ "$remote_sha" == "$local_sha" ]]; then
    log_push "远端已是最新（${remote_sha}），跳过推送"
    log_done "推送阶段无需操作"
    return 0
  else
    log_push "远端 $BRANCH = ${remote_sha}（与本地不同），检查 fast-forward ..."
    run git -C "$REPO_ROOT" fetch --quiet origin "$BRANCH"
    local have_remote_obj=0
    if git -C "$REPO_ROOT" cat-file -e "${remote_sha}^{commit}" 2>/dev/null; then
      have_remote_obj=1
    fi
    if (( have_remote_obj )); then
      if git -C "$REPO_ROOT" merge-base --is-ancestor "$remote_sha" "$local_sha"; then
        log_push "可 fast-forward"
      elif git -C "$REPO_ROOT" merge-base --is-ancestor "$local_sha" "$remote_sha"; then
        die "本地落后于远端（behind），拒绝推送" "$EXIT_PUSH" "先 git pull --ff-only origin $BRANCH"
      else
        die "本地与远端已分叉（diverged），拒绝推送（脚本绝不 force）" "$EXIT_PUSH" \
          "人工对齐历史后重试；或改用 --no-push 只安装"
      fi
    elif (( DRY_RUN )); then
      log_warn "dry-run：远端对象不在本地（未 fetch），无法验算 fast-forward；真实运行会 fetch 后判定"
    else
      die "fetch 后仍无法解析远端 sha: $remote_sha" "$EXIT_PUSH" "检查网络/权限后重试"
    fi
  fi

  # 推送（显式 refspec，绝无 --force）
  run git -C "$REPO_ROOT" push origin "refs/heads/$BRANCH:refs/heads/$BRANCH"
  local new_remote=""
  if (( DRY_RUN )); then
    new_remote="<推送后应为 $local_sha>"
  else
    new_remote="$(git -C "$REPO_ROOT" ls-remote --heads origin "refs/heads/$BRANCH" | awk '{print $1}')"
    [[ "$new_remote" == "$local_sha" ]] \
      || die "推送后远端 sha ($new_remote) 与本地 HEAD ($local_sha) 不一致" "$EXIT_PUSH"
  fi
  log_push "local $local_sha → origin/$BRANCH $new_remote"
  log_done "推送阶段完成"
}

# --- 阶段 B：安装 ----------------------------------------------------------

print_install_next_steps() {
  log_inst "后续步骤（必须人工执行）："
  printf '    1) 重启 DeepSeek Harness 桌面版（替换已安装代码不免重启）\n'
  printf '    2) 刷新页面，已开始的会话头部应出现「终端」tab（blank 会话不显示）\n'
  printf '    3) 验证 RPC（端口以 DSH 实际监听为准）：\n'
  printf '         curl -sS -X POST -H "content-type: application/json" \\\n'
  printf '           -b "<你的会话 cookie>" \\\n'
  printf '           --data %s \\\n' "'{\"reqId\":\"hello-1\",\"method\":\"panel.hello\",\"params\":{}}'"
  printf '           http://127.0.0.1:<DSH端口>/terminal-panel/rpc\n'
  printf '    4) 排查：dsh --profile %s --dump-config | grep -A3 %s\n' "$PROFILE" "$PLUGIN_PKG"
  printf '    5) 撤销安装：./deploy/publish-and-install.sh --rollback --profile %s\n' "$PROFILE"
}

install_stage() {
  local dir
  dir="$(profile_dir)"
  local pkg_file="$dir/package.json"
  log_inst "profile=$PROFILE dir=$dir"

  [[ -d "$dir" ]] || die "profile 目录不存在: $dir" "$EXIT_INSTALL" \
    "可用 profile：$(ls -1 "${DSH_HOME:?}/profiles" 2>/dev/null | tr '\n' ' ')"
  [[ -f "$pkg_file" ]] || die "profile 缺少 package.json: $pkg_file" "$EXIT_INSTALL"

  local repo_abs=""
  repo_abs="$(cd -- "$REPO_ROOT" && pwd -P)"
  local link_spec="link:$repo_abs"

  # 探测 dsh CLI（转发 pnpm）
  local runner=""
  runner="$(resolve_pnpm_runner)"
  if [[ "$runner" == "dsh" ]]; then
    log_inst "pnpm 运行器: dsh plugin --profile $PROFILE <pnpm 参数>（官方 CLI 转发）"
  elif [[ "$runner" == "pnpm" ]]; then
    log_inst "pnpm 运行器: pnpm（未探测到 dsh CLI 转发）"
  else
    log_inst "未探测到 dsh CLI 与 pnpm（真实运行会失败；--dry-run 继续打印计划）"
  fi

  # 幂等：已装且指向同一路径则跳过
  local probe="" has_dep="" cur_dep="" has_bundle="" bundle_count=""
  probe="$(profile_probe "$dir")"
  {
    IFS= read -r has_dep
    IFS= read -r cur_dep
    IFS= read -r has_bundle
    IFS= read -r bundle_count
  } <<<"$probe"
  local dep_desc="(缺失)"; [[ "$has_dep" == "1" ]] && dep_desc="$cur_dep"
  local bundle_desc="缺失"; [[ "$has_bundle" == "1" ]] && bundle_desc="已选入"
  log_inst "当前状态: dependency=$dep_desc | bundle=$bundle_desc | bundles 共 $bundle_count 项"

  if [[ "$has_dep" == "1" && "$cur_dep" == "$link_spec" && "$has_bundle" == "1" ]]; then
    log_inst "已安装且指向本仓库，无需变更（幂等跳过）"
    print_install_next_steps
    log_done "安装阶段完成（无变更）"
    return 0
  fi

  # --- 备份 ---
  local ts bak lock_file lock_bak
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  bak="$dir/package.json.bak.$ts"
  lock_file="$dir/pnpm-lock.yaml"
  lock_bak="$dir/pnpm-lock.yaml.bak.$ts"
  assert_overwrite_target "$dir" "$bak" "package.json.bak.$ts"
  log_inst "备份 package.json → $(basename -- "$bak")"
  run cp -p "$pkg_file" "$bak"
  if [[ -f "$lock_file" ]]; then
    assert_overwrite_target "$dir" "$lock_bak" "pnpm-lock.yaml.bak.$ts"
    log_inst "备份 pnpm-lock.yaml → $(basename -- "$lock_bak")"
    run cp -p "$lock_file" "$lock_bak"
  fi

  # --- 选择安装路径 ---
  if [[ "$runner" == "dsh" ]]; then
    log_inst "正规路径：dsh plugin --profile $PROFILE add ${link_spec}（dsh CLI 转发 pnpm）"
    if (( DRY_RUN )); then
      log_plan "timeout ${TIMEOUT_SECS}s: dsh plugin --profile $PROFILE add $link_spec"
      log_plan "node 补丁 package.json: dependencies.$PLUGIN_PKG=\"$link_spec\" ; dsh.profile.bundles += ${PLUGIN_PKG}（$bundle_count → $((bundle_count + 1)) 项）"
    else
      local add_rc=0
      run_with_timeout "$TIMEOUT_SECS" "dsh plugin add" \
        dsh plugin --profile "$PROFILE" add "$link_spec" || add_rc=$?
      if (( add_rc == 124 )); then
        die "dsh plugin add 超时（${TIMEOUT_SECS}s）" "$EXIT_TIMEOUT" \
          "package.json 可能已被 pnpm 部分写入：先 --dry-run 只读核对；可 --timeout 300 重试或 --rollback 恢复"
      fi
      if (( add_rc != 0 )); then
        (( ASSUME_YES )) || die "dsh plugin add 失败" "$EXIT_INSTALL" \
          "确认 profile 可写后重试；或加 --yes 允许回退到手工写 package.json + pnpm install"
        log_warn "dsh plugin add 失败，回退到手工路径（写 package.json + pnpm install）"
        profile_patch_add "$dir" "$link_spec" >/dev/null
        pnpm_install_profile "$dir" "$runner" 0
      fi
      # dsh plugin add 只装包，不含 bundle 选择 → 补齐
      log_inst "补 bundle 选择（dsh CLI 无 bundle 子命令）"
      profile_patch_add "$dir" "$link_spec" >/dev/null
    fi
  elif (( ASSUME_YES || DRY_RUN )); then
    if (( DRY_RUN && ! ASSUME_YES )); then
      log_warn "dry-run：未探测到 CLI 转发路径；真实运行需要 --yes 才会走兼容回退路径"
    fi
    log_warn "走兼容回退路径（docs/install.md §1.2，ASSUMPTION）：手工写 package.json + pnpm install"
    if (( DRY_RUN )); then
      log_plan "node 补丁 package.json: dependencies.$PLUGIN_PKG=\"$link_spec\" ; dsh.profile.bundles += ${PLUGIN_PKG}（$bundle_count → $((bundle_count + 1)) 项）"
      log_plan "(cd $dir && pnpm install --offline)"
    else
      local patch_out=""
      patch_out="$(profile_patch_add "$dir" "$link_spec")"
      log_inst "package.json 已更新: $patch_out"
      if [[ -z "$runner" ]]; then
        if have_cmd pnpm; then runner="pnpm"; else die "未找到 pnpm，无法安装" "$EXIT_INSTALL" "安装 pnpm 或改用 plugin_manager install_bundle"; fi
      fi
      pnpm_install_profile "$dir" "$runner" 1
    fi
  else
    die "未探测到可用的 dsh CLI 转发路径，兼容回退路径需要 --yes 确认" "$EXIT_INSTALL" \
      "重跑并加 --yes（会手工改 profile package.json 并执行 pnpm install）"
  fi

  # --- 结果核对 ---
  if (( DRY_RUN )); then
    log_inst "dry-run 未改动任何文件；真实运行会写 ${pkg_file}（先备份）、可能更新 pnpm-lock.yaml 与 node_modules"
  else
    local post=""
    post="$(profile_verify_installed "$dir")"
    [[ "$post" == "ok" ]] || die "安装后核对失败：package.json 未正确写入 link 依赖或 bundle 选择" "$EXIT_INSTALL" \
      "用 --rollback 恢复，然后改用 plugin_manager 的 install_bundle"
    log_inst "核对通过：dependency=${link_spec}，bundle 已选入"
  fi

  print_install_next_steps
  log_done "安装阶段完成"
}

# --- 回滚 ------------------------------------------------------------------

rollback_stage() {
  local dir
  dir="$(profile_dir)"
  log_inst "回滚 profile=$PROFILE dir=$dir"
  [[ -d "$dir" ]] || die "profile 目录不存在: $dir" "$EXIT_INSTALL"
  [[ -f "$dir/package.json" ]] || die "profile 缺少 package.json: $dir/package.json" "$EXIT_INSTALL"

  # 最近一次备份（跳过已恢复的 .restored）
  local latest=""
  latest="$(find "$dir" -maxdepth 1 -type f -name 'package.json.bak.*' ! -name '*.restored' -print 2>/dev/null \
            | LC_ALL=C sort | tail -n 1)"
  if [[ -z "$latest" ]]; then
    log_inst "没有可用的 package.json 备份 —— 无需回滚（幂等）"
    log_done "回滚阶段完成（无操作）"
    return 0
  fi
  assert_overwrite_target "$dir" "$latest" "$(basename -- "$latest")"
  local ts="${latest##*.bak.}"
  local lock_bak="$dir/pnpm-lock.yaml.bak.$ts"
  log_inst "将恢复备份: $(basename -- "$latest")"

  if (( DRY_RUN )); then
    log_plan "cp -p $latest $dir/package.json"
    [[ -f "$lock_bak" ]] && log_plan "cp -p $lock_bak $dir/pnpm-lock.yaml"
    log_plan "node 补丁：从 dsh.profile.bundles 移除 ${PLUGIN_PKG}（若仍存在）"
    log_plan "pnpm 安装以收敛 node_modules（offline 优先，失败回退联网）"
    log_inst "dry-run 未改动任何文件"
    log_done "回滚阶段（dry-run）完成"
    return 0
  fi

  cp -p "$latest" "$dir/package.json"
  if [[ -f "$lock_bak" ]]; then
    assert_overwrite_target "$dir" "$lock_bak" "$(basename -- "$lock_bak")"
    cp -p "$lock_bak" "$dir/pnpm-lock.yaml"
    log_inst "已恢复 pnpm-lock.yaml"
  fi
  # 备份改名，保证「再回滚一次」不会重复恢复同一份
  mv "$latest" "$latest.restored"
  log_inst "已恢复 package.json（备份标记为 $(basename -- "$latest").restored）"

  local removed=""
  removed="$(profile_patch_remove "$dir")"
  log_inst "清理 bundle/dependency: $removed"

  local runner=""
  runner="$(resolve_pnpm_runner)"
  if [[ -z "$runner" ]]; then
    log_warn "未找到 dsh CLI/pnpm：package.json 已恢复，但 node_modules 未清理（手动 pnpm install 即可）"
  else
    pnpm_install_profile "$dir" "$runner" 1
    log_inst "pnpm 已重新收敛 node_modules"
  fi

  log_inst "回滚完成。重启 DSH 桌面版 + 刷新页面后「终端」tab 应消失。"
  log_done "回滚阶段完成"
}

# --- 主流程 ----------------------------------------------------------------
main() {
  local mode="publish+install"
  if (( DO_ROLLBACK )); then
    mode="rollback"
  elif (( ! DO_PUSH && DO_INSTALL )); then
    mode="install only"
  elif (( DO_PUSH && ! DO_INSTALL )); then
    mode="push only"
  fi
  (( DRY_RUN )) && mode="${mode} (dry-run)"

  log "start" "dsh-terminal-panel $mode"
  log "info" "repo=$REPO_ROOT profile=$PROFILE dsh_home=$DSH_HOME"

  if (( DO_ROLLBACK )); then
    rollback_stage
  else
    (( DO_PUSH )) && push_stage
    (( DO_INSTALL )) && install_stage
  fi

  if (( DRY_RUN )); then
    printf '%s提示：dry-run 未改变任何状态；去掉 --dry-run 才会真正推送/安装。%s\n' "$C_DIM" "$C_RESET"
  fi
  log_done "全部完成"
}

main "$@"
