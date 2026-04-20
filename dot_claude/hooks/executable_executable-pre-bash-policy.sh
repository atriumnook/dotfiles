#!/usr/bin/env bash
# pre-bash-policy.sh
# Enforces personal tool preferences via PreToolUse(Bash).
# find -> fd, grep -> rg (standalone only; pipes and git grep are allowed).

command -v jq >/dev/null || exit 0

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

# Block standalone find at segment start
if echo "$CMD" | grep -qE '(^|[[:space:];&|])find[[:space:]]'; then
  # Exclude `git find` or similar subcommands — find is not actually a git subcommand,
  # but include the check for forward compatibility.
  if ! echo "$CMD" | grep -qE '\bgit[[:space:]]+find\b'; then
    echo "Use fd instead of find. fd respects .gitignore by default and has simpler syntax." >&2
    exit 2
  fi
fi

# Block standalone grep at segment start (not piped, not git grep)
if echo "$CMD" | grep -qE '(^|;|&&|\|\|)[[:space:]]*grep[[:space:]]' && \
  ! echo "$CMD" | grep -qE '\bgit[[:space:]]+grep\b'; then
  echo "Use rg (ripgrep) instead of grep for standalone searches. grep is fine in pipes (e.g., 'ls | grep foo')." >&2
  exit 2
fi

exit 0
