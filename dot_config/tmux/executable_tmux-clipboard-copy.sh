#!/bin/sh
# tmux-clipboard-copy: auto-detect platform and copy stdin to clipboard
#
# Install:
#   cp this file to ~/.config/tmux/tmux-clipboard-copy
#   chmod +x ~/.config/tmux/tmux-clipboard-copy

if [ -n "$WSL_DISTRO_NAME" ]; then
    clip.exe
elif [ "$(uname -s)" = "Darwin" ]; then
    pbcopy
elif [ -n "$WAYLAND_DISPLAY" ]; then
    wl-copy
elif command -v xclip >/dev/null 2>&1; then
    xclip -selection clipboard
elif command -v xsel >/dev/null 2>&1; then
    xsel --clipboard --input
else
    # Final fallback: just consume stdin (OSC 52 should handle the rest)
    cat > /dev/null
fi
