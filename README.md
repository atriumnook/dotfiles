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

## 初期設定

ローカル Git 設定は `~/.gitconfig.local` に記載:

```ini
[user]
    name = Your Name
    email = your.email@example.com
```
