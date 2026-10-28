#!/usr/bin/env bash
# 素の HOME で SETUP.md の新規セットアップを再現し、mise bootstrap の結果を検証する(Linux 用)。
#
# usage: bootstrap-test.sh
#
# 環境変数:
#   TEST_MISE_VERSION     インストールする mise のバージョン
#   TEST_MISE_ENV         miserc.local.toml に書く env(TOML の配列)
#   TEST_CUSTOM_MISE_DIRS 1 なら mise の公式 Docker イメージと同じく MISE_*_DIR を1か所にまとめる
#   GITHUB_WORKSPACE      checkout 済みの repo
#
# 検証は失敗しても止めずに最後まで行い、結果を GITHUB_STEP_SUMMARY にまとめる。
set -uo pipefail

repo="$HOME/.dotfiles"
mise="$HOME/.local/bin/mise"
failures=()
results=()

check() {
  local name="$1"
  shift
  echo "::group::$name"
  if "$@"; then
    results+=("| ✅ | $name |")
    echo "::endgroup::"
    echo "PASS: $name"
  else
    results+=("| ❌ | $name |")
    failures+=("$name")
    echo "::endgroup::"
    echo "FAIL: $name"
  fi
}

# checkout 先にいると、mise がそこの .config/mise をプロジェクトの設定として読む。
# umask は一般的なユーザー環境に合わせる(runner の 002 だと zsh の compinit が安全でないと判定して止まる)。
cd "$HOME" || exit 1
umask 022

if [[ ${TEST_CUSTOM_MISE_DIRS:-} == 1 ]]; then
  export MISE_DATA_DIR="$HOME/mise" MISE_CONFIG_DIR="$HOME/mise" MISE_CACHE_DIR="$HOME/mise/cache"
fi

# 新しい端末を開いた状態を再現する。ジョブの PATH や GITHUB_TOKEN は引き継がず、mise の場所の指定だけを渡す。
new_zsh() {
  local vars=(HOME="$HOME" TERM=xterm-256color PATH=/usr/bin:/bin)
  local v
  for v in MISE_DATA_DIR MISE_CONFIG_DIR MISE_CACHE_DIR; do
    [[ -n ${!v:-} ]] && vars+=("$v=${!v}")
  done
  env -i "${vars[@]}" zsh -lic "$1"
}

new_zsh_starts() {
  local code
  new_zsh 'exit'
  code=$?
  echo "exit code: $code"
  ((code == 0))
}

new_zsh_quiet() {
  local err
  err=$(new_zsh 'exit' 2>&1 >/dev/null)
  printf '%s\n' "$err"
  [[ -z $err ]]
}

# 2回目の bootstrap が dotfiles を変更していないこと(ツールは bootstrap status --missing で見る)
second_run_noop() {
  local out
  out=$("$mise" bootstrap -y 2>&1) || return 1
  printf '%s\n' "$out"
  ! grep -E '^mise (files|edits): (applied|created|removed)' <<<"$out"
}

# 設定が1つも読まれていなくても bootstrap status は収束と判定するため、env 別の設定まで読まれたかを見る
env_config_loaded() {
  local out
  out=$("$mise" config ls 2>&1)
  printf '%s\n' "$out"
  grep -q 'config\.cli\.toml' <<<"$out"
}

repo_clean() {
  local out
  out=$(git -C "$repo" status --porcelain --untracked-files=all)
  printf '%s\n' "$out"
  [[ -z $out ]]
}

# --- mise のインストール(mise.run と同じく ~/.local/bin に置く) ---
tmp=$(mktemp -d)
mkdir -p "$HOME/.local/bin"
curl -fsSL "https://github.com/jdx/mise/releases/download/v${TEST_MISE_VERSION}/mise-v${TEST_MISE_VERSION}-linux-x64.tar.gz" |
  tar xz -C "$tmp"
install "$tmp/mise/bin/mise" "$mise"
"$mise" --version

# checkout 先は所有者が違うことがあり、git が dubious ownership で拒否するため、所有者ごとコピーし直す
cp -R "$GITHUB_WORKSPACE" "$repo"

# --- セットアップ(SETUP.md の手順) ---
check "mise-link.sh" "$repo/mise-link.sh"
printf 'env = %s\n' "$TEST_MISE_ENV" >"${MISE_CONFIG_DIR:-$HOME/.config/mise}/miserc.local.toml"
check "mise bootstrap" "$mise" bootstrap -y

# --- 検証 ---
check "environment 別の設定が読まれている" env_config_loaded
check "設定どおりに収束している(bootstrap status --missing)" "$mise" bootstrap status --missing

check "2回目の bootstrap は dotfiles を変更しない" second_run_noop

# 初回の zsh は sheldon がプラグインを取得してメッセージを出すため、2回目の起動で stderr を見る
check "新しい zsh が起動する" new_zsh_starts
check "新しい zsh の起動で stderr に何も出ない" new_zsh_quiet
check "新しい zsh で mise が有効になっている" new_zsh '[[ -n $MISE_SHELL ]]'
check "新しい zsh で主なコマンドが使える" new_zsh '
  rc=0
  for c in mise git nvim starship delta eza bat fzf rg fd sheldon; do
    (( $+commands[$c] )) || { print -u2 "not found: $c"; rc=1; }
  done
  exit $rc'

# omarchy や手動の `mise use -g` で repo に無いツールを足しても、repo に書き込まれないこと
"$mise" use -g shellcheck@0 >/dev/null 2>&1
check "mise use -g で repo が変更されない" repo_clean

echo "::group::診断情報"
"$mise" config ls
ls -la "$HOME/.config" "${MISE_CONFIG_DIR:-$HOME/.config/mise}" 2>&1
echo "::endgroup::"

{
  echo "### ${TEST_TARGET:-linux}"
  echo
  echo "| | 検証 |"
  echo "|---|---|"
  printf '%s\n' "${results[@]}"
} >>"${GITHUB_STEP_SUMMARY:-/dev/stdout}"

((${#failures[@]} == 0))
