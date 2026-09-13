#!/usr/bin/env bash
# notify.sh
# Modern Windows 10/11 Toast notification via BurntToast (WSL -> Windows).
# Circle-cropped app logo, dynamic message from hook stdin payload.

source "$(dirname "$0")/_lib.sh"
require_jq

input=$(cat)
message=$(printf '%s' "$input" | jq -r '.message // "Needs your attention"')
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')

title="Claude Code"
if [ -n "$cwd" ] && [ "$cwd" != "null" ]; then
  title="Claude Code — $(basename "$cwd")"
fi

escape_ps() {
  printf '%s' "$1" | sed "s/'/''/g"
}
title_ps=$(escape_ps "$title")
message_ps=$(escape_ps "$message")

icon_path="$(dirname "$0")/notify-icon.png"
logo_block=""
binding_logo=""
if [ -f "$icon_path" ]; then
  icon_ps=$(escape_ps "$(wslpath -w "$icon_path")")
  logo_block="\$logo = New-BTImage -Source '$icon_ps' -AppLogoOverride -Crop Circle; "
  binding_logo=" -AppLogoOverride \$logo"
fi

ps_script="${logo_block}\$t1 = New-BTText -Text '$title_ps'; \$t2 = New-BTText -Text '$message_ps'; \$b = New-BTBinding -Children \$t1,\$t2${binding_logo}; \$v = New-BTVisual -BindingGeneric \$b; \$c = New-BTContent -Visual \$v; Submit-BTNotification -Content \$c"

encoded=$(printf '%s' "$ps_script" | iconv -t UTF-16LE | base64 -w0)
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -EncodedCommand "$encoded" 2>/dev/null &

exit 0
