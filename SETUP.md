# セットアップと運用の手順

設定の仕組みと environment の選び方は [README.md](README.md) を参照する。

## 新しいマシンのセットアップ

前提は git だけ。`setup.sh` / `setup.ps1` が mise を入れ(Linux は mise.run で `~/.local/bin` に、Windows は
winget で)、repo を `~/.dotfiles` に clone し、`mise-link` を実行してから `mise bootstrap` を実行する。
profile(`personal` / `work`)は引数で渡す。省略すると、記録済みの値を使い、無ければ端末で尋ねる
(端末が無ければ止まる)。それ以外の引数は `mise bootstrap` にそのまま渡る(例: `--dry-run`)。
`--dry-run` は `mise bootstrap` にだけ効き、pull・link・profile の記録は行われる。

Linux / WSL:

```sh
curl -fsSL https://raw.githubusercontent.com/atriumnook/dotfiles/main/setup.sh | sh -s -- personal
```

Windows(PowerShell。Developer Mode が必要。旧 chezmoi から移行するマシンでは、先に「Windows への適用」を行う):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/atriumnook/dotfiles/main/setup.ps1))) personal
```

結果は `mise bootstrap status` で確認する。`mise bootstrap` は dotfiles の適用とツールのインストール
(`mise install` 相当)を1回で行う。
設定は開始時に1度だけ読むため、`config.<env>.toml` は `[dotfiles]` ではなく `mise-link` で先に
link しておく。`[dotfiles]` の配置先は `~/` か絶対パスに固定されるため、`MISE_CONFIG_DIR` で
設定ディレクトリを変えている環境(コンテナなど)に合わせられない。`mise-link` はそれに従う。
グローバル設定に `mise trust` は要らない。

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
~/.dotfiles/setup.sh                 # Windows では & "$HOME\.dotfiles\setup.ps1"
~/.dotfiles/setup.sh --dry-run       # mise bootstrap の実行内容を確認する(pull と link は行われる)
```

upstream のあるブランチなら fast-forward し、新しい `config.<env>.toml` を link してから `mise bootstrap` を
実行する。environment の決め方が変わっても、マシンごとの編集は要らない。

### `miserc.local.toml` から移行する(1回だけ)

`miserc.local.toml` で env を宣言していたマシンでは、profile を記録してから `miserc.local.toml` を削除する。
`miserc.local.toml` が残っていると、`miserc.toml` の決める env より優先される。

```sh
cd ~/.dotfiles && git pull
~/.dotfiles/setup.sh personal --dry-run   # profile を記録する(仕事用のマシンは work)
d=${MISE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/mise}
before=$(mise config ls) && mv "$d/miserc.local.toml" "$d/miserc.local.toml.bak" &&
  after=$(mise config ls) && [ "$before" = "$after" ] &&
  rm "$d/miserc.local.toml.bak"   # 読まれる設定が同じなら削除する。違えば .bak を戻して見直す
```

### `~/.gitconfig` を machine-local に移す(1回だけ)

`~/.gitconfig` が repo の `.gitconfig` への symlink になっているマシンでは、`git pull` の前に
symlink を実ファイルに置き換える。symlink のままだと、`git pull` 後に参照先が無くなり、
`mise bootstrap` も symlink への書き込みをエラーにする。

```sh
cp --remove-destination "$(readlink -f ~/.gitconfig)" ~/.gitconfig   # symlink を実ファイルに置き換える
cat ~/.gitconfig.local >> ~/.gitconfig 2>/dev/null && rm ~/.gitconfig.local   # 旧 .gitconfig.local を統合する
$EDITOR ~/.gitconfig   # このマシンの credential・user だけを残し、共通設定の節は削る
~/.dotfiles/setup.sh   # 先頭に共通設定の [include] が入る
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
  (コピーの場合は repo 側を編集して `apply` する)。`mise-link.ps1` は symlink だけを作るので、
  Developer Mode が無い場合は、同じファイルを `Copy-Item` でコピーし、`git pull` のたびにコピーし直す。
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
