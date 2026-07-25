alias eza="eza --icons=auto --git --group-directories-first"
alias ls="eza"
alias ll="eza -l"
alias la="eza -a"
alias lt="eza --tree"
alias lla="eza -la"
alias cat="bat --paging=never"

# abbr はこのファイルを唯一の定義元とするため session スコープで宣言する。
# 既定の user スコープはストア(~/.config/zsh-abbr/user-abbreviations)へ永続化され、
# 次回起動時に「It already has an expansion」で全行が no-op になるうえ、
# ここから消した定義がストアに残り続ける。
# -f は同名の実コマンドがある abbr(mkdir, vi)の登録に必要。
# ABBR_QUIETER は宣言時のログを抑えるためで、対話実行の abbr には影響しない。
() {
  local ABBR_QUIETER=1

  abbr -S -f -g "devnull"=">/dev/null 2>&1"
  abbr -S -f -g "L"="| less"
  abbr -S -f -g "xn"="| xargs nvim"

  abbr -S -f "mkdir"="mkdir -p"

  abbr -S -f "vi"="nvim"

  abbr -S -f "g"="git"
  abbr -S -f "gs"="git status"
  abbr -S -f "gca"="git commit --amend"
  abbr -S -f "gcim"="git commit -m"
  abbr -S -f "gp"="git pull --rebase --autostash"
  abbr -S -f "gpu"="git push"
  abbr -S -f "gst"="git stash"
  abbr -S -f "gstp"="git stash pop"
  abbr -S -f "gsw"="git switch -c "
  abbr -S -f "gre"="git rebase origin/main --autostash"
  abbr -S -f "gres"="git restore ."
  abbr -S -f "gsn"="git show --name-status"
  abbr -S -f "gdn"="git diff --name-status origin/main"
  abbr -S -f "t"="tig"
  abbr -S -f "lg"="lazygit"

  # Claude Code
  abbr -S -f "clauded"="claude --dangerously-skip-permissions"
  abbr -S -f "claudexd"="claudex --dangerously-skip-permissions"
}
