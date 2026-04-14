# Content-based compinit cache invalidation.
# Source: https://github.com/zimfw/completion/blob/master/init.zsh
# Divergence from upstream: zstat -L のみ追加
# (broken symlink の _docker 等で zstat が失敗するのを回避)

() {
  emulate -L zsh -o EXTENDED_GLOB
  local zdump=${ZDOTDIR:-$HOME}/.zcompdump zold_dat
  local -a zmtimes
  local -i fresh=1
  local -r zcomps=(${^fpath}/^([^_]*|*~|*.zwc)(N))

  if (( $#zcomps )); then
    zmodload -F zsh/stat b:zstat && zstat -L -A zmtimes +mtime $zcomps || return 1
  fi
  local -r new_sig=${ZSH_VERSION}$'\0'${(pj:\0:)zcomps}$'\0'${(pj:\0:)zmtimes}

  if [[ -e ${zdump}.dat ]]; then
    zmodload -F zsh/system b:sysread && sysread -s $#new_sig zold_dat < ${zdump}.dat || return 1
    [[ $zold_dat == $new_sig ]] && fresh=0
  fi
  (( fresh )) && command rm -f ${zdump}(|.dat|.zwc(|.old))(N)

  autoload -Uz compinit && compinit -C -d $zdump && [[ -e $zdump ]] || return 1

  [[ ${zdump}.dat -nt $zdump ]] || print -r -- $new_sig >! ${zdump}.dat
  [[ ${zdump}.zwc -nt $zdump ]] || zcompile $zdump
}
