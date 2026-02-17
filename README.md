# dotfiles

Chezmoi で管理する dotfiles（Omarchy / WSL 対応）

## セットアップ

> 前提: [mise](https://mise.jdx.dev) をインストール済みであること

```bash
mise install chezmoi
chezmoi init https://github.com/<user>/dotfiles
chezmoi apply
mise install
```

## 環境別の差分

`mise/config.toml.tmpl` は chezmoi テンプレートで環境を判別し、Omarchy にプリインストールされているツールを WSL 環境でのみ mise 経由でインストールします。

## 初期設定

ローカル Git 設定は `~/.gitconfig.local` に記載:

```ini
[user]
    name = Your Name
    email = your.email@example.com
```
