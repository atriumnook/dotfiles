# dotfiles (mise bootstrap 管理)

chezmoi から `mise bootstrap` へ移行した dotfiles。リポジトリ直下のファイルは `$HOME` と同じ相対パスに置き、
`[dotfiles]` がそれぞれを `$HOME` に配置する(既定は symlink)。`dotfiles.root` は mise 既定の `~/.dotfiles`。

セットアップ・更新・切り戻しの手順は [SETUP.md](SETUP.md) を参照する。

## 構成

| パス | 役割 |
|---|---|
| `.config/mise/conf.d/10-dotfiles.toml` | 全 OS 共通の設定(`[settings]` / `[tools]` / `[dotfiles]`) |
| `.config/mise/config.<env>.toml` | environment 別の上乗せ(下表) |
| `Documents/PowerShell/conf.d/*.ps1` | Windows の PowerShell 設定(copy で配置) |
| `.github/` | 素の環境で `mise bootstrap` を検証する CI(`$HOME` には配置しない) |
| 上記以外 | `$HOME` 相対のファイル本体 |

`~/.config/mise/config.toml` は **管理しない**。omarchy の mise ラッパーや手動の `mise use -g` が
追記する machine-local ファイルで、conf.d と併読される。

`~/.gitconfig` も **管理しない**。`git config --global`(`gh auth setup-git` や omarchy の user 設定を含む)が
書き込む machine-local ファイルで、credential や user などマシンごとの値を書く。repo の共通設定
(`.config/git/dotfiles.gitconfig`)は、`[dotfiles]` が先頭に入れる `[include]` の1行で読み込まれる。
git は後に書いた値を優先するので、`~/.gitconfig` に書いた値が共通設定より優先される。

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
| module | `cli` / `personal-cli` | omarchy 以外のマシンで、omarchy が提供するツールを補う。`cli` は omarchy 以外の全マシン、`personal-cli` はそのうち profile が `personal` のマシンが選ぶ |

マシンごとの `env` は次のとおり。

| マシン | env |
|---|---|
| 個人 omarchy | `["personal", "linux", "omarchy"]` |
| 個人 WSL / Debian | `["personal", "linux", "wsldebian", "cli", "personal-cli"]` |
| 仕事 WSL / Debian | `["work", "linux", "wsldebian", "cli"]` |
| 個人 Windows | `["personal", "windows", "cli", "personal-cli"]` |

`env` を宣言していないマシンでは共通設定だけが読まれ、environment 別のツールと dotfiles は入らない。

## settings.json の扱い

`~/.claude/settings.json` は Claude Code 自身が書き換える(`model` / `enabledPlugins` など)ため
symlink にしない。`merge = true` で、repo の `.claude/settings.json` にあるキーだけを実ファイルへ
反映する。アプリが追加したキーは保持され、repo にあるキーは `apply` で repo の値に戻る。

設定を repo に反映するときは、実ファイルの内容を `.claude/settings.json` へ手で取り込んで commit する。

## omarchy との関係

- omarchy が管理するパス(`~/.config/hypr` など)は `[dotfiles]` に登録せず、`[history] exclude` で除外する。
- omarchy が `mise use -g` で追加するツールは machine-local の `~/.config/mise/config.toml` に入り、
  この repo を書き換えない。
- omarchy が pacman / `omarchy-mise-install` で提供するツール(node, fd, claude, codex など)は共通設定に
  書かず、module(`config.cli.toml` / `config.personal-cli.toml`)に置く。共通設定や profile に書くと、
  omarchy 機では mise が入れたものが omarchy のラッパーや `/usr/bin` より PATH の前に来て、
  omarchy の管理を上書きする。
- `apply` は symlink 化できない既存の実ファイルを既定で上書きしない(`--force` が必要)。
