#!/bin/sh
# repo の mise 設定(conf.d/10-dotfiles.toml と config.<env>.toml)を、mise が実際に読む
# 設定ディレクトリに symlink する。MISE_CONFIG_DIR を変えている環境(コンテナなど)でも
# そこに置く。[dotfiles] の配置先は ~/ か絶対パスに固定されるため、ここで行う。
# `mise bootstrap` の前に実行する。何度実行してもよい(新しい config.<env>.toml も link される)。
set -eu

repo=$(cd "$(dirname "$0")" && pwd)
dir=${MISE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/mise}

mkdir -p "$dir/conf.d"
ln -sf "$repo/.config/mise/conf.d/10-dotfiles.toml" "$dir/conf.d/10-dotfiles.toml"
ln -sf "$repo/.config/mise/miserc.toml" "$dir/miserc.toml"
for f in "$repo"/.config/mise/config.*.toml; do
  ln -sf "$f" "$dir/$(basename "$f")"
done
echo "linked mise config into $dir"
