#!/usr/bin/env bash
# 素の HOME で SETUP.md の新規セットアップを再現し、mise bootstrap の結果を検証する(Linux 用)。
#
# usage: bootstrap-test.sh <link|config-dir>
#   link       : 現行方式。conf.d/10-dotfiles.toml を手で link し、mise dot apply → mise bootstrap
#   config-dir : 比較する方式。mise bootstrap --config-dir で mise の設定ディレクトリごと repo に link する
#
# 環境変数:
#   TEST_MISE_VERSION     インストールする mise のバージョン
#   TEST_MISE_ENV         miserc.local.toml に書く env(TOML の配列)
#   TEST_CUSTOM_MISE_DIRS 1 なら mise の公式 Docker イメージと同じく MISE_*_DIR を1か所にまとめる
#   GITHUB_WORKSPACE      checkout 済みの repo
#
# 検証は失敗しても止めずに最後まで行い、結果を GITHUB_STEP_SUMMARY にまとめる。
set -uo pipefail

method="$1"
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
case "$method" in
link)
  mkdir -p "$HOME/.config/mise/conf.d"
  ln -s "$repo/.config/mise/conf.d/10-dotfiles.toml" "$HOME/.config/mise/conf.d/"
  printf 'env = %s\n' "$TEST_MISE_ENV" >"$HOME/.config/mise/miserc.local.toml"
  check "mise dot apply" "$mise" dot apply -y
  check "mise bootstrap" "$mise" bootstrap -y
  ;;
config-dir)
  # この方式では repo の .config/mise がそのまま設定ディレクトリになる。mise 設定自身を配置する
  # エントリーは配置元と配置先が同じファイルになって衝突するため外し、machine-local の config.toml を
  # gitignore する(この方式を採る場合の repo の変更を再現する)。
  sed -i '/^# mise 設定自身の配置/,$d' "$repo/.config/mise/conf.d/10-dotfiles.toml"
  echo '/.config/mise/config.toml' >>"$repo/.gitignore"
  git -C "$repo" -c user.name=ci -c user.email=ci@localhost commit -qam "ci: config-dir 方式の変更"
  printf 'env = %s\n' "$TEST_MISE_ENV" >"$repo/.config/mise/miserc.local.toml"
  check "mise bootstrap --config-dir" "$mise" bootstrap \
    --from "$(git -C "$repo" remote get-url origin)" --from-dir "$repo" --config-dir .config/mise -y
  ;;
*)
  echo "unknown method: $method" >&2
  exit 2
  ;;
esac

# --- 検証 ---
check "設定どおりに収束している(bootstrap status --missing)" "$mise" bootstrap status --missing

check "2回目の bootstrap は dotfiles を変更しない" second_run_noop

# 初回の zsh は sheldon がプラグインを取得してメッセージを出すため、2回目の起動で stderr を見る
check "新しい zsh が起動する" new_zsh 'exit'
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
  echo "### ${TEST_TARGET:-linux} / $method"
  echo
  echo "| | 検証 |"
  echo "|---|---|"
  printf '%s\n' "${results[@]}"
} >>"${GITHUB_STEP_SUMMARY:-/dev/stdout}"

((${#failures[@]} == 0))
