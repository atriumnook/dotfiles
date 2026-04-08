# dotfiles

Chezmoi で管理する dotfiles（Omarchy / WSL / Debian）

## セットアップ

> 前提: [mise](https://mise.jdx.dev) をインストール済みであること

```bash
mise install chezmoi
chezmoi init https://github.com/atriumnook/dotfiles
chezmoi apply
mise install
```

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
