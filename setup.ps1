# setup.sh の Windows 版。新しいマシンのセットアップと、既存マシンの更新を行う。何度実行してもよい。
#   1. mise が無ければ winget で入れる
#   2. ~/.dotfiles を clone する(あれば upstream から fast-forward する)
#   3. mise-link.ps1 で mise の設定を link する(Developer Mode が必要)
#   4. profile を mise の設定ディレクトリに記録する(引数 > 記録済みの値 > 端末で尋ねる)
#   5. mise bootstrap を実行する
#
# usage: setup.ps1 [personal|work] [mise bootstrap の引数...](順不同)
#   --dry-run などは mise bootstrap にだけ効き、1〜4 は実行される
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/atriumnook/dotfiles/main/setup.ps1))) [personal|work]
#
# scriptblock として実行されることがあるため、exit ではなく throw で止める(exit は呼び出し元の
# pwsh ごと終了する)。
$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/atriumnook/dotfiles.git"
$Repo = Join-Path $HOME ".dotfiles"
$Dir = if ($env:MISE_CONFIG_DIR) { $env:MISE_CONFIG_DIR } else { Join-Path $HOME ".config\mise" }

# personal / work は位置を問わず profile とし、残りを mise bootstrap に渡す
$MachineProfile = @($args | Where-Object { $_ -in "personal", "work" }) | Select-Object -Last 1
$BootstrapArgs = @($args | Where-Object { $_ -notin "personal", "work" })

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git が無い。先に winget install Git.Git などで入れる"
}

if (-not (Get-Command mise -ErrorAction SilentlyContinue)) {
    winget install --id jdx.mise --exact --source winget --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget で mise を入れられなかった" }
    # winget は新しい端末の PATH にだけ反映するため、この session にも足す
    $env:PATH = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:PATH"
}

if (-not (Test-Path (Join-Path $Repo ".git"))) {
    git clone $RepoUrl $Repo
    if ($LASTEXITCODE -ne 0) { throw "git clone に失敗した" }
} else {
    # Windows PowerShell 5.1 は、Stop のまま native command の stderr をリダイレクトすると例外にする
    $ErrorActionPreference = "Continue"
    git -C $Repo rev-parse --abbrev-ref --symbolic-full-name '@{u}' *> $null
    $hasUpstream = $LASTEXITCODE -eq 0
    $ErrorActionPreference = "Stop"
    if ($hasUpstream) {
        git -C $Repo pull --ff-only
        if ($LASTEXITCODE -ne 0) { throw "git pull に失敗した" }
    } else {
        Write-Host "setup: $Repo のブランチに upstream が無いため、pull しない"
    }
}

& (Join-Path $Repo "mise-link.ps1")

$Personal = Join-Path $Dir "profile.personal"
$Work = Join-Path $Dir "profile.work"
if (-not $MachineProfile) {
    $hasPersonal = Test-Path $Personal
    $hasWork = Test-Path $Work
    if ($hasPersonal -and -not $hasWork) {
        $MachineProfile = "personal"
    } elseif ($hasWork -and -not $hasPersonal) {
        $MachineProfile = "work"
    } elseif ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        $choices = [System.Management.Automation.Host.ChoiceDescription[]] @("&personal", "&work")
        $MachineProfile = @("personal", "work")[$Host.UI.PromptForChoice("profile", "このマシンの profile は?", $choices, -1)]
    } else {
        throw "profile が決まっていない。setup.ps1 personal か setup.ps1 work で指定する"
    }
}
Remove-Item -Force -ErrorAction SilentlyContinue $Personal, $Work
New-Item -ItemType File -Force (Join-Path $Dir "profile.$MachineProfile") | Out-Null
Write-Host "setup: profile: $MachineProfile"

if (Test-Path (Join-Path $Dir "miserc.local.toml")) {
    Write-Host "setup: $Dir\miserc.local.toml の env が、miserc.toml の決める env より優先される。不要なら削除する"
}

mise bootstrap @BootstrapArgs
if ($LASTEXITCODE -ne 0) { throw "mise bootstrap に失敗した" }
