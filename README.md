# dotfiles

Chezmoi で管理するdotfiles

## セットアップ

> 前提: [mise](https://mise.jdx.dev) をインストール済みであること

```bash
mise install chezmoi
chezmoi init https://github.com/<user>/dotfiles
chezmoi apply
mise install
```

## 初期設定

### gitconfig - user

ローカル Git 設定は `~/.gitconfig.local` に:

```ini
[user]
    name = Your Name
    email = your.email@example.com
```
