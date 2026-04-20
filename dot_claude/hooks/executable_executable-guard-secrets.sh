#!/usr/bin/env bash
# guard-secrets.sh
# PreToolUse hook. Blocks access to secret files and credential-exposing operations.
# Handles both file-based tools (Read/Edit/Write) and Bash commands.

source "$(dirname "$0")/_lib.sh"

require_jq

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# ---------------------------------------------------------------------------
# Shared patterns
# ---------------------------------------------------------------------------

# Files whose content is considered sensitive.
SECRET_FILE_PATTERNS=(
  # Env files (actual values live here)
  '\.env$'
  '\.env\.(local|production|staging|development)(\.local)?$'

  # Credential files with conventional names
  '\.aws/credentials$'
  '\.npmrc$'
  '\.pypirc$'
  '\.netrc$'
  'auth\.json$'

  # Private keys by filename convention
  '\.pem$'
  '\.key$'
  '(^|/)(id_)?(rsa|ed25519|ecdsa|dsa)$'
  'private-keys-v1\.d'

  # Shell history (may contain pasted secrets)
  '\.zsh_history$'
  '\.bash_history$'
  '\.zprofile$'

  # Credential dumps
  'secrets\.ya?ml$'
  'credentials\.ya?ml$'
)

# Files that match the above but are actually safe to read.
SECRET_FILE_EXCLUSIONS=(
  # Env templates (conventionally committed, no real values)
  '\.env\.(example|sample|template|dist|default|defaults|age)$'
  '\.env\.(example|sample|template|dist|default|defaults)\.(local|production|staging|development)$'

  # Public keys
  '\.pub$'

  # SSH non-secret files
  '\.ssh/config$'
  '\.ssh/known_hosts$'
  '\.ssh/authorized_keys$'
)

# ---------------------------------------------------------------------------
# Path check helper
# Usage: check_path <path>
# Calls block() if the path matches a secret pattern and no exclusion applies.
# ---------------------------------------------------------------------------
check_path() {
  local path="$1"
  [ -z "$path" ] && return 0

  # Apply exclusions first
  for excl in "${SECRET_FILE_EXCLUSIONS[@]}"; do
    if echo "$path" | grep -qE "$excl"; then
      return 0
    fi
  done

  # Check secret patterns
  for pat in "${SECRET_FILE_PATTERNS[@]}"; do
    if echo "$path" | grep -qE "$pat"; then
      block "Access to $path is forbidden. This file likely contains secrets."
    fi
  done
}

# ---------------------------------------------------------------------------
# File-based tools: Read, Edit, Write
# ---------------------------------------------------------------------------
case "$TOOL_NAME" in
  Read|Edit|Write)
    FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    check_path "$FILE_PATH"
    exit 0
    ;;
esac

# ---------------------------------------------------------------------------
# Bash: inspect each top-level segment independently
# ---------------------------------------------------------------------------
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty') || exit 0
[ -z "$CMD" ] && exit 0

# Strip heredoc bodies (the opener line still executes its command portion)
CMD=$(echo "$CMD" | awk '
  /<<-?[ ]*[\x27"]?[A-Za-z_][A-Za-z0-9_.-]*[\x27"]?[ ]*$/ {
    delim=$NF; gsub(/[\x27"]/, "", delim);
    sub(/<<-?[ ]*[\x27"]?[A-Za-z_][A-Za-z0-9_.-]*[\x27"]?[ ]*$/, "");
    print; skip=1; next
  }
  skip && $0 == delim { skip=0; next }
  !skip')

# Commands that read file contents or expose environment state.
READ_CMDS='cat|head|tail|less|more|bat|rg|grep|sed|awk|base64|xxd|od|cp|mv|tee|source|\.'

# Secret file token pattern (matches filename appearing as a command argument).
SECRET_FILE_TOKEN='\.env(\.(local|production|staging|development)(\.local)?)?\b|\.npmrc\b|\.pypirc\b|\.netrc\b|auth\.json\b|\.aws/credentials\b|private-keys-v1\.d|\.zsh_history\b|\.bash_history\b|\.zprofile\b'

# File extensions/suffixes that indicate private key material.
PRIVATE_KEY_TOKEN='\.pem\b|\.key\b|\b(id_)?(rsa|ed25519|ecdsa|dsa)\b'

# Trailing path boundary.
PATH_END='($|[[:space:]/"'"'"'>;|&)`])'

while IFS= read -r SEG; do
  [ -z "$SEG" ] && continue

  # 1. Environment dump commands
  if echo "$SEG" | grep -qE '(^|[[:space:];|&])(printenv|declare\s+-xp|export\s+-p|typeset\s+-xp)\b'; then
    block "Command dumps environment variables including secrets."
  fi
  if echo "$SEG" | grep -qE '(^|\|)\s*env\s*(\||>|$)'; then
    block "Command dumps environment variables including secrets."
  fi
  if echo "$SEG" | grep -qE '(^|\|)\s*set\s*(\||>|$)' && \
    ! echo "$SEG" | grep -qE '(^|\|)\s*set\s+[-+]'; then
    block "Command dumps shell variables including secrets."
  fi

  # 2. Exclusions first (templates, public keys, SSH non-secret files)
  if echo "$SEG" | grep -qE '\.env\.(example|sample|template|dist|default|defaults|age)\b' || \
    echo "$SEG" | grep -qE '\.pub\b' || \
    echo "$SEG" | grep -qE '\.ssh/(config|known_hosts|authorized_keys)\b'; then
    :
  else
    # 3. Reading secret files via command tokens
    if echo "$SEG" | grep -qE "\b($READ_CMDS)\b.*($SECRET_FILE_TOKEN)$PATH_END"; then
      block "Command reads secret file contents."
    fi

    # 4. Private keys
    if echo "$SEG" | grep -qE "\b($READ_CMDS)\b.*($PRIVATE_KEY_TOKEN)$PATH_END"; then
      block "Command reads private key material."
    fi

    # 5. SSH keys by path
    if echo "$SEG" | grep -qE "\b($READ_CMDS)\b.*\.ssh/[^/[:space:]]*"; then
      if echo "$SEG" | grep -oE '\.ssh/[^[:space:]]+' | grep -qvE '(config|known_hosts|authorized_keys|\.pub)'; then
        block "Command reads SSH private key."
      fi
    fi
  fi

  # 6. Credential-exposing commands
  if echo "$SEG" | grep -qE '\bcurl\b.*(\s-v\b|\s--verbose\b)'; then
    block "curl verbose mode prints Authorization headers."
  fi

  if echo "$SEG" | grep -qE '\bgh\s+auth\s+token\b'; then
    block "gh auth token prints GitHub credentials."
  fi

  # 7. Echoing secret variable values
  if echo "$SEG" | grep -qE '(^|[[:space:];|&])(echo|printf)\b[^|]*\$\{?[A-Za-z_][A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY|AUTH_TOKEN)[A-Za-z0-9_]*\}?'; then
    block "Command prints value of a secret-named variable."
  fi

done < <(echo "$CMD" | awk '
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
}')

exit 0
