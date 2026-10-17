# dotfiles (mise bootstrap 管理)

chezmoi から `mise bootstrap` へ移行した dotfiles。リポジトリ直下は `$HOME` のミラー構成で、
`[dotfiles]` が各ファイルを配置する(既定は symlink)。`dotfiles.root` は mise 既定の `~/.dotfiles`。

## 構成

| パス | 役割 |
|---|---|
| `.config/mise/conf.d/10-dotfiles.toml` | 全 OS 共通の設定(`[settings]` / `[tools]` / `[dotfiles]`) |
| `.config/mise/config.<env>.toml` | environment 別の上乗せ(下表) |
| `Documents/PowerShell/conf.d/*.ps1` | Windows の PowerShell 設定(copy で配置) |
| 上記以外 | `$HOME` 相対のファイル本体 |

`~/.config/mise/config.toml` は **管理しない**。omarchy の mise ラッパーや手動の `mise use -g` が
追記する machine-local ファイルで、conf.d と併読される。

## environment

`~/.config/mise/miserc.local.toml` で有効化する environment を宣言する(マシン固有のため repo には置かない)。
mise は `miserc.local.toml` を `miserc.toml` より優先して読み、マシン固有の選択には `.local` を使うのが公式の推奨
([miserc locations](https://mise.jdx.dev/configuration.html#miserc-locations))。
環境変数 `MISE_ENV` や `-E` はすべての miserc より優先されるため、miserc を変更したら
`MISE_ENV` を引き継いだ端末・マルチプレクサのセッションを開き直す。

| 軸 | 値 | 効果 |
|---|---|---|
| profile | `personal` / `work` | 個人用ツールの有無(`config.personal.toml`) |
| OS | `linux` / `windows` | OS 別の dotfiles(`config.linux.toml` / `config.windows.toml`) |
| class | `omarchy` / `wsldebian` | Linux のマシンクラス別ツール・nvim 設定 |

```sh
cp ~/.dotfiles/.config/mise/miserc.local.toml.example ~/.config/mise/miserc.local.toml
$EDITOR ~/.config/mise/miserc.local.toml   # 例: env = ["personal", "linux", "omarchy"]
```

未宣言のマシンでは共通設定のみが読まれ、profile / OS 別のツールと dotfiles は入らない。

## 新しいマシンのセットアップ

```sh
git clone https://github.com/atriumnook/dotfiles.git ~/.dotfiles && cd ~/.dotfiles
mkdir -p ~/.config/mise/conf.d
ln -s ~/.dotfiles/.config/mise/conf.d/10-dotfiles.toml ~/.config/mise/conf.d/
cp .config/mise/miserc.local.toml.example ~/.config/mise/miserc.local.toml   # 編集する
mise bootstrap --dry-run   # 実行内容の確認
mise bootstrap             # dotfiles の配置 → settings.json などの合成 → ツールのインストール
mise bootstrap status      # 結果の確認
```

`mise bootstrap` は dotfiles の適用とツールのインストール(`mise install` 相当)を1回で行う。
`config.<env>.toml` 自体も dotfiles として配置されるが、mise は配置した設定を読み直してから
残りを適用するので、1回で environment 別の dotfiles まで入る。グローバル設定(`~/.config/mise`)に
`mise trust` は要らない。

選んでいない environment の `config.<env>.toml`(例: Linux での `config.windows.toml`)について
`not trusted` の警告が出るが、適用には影響しない。

dotfiles だけを適用し直すときは `mise dot apply`(`mise dotfiles apply` の別名)を使う。

## settings.json の扱い

`~/.claude/settings.json` は Claude Code 自身が書き換える(`model` / `enabledPlugins` など)ため
symlink にしない。`merge = true` で、repo の `.claude/settings.json` にあるキーだけを実ファイルへ
反映する。アプリが追加したキーは保持され、repo にあるキーは `apply` で repo の値に戻る。

設定を repo に反映するときは、実ファイルの内容を `.claude/settings.json` へ手で取り込んで commit する。

## Windows への適用

```powershell
# 1. 旧 chezmoi が profile に注入したローダーを削除する(残すとローダーが二重になる)
$p = "$HOME\Documents\PowerShell\Microsoft.PowerShell_profile.ps1"
$c = Get-Content -Raw -LiteralPath $p
$c = $c -replace '(?ms)^# USER-CONFIG:START.*?^# USER-CONFIG:END\s*', ''
Set-Content -LiteralPath $p -Value $c -Encoding utf8
```

続けて「新しいマシンのセットアップ」を実施する。miserc は `env = ["personal", "windows"]`。

- symlink は Developer Mode が有効なら作成される。権限が無い場合、mise はファイルをコピーする
  (コピーの場合は repo 側を編集して `apply` する)。
- profile への追記は `# >>> mise:loader >>>` ブロックとして行われ、ブロック外の記述は保持される。
  適用時に行末が CRLF から LF に変わる場合があるが、PowerShell の動作には影響しない。
- Windows では chezmoi を移行完了まで残す想定。mise と同じファイルに両方から書かないこと。

## 切り戻し

移行元の chezmoi は `~/.local/share/chezmoi`(タグ `pre-mise-cutover`)に凍結してある。
**凍結時点の内容は古い**(`settings.json` などその後の編集を含まない)ため、`chezmoi apply` の前に
必ず現在の実ファイルを退避する。

```sh
mise dot unapply   # symlink / block を外す
chezmoi apply                     # 凍結時点の実ファイルへ戻る(要・事前退避)
```

mise 設定の復元用に、conf.d 分割前の `~/.config/mise` は `~/.config/mise.pre-confd-*` に退避される。

## omarchy との関係

- omarchy が管理するパス(`~/.config/hypr` など)は `[dotfiles]` に登録せず、`[history] exclude` で除外する。
- omarchy が `mise use -g` で追加するツールは machine-local の `~/.config/mise/config.toml` に入り、
  この repo を書き換えない。
- `apply` は symlink 化できない既存の実ファイルを既定で上書きしない(`--force` が必要)。
