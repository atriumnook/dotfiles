$ErrorActionPreference = "Stop"

$ProfilePath = Join-Path `
    $HOME `
    "Documents\PowerShell\Microsoft.PowerShell_profile.ps1"

$ProfileDirectory = Split-Path `
    -Parent `
    $ProfilePath

New-Item `
    -ItemType Directory `
    -Path $ProfileDirectory `
    -Force |
    Out-Null

if (-not (Test-Path -LiteralPath $ProfilePath)) {
    New-Item `
        -ItemType File `
        -Path $ProfilePath `
        -Force |
        Out-Null
}

$Content = Get-Content `
    -Raw `
    -LiteralPath $ProfilePath `
    -ErrorAction SilentlyContinue

if ($null -eq $Content) {
    $Content = ""
}

# Replace an older copy of our own loader.
$Content = $Content -replace (
    '(?ms)^# USER-CONFIG:START.*?' +
    '^# USER-CONFIG:END\s*'
), ''

$Loader = @'

# USER-CONFIG:START - chezmoi-managed configuration loader
$ProfileConfigDirectory = Join-Path $PSScriptRoot "conf.d"

if (Test-Path -LiteralPath $ProfileConfigDirectory) {
    Get-ChildItem `
        -LiteralPath $ProfileConfigDirectory `
        -Filter "*.ps1" `
        -File |
        Sort-Object Name |
        ForEach-Object {
            . $_.FullName
        }
}
# USER-CONFIG:END
'@

$UpdatedContent = $Content.TrimEnd() +
    "`r`n" +
    $Loader.TrimStart()

Set-Content `
    -LiteralPath $ProfilePath `
    -Value $UpdatedContent `
    -Encoding utf8
