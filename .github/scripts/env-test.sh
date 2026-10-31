#!/usr/bin/env bash
# miserc.toml が決める environment を、profile の記録ごとに検証する(Linux 用)。
# omarchy かどうかは /usr/share/omarchy の有無で決まるため、実行する機に合う側の表だけを検証する。
# CI では /usr/share/omarchy を作ったコンテナと作らないコンテナの両方で実行する。
#
# usage: env-test.sh
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
failures=0

# 素の HOME と設定ディレクトリで mise-link.sh を実行し、読まれた config.<env>.toml の env を並べる
loaded_envs() {
  local tmp
  tmp=$(mktemp -d)
  mkdir -p "$tmp/home"
  env -i HOME="$tmp/home" PATH="$PATH" MISE_CONFIG_DIR="$tmp/mise" "$repo/mise-link.sh" >/dev/null
  for p in "$@"; do
    case $p in
      local=*) printf '%s\n' "${p#local=}" >"$tmp/mise/miserc.local.toml" ;;
      *) : >"$tmp/mise/profile.$p" ;;
    esac
  done
  (cd "$tmp/home" && env -i HOME="$tmp/home" PATH="$PATH" MISE_CONFIG_DIR="$tmp/mise" mise config ls 2>&1) |
    grep -oE 'config\.[a-z-]+\.toml' | sed -E 's/^config\.(.*)\.toml$/\1/' | sort | xargs
  rm -rf "$tmp"
}

# case <期待する env(空白区切り)> [記録する profile ...] [local=<miserc.local.toml の内容>]
case_() {
  local want got
  want=$(tr ' ' '\n' <<<"$1" | sort | xargs)
  shift
  got=$(loaded_envs "$@")
  if [[ $got == "$want" ]]; then
    echo "PASS: [${*:-記録なし}] -> $got"
  else
    echo "FAIL: [${*:-記録なし}] -> got '$got', want '$want'"
    failures=$((failures + 1))
  fi
}

if [[ -d /usr/share/omarchy ]]; then
  echo "omarchy 機として検証する"
  case_ "personal linux omarchy" personal
  case_ "work linux omarchy" work
  case_ "linux omarchy"
  case_ "linux omarchy" personal work
else
  echo "omarchy 以外の Linux 機として検証する"
  case_ "personal linux wsldebian cli personal-cli" personal
  case_ "work linux wsldebian cli" work
  case_ "linux wsldebian cli"
  case_ "linux wsldebian cli" personal work
fi
# miserc.local.toml は計算した env を丸ごと置き換える
case_ "work linux" personal 'local=env = ["work", "linux"]'

((failures == 0))
