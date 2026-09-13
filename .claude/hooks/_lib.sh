#!/usr/bin/env bash
# Shared utilities for Claude Code hooks.

# block — deny a PreToolUse action and exit.
# Outputs hookSpecificOutput JSON for permissionDecision, plus a short stderr message.
# Usage: block "reason message"
block() {
  local reason="$1"
  if command -v jq &>/dev/null; then
    jq -n --arg reason "DENIED: $reason Do NOT bypass this restriction or retry the same blocked command." '{
      "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": $reason
      }
    }'
  fi
  echo "Blocked: $reason" >&2
  exit 2
}

# parse_command — read stdin, extract .tool_input.command, strip heredoc content.
# Returns 1 if command is empty. Usage: CMD=$(parse_command) || exit 0
parse_command() {
  local input cmd
  input=$(cat)
  cmd=$(echo "$input" | jq -r '.tool_input.command // empty') || return 1
  [ -z "$cmd" ] && return 1
  # Heredoc handling: the opener line (e.g. `cat .env <<EOF`) still executes
  # its command portion, so strip only the `<<DELIM` suffix and emit the rest
  # to the rule engine. Bash permits digits, hyphens, dots in unquoted
  # delimiters (END-1, EOF_1), so the character class is broader than
  # [A-Za-z_]. gsub strips surrounding quote chars only, never hyphens.
  echo "$cmd" | awk '
    /<<-?[ ]*[\x27"]?[A-Za-z_][A-Za-z0-9_.-]*[\x27"]?[ ]*$/ {
      delim=$NF; gsub(/[\x27"]/, "", delim);
      sub(/<<-?[ ]*[\x27"]?[A-Za-z_][A-Za-z0-9_.-]*[\x27"]?[ ]*$/, "");
      print; skip=1; next
    }
    skip && $0 == delim { skip=0; next }
    !skip'
}

# require_jq — warn if jq is not available, then fail open (exit 0).
# Missing jq is an environment issue, not an attack. Fail open so normal work
# is not blocked by an incomplete environment.
require_jq() {
  if ! command -v jq &>/dev/null; then
    echo "[hook] WARNING: jq is not installed. Hook is failing open. Install jq to enable proper protection." >&2
    exit 0
  fi
}

# split_segments — read a shell command from stdin and emit one top-level
# segment per line, splitting on unquoted `;`, `&&`, `||`. Respects single
# and double quotes plus backslash escapes. Command substitution contents
# are treated opaquely (the outer regex still scans inside). Callers should
# first run parse_command to strip heredocs.
split_segments() {
  awk '
  {
    sq = 0; dq = 0; out = ""; n = length($0);
    for (i = 1; i <= n; i++) {
      c = substr($0, i, 1);
      nc = (i < n) ? substr($0, i + 1, 1) : "";
      if (c == "\\" && !sq && nc != "") { out = out c nc; i++; continue; }
      if (c == "\047" && !dq) { sq = !sq; out = out c; continue; }
      if (c == "\"" && !sq) { dq = !dq; out = out c; continue; }
      if (!sq && !dq) {
        if (c == ";") { if (out != "") print out; out = ""; continue; }
        if (c == "&" && nc == "&") { if (out != "") print out; out = ""; i++; continue; }
        if (c == "|" && nc == "|") { if (out != "") print out; out = ""; i++; continue; }
      }
      out = out c;
    }
    if (length(out) > 0) print out;
  }'
}
