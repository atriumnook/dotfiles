# mise shell integration
$MiseCommand = Get-Command mise.exe -ErrorAction SilentlyContinue

if ($null -ne $MiseCommand) {
    (& $MiseCommand.Source activate pwsh) |
        Out-String |
        Invoke-Expression
}
