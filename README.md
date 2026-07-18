# dotfiles

Chezmoi で管理する dotfiles（Omarchy / WSL / Debian）

## セットアップ

> 前提: [mise](https://mise.jdx.dev) をインストール済みであること

秘密ファイル（cli-proxy-api の API キー等）は age で暗号化されているため、
先に Bitwarden のセキュアノート `chezmoi-age-key` から age 秘密鍵を復元する。

```bash
mise install chezmoi bitwarden
export BW_SESSION=$(bw unlock --raw)   # 未ログインなら先に bw login
mkdir -p ~/.config/chezmoi
bw get notes chezmoi-age-key > ~/.config/chezmoi/key.txt
chmod 600 ~/.config/chezmoi/key.txt

chezmoi init https://github.com/atriumnook/dotfiles
chezmoi apply
mise install
```

Windows など秘密ファイルを配布しないマシン（`.chezmoiignore.tmpl` で除外済み）では鍵の復元は不要。

## Windows Terminal

設定ファイルは `windows-terminal/settings.json` で管理。chezmoi apply では自動配備されないため、Windows 側へは手動でコピーする。

PowerShell から:

```powershell
Copy-Item \\wsl.localhost\Ubuntu\home\user\.local\share\chezmoi\windows-terminal\settings.json `
  "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"
```

## Git

ローカル Git 設定は `~/.gitconfig.local` に記載:

```ini
[user]
    name = Your Name
    email = your.email@example.com
```
