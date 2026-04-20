#!/usr/bin/env bash
# notify-windows.sh
# Windows Toast notification via BurntToast (native Windows, not WSL).

source "$(dirname "$0")/_lib.sh"
require_jq

input=$(cat)
message=$(printf '%s' "$input" | jq -r '.message // "Needs your attention"')
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')

title="Claude Code"
if [ -n "$cwd" ] && [ "$cwd" != "null" ]; then
  title="Claude Code - $(basename "$cwd")"
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
  icon_win=$(cygpath -w "$icon_path" 2>/dev/null || echo "$icon_path")
  icon_ps=$(escape_ps "$icon_win")
  logo_block="\$logo = New-BTImage -Source '$icon_ps' -AppLogoOverride -Crop Circle; "
  binding_logo=" -AppLogoOverride \$logo"
fi

ps_script="${logo_block}\$t1 = New-BTText -Text '$title_ps'; \$t2 = New-BTText -Text '$message_ps'; \$b = New-BTBinding -Children \$t1,\$t2${binding_logo}; \$v = New-BTVisual -BindingGeneric \$b; \$c = New-BTContent -Visual \$v; Submit-BTNotification -Content \$c"

powershell.exe -NoProfile -Command "$ps_script" 2>/dev/null &

exit 0
