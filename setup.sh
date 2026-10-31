#!/bin/sh
# 新しいマシンのセットアップと、既存マシンの更新を行う。何度実行してもよい。
#   1. mise が無ければ mise.run で ~/.local/bin に入れる
#   2. ~/.dotfiles を clone する(あれば upstream から fast-forward する)
#   3. mise-link.sh で mise の設定を link する
#   4. profile を mise の設定ディレクトリに記録する(引数 > 記録済みの値 > 端末で尋ねる)
#   5. mise bootstrap を実行する
#
# usage: setup.sh [personal|work] [mise bootstrap の引数...](順不同)
#   --dry-run などは mise bootstrap にだけ効き、1〜4 は実行される
#   curl -fsSL https://raw.githubusercontent.com/atriumnook/dotfiles/main/setup.sh | sh -s -- [personal|work]
#
# 全体を main にまとめ、最後に呼ぶ。curl | sh では読み終える前に実行が始まり、git pull で
# このファイル自体が書き換わることもあるため、先に全体を読ませる。
set -eu

repo_url=https://github.com/atriumnook/dotfiles.git

say() { printf 'setup: %s\n' "$*" >&2; }
die() {
  say "$*"
  exit 1
}

# /dev/tty を開けるか(curl | sh では stdin がパイプなので、端末は /dev/tty から読む)
has_tty() { (exec </dev/tty) 2>/dev/null; }

ask_profile() {
  while :; do
    printf 'このマシンの profile は? [p]ersonal / [w]ork: ' >/dev/tty
    read -r answer </dev/tty || exit 1
    case $answer in
      p | personal) echo personal && return ;;
      w | work) echo work && return ;;
    esac
  done
}

# miserc.toml は /usr/share/omarchy の有無で omarchy を判定する。os-release と食い違うなら、
# omarchy の構成が変わった可能性があるので止める
check_omarchy() {
  by_os=no by_dir=no
  grep -qxE 'ID="?omarchy"?' /etc/os-release 2>/dev/null && by_os=yes
  [ -d /usr/share/omarchy ] && by_dir=yes
  [ "$by_os" = "$by_dir" ] ||
    die "omarchy の判定が食い違う(os-release: $by_os、/usr/share/omarchy: $by_dir)。miserc.toml の判定を見直す"
}

main() {
  # personal / work は位置を問わず profile とし、残りを mise bootstrap に渡す
  profile=
  for arg in "$@"; do
    shift
    case $arg in
      personal | work) profile=$arg ;;
      *) set -- "$@" "$arg" ;;
    esac
  done

  repo=$HOME/.dotfiles
  dir=${MISE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/mise}

  command -v git >/dev/null 2>&1 || die "git が無い。先に OS のパッケージマネージャーで入れる"
  check_omarchy

  if ! command -v mise >/dev/null 2>&1; then
    [ -x "$HOME/.local/bin/mise" ] || curl -fsSL https://mise.run | sh
    PATH=$HOME/.local/bin:$PATH
  fi

  if [ ! -d "$repo/.git" ]; then
    git clone "$repo_url" "$repo"
  elif git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    git -C "$repo" pull --ff-only
  else
    say "$repo のブランチに upstream が無いため、pull しない"
  fi

  "$repo/mise-link.sh"

  if [ -z "$profile" ]; then
    if [ -e "$dir/profile.personal" ] && [ ! -e "$dir/profile.work" ]; then
      profile=personal
    elif [ -e "$dir/profile.work" ] && [ ! -e "$dir/profile.personal" ]; then
      profile=work
    elif has_tty; then
      profile=$(ask_profile)
    else
      die "profile が決まっていない。setup.sh personal か setup.sh work で指定する"
    fi
  fi
  rm -f "$dir/profile.personal" "$dir/profile.work"
  : >"$dir/profile.$profile"
  say "profile: $profile"

  [ -e "$dir/miserc.local.toml" ] &&
    say "$dir/miserc.local.toml の env が、miserc.toml の決める env より優先される。不要なら削除する"

  if has_tty; then
    mise bootstrap "$@" </dev/tty
  else
    # curl | sh では stdin がこのスクリプトを流すパイプなので、引き継がない
    mise bootstrap "$@" </dev/null
  fi
}

main "$@"
