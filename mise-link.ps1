# mise-link.sh の Windows 版。symlink の作成には Developer Mode(または管理者権限)が必要。
$ErrorActionPreference = "Stop"

$Repo = $PSScriptRoot
$Dir = if ($env:MISE_CONFIG_DIR) { $env:MISE_CONFIG_DIR } else { Join-Path $HOME ".config\mise" }

New-Item -ItemType Directory -Force (Join-Path $Dir "conf.d") | Out-Null
New-Item -ItemType SymbolicLink -Force -Path (Join-Path $Dir "conf.d\10-dotfiles.toml") `
    -Target (Join-Path $Repo ".config\mise\conf.d\10-dotfiles.toml") | Out-Null
Get-ChildItem (Join-Path $Repo ".config\mise\config.*.toml") | ForEach-Object {
    New-Item -ItemType SymbolicLink -Force -Path (Join-Path $Dir $_.Name) -Target $_.FullName | Out-Null
}
Write-Host "linked mise config into $Dir"
