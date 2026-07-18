# Claude Code through CLIProxyAPI using GPT-5.6 Sol
claudex() {
  local key_file="${HOME}/.config/cli-proxy-api/client-key"

  if [[ ! -r "${key_file}" ]]; then
    print -u2 "claudex: proxy key not found: ${key_file}"
    return 1
  fi

  if ! systemctl --user is-active --quiet cli-proxy-api.service; then
    systemctl --user start cli-proxy-api.service || return 1
  fi

  ANTHROPIC_BASE_URL="http://127.0.0.1:8317" \
  ANTHROPIC_AUTH_TOKEN="$(<"${key_file}")" \
  ANTHROPIC_DEFAULT_HAIKU_MODEL="gpt-5.6-sol" \
  CLAUDE_CODE_SUBAGENT_MODEL="gpt-5.6-sol" \
  CLAUDE_CODE_ALWAYS_ENABLE_EFFORT="1" \
  CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY="3" \
  ENABLE_TOOL_SEARCH="false" \
  command claude --model "gpt-5.6-sol" "$@"
}
