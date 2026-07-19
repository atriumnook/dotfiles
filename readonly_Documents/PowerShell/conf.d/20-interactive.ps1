# Prompt and line editing require an interactive console with unredirected I/O.
# Skip them for Codex Actions, CI, and other non-interactive hosts.
$IsInteractiveConsole =
    $Host.Name -eq "ConsoleHost" -and
    -not [Console]::IsInputRedirected -and
    -not [Console]::IsOutputRedirected

if (-not $IsInteractiveConsole) {
    return
}

# Starship prompt
$StarshipCommand = Get-Command starship.exe -ErrorAction SilentlyContinue

if ($null -ne $StarshipCommand -and $env:TERM -ne "dumb") {
    Invoke-Expression (& $StarshipCommand.Source init powershell)
}

# PSReadLine
# PSReadLine is already loaded by the interactive PowerShell host.
# Do not import it here because Coreutils has replaced PSConsoleHostReadLine.

Set-PSReadLineOption `
    -EditMode Emacs `
    -BellStyle None `
    -PredictionSource HistoryAndPlugin `
    -PredictionViewStyle InlineView `
    -HistorySearchCursorMovesToEnd `
    -HistoryNoDuplicates

# Completion
Set-PSReadLineKeyHandler `
    -Key Tab `
    -Function MenuComplete

Set-PSReadLineKeyHandler `
    -Key Shift+Tab `
    -Function Complete

# Prefix-aware history navigation
Set-PSReadLineKeyHandler `
    -Key UpArrow `
    -Function HistorySearchBackward

Set-PSReadLineKeyHandler `
    -Key DownArrow `
    -Function HistorySearchForward

# History
Set-PSReadLineKeyHandler `
    -Chord Ctrl+r `
    -Function ReverseSearchHistory

Set-PSReadLineKeyHandler `
    -Chord Ctrl+p `
    -Function PreviousHistory

Set-PSReadLineKeyHandler `
    -Chord Ctrl+n `
    -Function NextHistory

# Emacs / zsh-like editing
Set-PSReadLineKeyHandler `
    -Chord Ctrl+a `
    -Function BeginningOfLine

Set-PSReadLineKeyHandler `
    -Chord Ctrl+e `
    -Function EndOfLine

Set-PSReadLineKeyHandler `
    -Chord Ctrl+w `
    -Function BackwardKillWord

Set-PSReadLineKeyHandler `
    -Chord Ctrl+u `
    -Function BackwardDeleteLine

Set-PSReadLineKeyHandler `
    -Chord Ctrl+k `
    -Function ForwardDeleteLine

Set-PSReadLineKeyHandler `
    -Chord Ctrl+y `
    -Function Yank

Set-PSReadLineKeyHandler `
    -Chord Ctrl+l `
    -Function ClearScreen

Set-PSReadLineKeyHandler `
    -Chord Ctrl+d `
    -Function DeleteCharOrExit
