# セットアップと運用の手順

設定の仕組みと environment の選び方は [README.md](README.md) を参照する。

## 新しいマシンのセットアップ

Linux / WSL:

```sh
git clone https://github.com/atriumnook/dotfiles.git ~/.dotfiles && cd ~/.dotfiles
mkdir -p ~/.config/mise/conf.d
ln -s ~/.dotfiles/.config/mise/conf.d/10-dotfiles.toml ~/.config/mise/conf.d/
cp .config/mise/miserc.local.toml.example ~/.config/mise/miserc.local.toml
$EDITOR ~/.config/mise/miserc.local.toml   # env を README の「environment」の表に合わせる
mise dot apply             # config.<env>.toml を配置して読み直し、environment 別の dotfiles まで配置する
mise bootstrap --dry-run   # 実行内容の確認
mise bootstrap             # settings.json などを合成し、ツールをインストールする
mise bootstrap status      # 結果の確認
```

Windows(PowerShell。旧 chezmoi から移行するマシンでは、先に「Windows への適用」を行う):

```powershell
git clone https://github.com/atriumnook/dotfiles.git "$HOME\.dotfiles"; cd "$HOME\.dotfiles"
New-Item -ItemType Directory -Force "$HOME\.config\mise\conf.d" | Out-Null
New-Item -ItemType SymbolicLink -Path "$HOME\.config\mise\conf.d\10-dotfiles.toml" `
    -Target "$HOME\.dotfiles\.config\mise\conf.d\10-dotfiles.toml"   # Developer Mode が必要
Copy-Item .config\mise\miserc.local.toml.example "$HOME\.config\mise\miserc.local.toml"
notepad "$HOME\.config\mise\miserc.local.toml"   # env = ["personal", "windows", "cli", "personal-cli"]
mise dot apply
mise bootstrap --dry-run
mise bootstrap
mise bootstrap status
```

`mise bootstrap` は dotfiles の適用とツールのインストール(`mise install` 相当)を1回で行うが、
設定は開始時に1度だけ読む。`config.<env>.toml` 自体も dotfiles として配置されるため、
それが未配置のまま `mise bootstrap` を実行すると、その回では environment 別の dotfiles とツールが入らない。
`mise dot apply` は mise 自身の設定を先に配置して読み直すので、先に実行しておくと
`mise bootstrap` が environment 別の設定まで読んだ状態で始まる。
グローバル設定(`~/.config/mise`)に `mise trust` は要らない。

dotfiles だけを適用し直すときは `mise dot apply`(`mise dotfiles apply` の別名)を使う。

### Cursor CLI(個人用の omarchy 以外のマシン)

Cursor CLI は mise ではなく公式インストーラーで入れる。mise のレジストリ定義は同梱の `node` と `rg` を
含むディレクトリごと PATH に追加し、mise で入れた node と ripgrep より先に解決されるため。
公式インストーラーは `~/.local/bin` に `cursor-agent` と `agent` だけを置き、自動で更新する。

```sh
curl https://cursor.com/install -fsS | bash          # Linux / WSL
```

```powershell
irm 'https://cursor.com/install?win32=true' | iex    # Windows
```

以前 mise で入れていたマシンでは、`mise uninstall --all cursor-cli` で mise 側を削除する。
omarchy 機では omarchy が Cursor CLI を入れる(公式インストーラーで入っていれば、それを使う)。

## 既存マシンの更新

```sh
cd ~/.dotfiles && git pull
mise dot apply             # 新しい config.<env>.toml があれば配置して読み直す
mise bootstrap --dry-run
mise bootstrap
```

environment が増えたとき(例: module の `cli` / `personal-cli`)は、`git pull` の前に
`miserc.local.toml` の `env` を README の表に合わせて更新する。`env` に入れていない environment のツールは、
`mise bootstrap` を実行しても入らない。

### `~/.gitconfig` を machine-local に移す(1回だけ)

`~/.gitconfig` が repo の `.gitconfig` への symlink になっているマシンでは、`git pull` の前に
symlink を実ファイルに置き換える。symlink のままだと、`git pull` 後に参照先が無くなり、
`mise bootstrap` も symlink への書き込みをエラーにする。

```sh
cp --remove-destination "$(readlink -f ~/.gitconfig)" ~/.gitconfig   # symlink を実ファイルに置き換える
cat ~/.gitconfig.local >> ~/.gitconfig 2>/dev/null && rm ~/.gitconfig.local   # 旧 .gitconfig.local を統合する
$EDITOR ~/.gitconfig   # このマシンの credential・user だけを残し、共通設定の節は削る
cd ~/.dotfiles && git pull && mise dot apply && mise bootstrap   # 先頭に共通設定の [include] が入る
git config --show-origin --list | grep dotfiles.gitconfig   # 共通設定が読まれていることを確認する
```

Windows では `~/.gitconfig` を手で実ファイルにしてから同じ流れで行う。

## Windows への適用

```powershell
# 1. 旧 chezmoi が profile に注入したローダーを削除する(残すとローダーが二重になる)
$p = "$HOME\Documents\PowerShell\Microsoft.PowerShell_profile.ps1"
$c = Get-Content -Raw -LiteralPath $p
$c = $c -replace '(?ms)^# USER-CONFIG:START.*?^# USER-CONFIG:END\s*', ''
Set-Content -LiteralPath $p -Value $c -Encoding utf8
```

続けて「新しいマシンのセットアップ」の Windows の手順を実施する。

- symlink は Developer Mode が有効なら作成される。権限が無い場合、mise はファイルをコピーする
  (コピーの場合は repo 側を編集して `apply` する)。最初の `10-dotfiles.toml` は手で配置するため、
  Developer Mode が無い場合は `New-Item -ItemType SymbolicLink` の代わりに `Copy-Item` でコピーする。
- profile への追記は `# >>> mise:loader >>>` ブロックとして行われ、ブロック外の記述は保持される。
  適用時に行末が CRLF から LF に変わる場合があるが、PowerShell の動作には影響しない。
- Windows では chezmoi を移行完了まで残す想定。mise と chezmoi の両方から同じファイルに書かないこと。

## 切り戻し

移行元の chezmoi は `~/.local/share/chezmoi`(タグ `pre-mise-cutover`)に凍結してある。
**凍結時点の内容は古い**(`settings.json` などその後の編集を含まない)ため、`chezmoi apply` の前に
必ず現在の実ファイルを退避する。

```sh
mise dot unapply   # symlink / block を外す
chezmoi apply      # 凍結時点の実ファイルへ戻る(事前に現在の実ファイルを退避しておく)
```

mise 設定の復元用に、conf.d 分割前の `~/.config/mise` は `~/.config/mise.pre-confd-*` に退避される。
