# 素の HOME で SETUP.md の新規セットアップを再現し、mise bootstrap の結果を検証する(Windows 用)。
# 方式と環境変数は bootstrap-test.sh と同じ。
#
# usage: bootstrap-test.ps1 -Method <link|config-dir>
param(
    [Parameter(Mandatory)]
    [ValidateSet("link", "config-dir")]
    [string] $Method
)

$ErrorActionPreference = "Continue"
$Repo = Join-Path $HOME ".dotfiles"
$Results = [System.Collections.Generic.List[string]]::new()
$Failed = $false

# ブロックの最後の出力を合否とし、それ以外の出力はログに出す
function Check([string] $Name, [scriptblock] $Block) {
    Write-Host "::group::$Name"
    $ok = $false
    try {
        $out = @(& $Block)
        if ($out.Count -gt 0) {
            $out[0..($out.Count - 1)] | Select-Object -SkipLast 1 | Out-Host
            $ok = [bool] $out[-1]
        }
    } catch {
        Write-Host $_
    }
    if ($ok) {
        $Results.Add("| ✅ | $Name |")
    } else {
        $Results.Add("| ❌ | $Name |")
        $script:Failed = $true
    }
    Write-Host "::endgroup::"
}

function Invoke-Mise {
    & $script:Mise @args 2>&1 | Out-Host
    $LASTEXITCODE -eq 0
}

# 新しい端末を開いた状態を再現する(profile を読み込む新しい pwsh)
function Invoke-NewPwsh([string] $Command) {
    $errFile = New-TemporaryFile
    $out = pwsh -NoLogo -Command $Command 2>$errFile
    $code = $LASTEXITCODE
    $err = Get-Content -Raw $errFile
    Remove-Item $errFile
    [pscustomobject]@{ Out = $out; Err = $err; Code = $code }
}

# checkout 先にいると、mise がそこの .config/mise をプロジェクトの設定として読む
Set-Location $HOME

# --- mise のインストール ---
$v = $env:TEST_MISE_VERSION
$zip = Join-Path $env:RUNNER_TEMP "mise.zip"
Invoke-WebRequest "https://github.com/jdx/mise/releases/download/v$v/mise-v$v-windows-x64.zip" -OutFile $zip
$dist = Join-Path $env:LOCALAPPDATA "mise-dist"
Expand-Archive $zip $dist -Force
$Mise = Join-Path $dist "mise\bin\mise.exe"
# インストーラー(winget など)と同じく、新しい端末から mise が見えるようにする
$env:PATH = "$(Split-Path $Mise);$env:PATH"
& $Mise --version

Copy-Item -Recurse -Force $env:GITHUB_WORKSPACE $Repo

# --- セットアップ(SETUP.md の手順) ---
$MiseConfig = Join-Path $HOME ".config\mise"
switch ($Method) {
    "link" {
        New-Item -ItemType Directory -Force (Join-Path $MiseConfig "conf.d") | Out-Null
        New-Item -ItemType SymbolicLink -Path (Join-Path $MiseConfig "conf.d\10-dotfiles.toml") `
            -Target (Join-Path $Repo ".config\mise\conf.d\10-dotfiles.toml") | Out-Null
        Set-Content (Join-Path $MiseConfig "miserc.local.toml") "env = $env:TEST_MISE_ENV"
        Check "mise dot apply" { Invoke-Mise dot apply -y }
        Check "mise bootstrap" { Invoke-Mise bootstrap -y }
    }
    "config-dir" {
        # bootstrap-test.sh の同じ箇所を参照
        $conf = Join-Path $Repo ".config\mise\conf.d\10-dotfiles.toml"
        $text = Get-Content -Raw $conf
        Set-Content $conf ($text -replace "(?s)# mise 設定自身の配置.*$", "")
        Add-Content (Join-Path $Repo ".gitignore") "/.config/mise/config.toml"
        git -C $Repo -c user.name=ci -c user.email=ci@localhost commit -qam "ci: config-dir 方式の変更"
        Set-Content (Join-Path $Repo ".config\mise\miserc.local.toml") "env = $env:TEST_MISE_ENV"
        $origin = git -C $Repo remote get-url origin
        Check "mise bootstrap --config-dir" {
            Invoke-Mise bootstrap --from $origin --from-dir $Repo --config-dir .config/mise -y
        }
    }
}

# --- 検証 ---
Check "設定どおりに収束している(bootstrap status --missing)" { Invoke-Mise bootstrap status --missing }

Check "2回目の bootstrap は dotfiles を変更しない" {
    $out = & $Mise bootstrap -y 2>&1 | Out-String
    $out
    ($LASTEXITCODE -eq 0) -and ($out -notmatch "(?m)^mise (files|edits): (applied|created|removed)")
}

Check "新しい pwsh の起動で stderr に何も出ない" {
    $r = Invoke-NewPwsh "exit 0"
    $r.Err
    ($r.Code -eq 0) -and [string]::IsNullOrWhiteSpace($r.Err)
}

Check "新しい pwsh で主なコマンドが使える" {
    $r = Invoke-NewPwsh @'
$missing = "mise", "git", "nvim", "starship", "delta", "fzf", "rg", "fd" |
    Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }
if ($missing) { "not found: $missing"; exit 1 }
'@
    $r.Out
    $r.Code -eq 0
}

& $Mise use -g jq@1 *> $null
Check "mise use -g で repo が変更されない" {
    $out = git -C $Repo status --porcelain --untracked-files=all
    $out
    [string]::IsNullOrEmpty($out)
}

Write-Host "::group::診断情報"
& $Mise config ls
Get-ChildItem -Force (Join-Path $HOME ".config") -ErrorAction SilentlyContinue | Out-Host
Write-Host "::endgroup::"

$summary = @("### windows / $Method", "", "| | 検証 |", "|---|---|") + $Results
Add-Content $env:GITHUB_STEP_SUMMARY ($summary -join "`n")

if ($Failed) { exit 1 }
