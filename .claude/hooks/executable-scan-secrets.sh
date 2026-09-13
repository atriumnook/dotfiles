#!/usr/bin/env bash
# scan-secrets.sh
# PostToolUse hook for Bash. Scans command output for leaked secrets
# and warns Claude not to repeat them in the response.

source "$(dirname "$0")/_lib.sh"

require_jq

INPUT=$(cat)
OUTPUT="$(echo "$INPUT" | jq -r '(.tool_response.stdout // "") + " " + (.tool_response.stderr // "")')"

[ -z "$OUTPUT" ] && { echo '{}'; exit 0; }

LEAKED=()

# Bearer tokens
if echo "$OUTPUT" | grep -qEi 'bearer[[:space:]]+[A-Za-z0-9._~+/=-]{20,}'; then
  LEAKED+=("Bearer token")
fi

# Known API key formats
if echo "$OUTPUT" | grep -qE '\b(sk-(proj-)?[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|gh[pso]_[A-Za-z0-9]{36}|sk-ant-[A-Za-z0-9-]{20,}|[sr]k_(live|test)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b'; then
  LEAKED+=("API key")
fi

# AWS secret access key
if echo "$OUTPUT" | grep -qE 'aws_secret_access_key[[:space:]]*[=:][[:space:]]*[A-Za-z0-9/+=]{40}'; then
  LEAKED+=("AWS secret")
fi

# Env-style secret assignments (value length >= 16, excludes plain placeholders)
if echo "$OUTPUT" | grep -qEi '\b(TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|AUTH_TOKEN|PRIVATE_KEY|ACCESS_KEY)[A-Z_]*=[A-Za-z0-9._~+/=-]{16,}'; then
  LEAKED+=("env secret")
fi

# URLs with embedded credentials (password length >= 8)
if echo "$OUTPUT" | grep -qE '[a-z][a-z0-9+.-]*://[^:[:space:]/]+:[^@[:space:]]{8,}@'; then
  LEAKED+=("URL credential")
fi

# Authorization/auth headers
if echo "$OUTPUT" | grep -qEi '^(Authorization|X-Api-Key|X-Auth-Token|X-Access-Token):[[:space:]]*[^[:space:]]{16,}'; then
  LEAKED+=("auth header")
fi

# PEM private key markers
if echo "$OUTPUT" | grep -qE -- '-----BEGIN[[:space:]](RSA[[:space:]]|DSA[[:space:]]|EC[[:space:]]|OPENSSH[[:space:]]|PGP[[:space:]])?PRIVATE[[:space:]]KEY-----'; then
  LEAKED+=("private key")
fi

if [ ${#LEAKED[@]} -eq 0 ]; then
  echo '{}'
  exit 0
fi

IFS=", "
LEAKED_STR="${LEAKED[*]}"
unset IFS

jq -n --arg leaked "$LEAKED_STR" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": ("SECURITY WARNING: Command output contains potential secrets (" + $leaked + "). Do NOT repeat, quote, reference, or summarize these values in your response. If you need to refer to them, use generic placeholders like <TOKEN> or <SECRET>.")
  }
}'
