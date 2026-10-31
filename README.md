# dotfiles (mise bootstrap 管理)

chezmoi から `mise bootstrap` へ移行した dotfiles。リポジトリ直下のファイルは `$HOME` と同じ相対パスに置き、
`[dotfiles]` がそれぞれを `$HOME` に配置する(既定は symlink)。`dotfiles.root` は mise 既定の `~/.dotfiles`。

セットアップ・更新・切り戻しの手順は [SETUP.md](SETUP.md) を参照する。

## 構成

| パス | 役割 |
|---|---|
| `.config/mise/conf.d/10-dotfiles.toml` | 全 OS 共通の設定(`[settings]` / `[tools]` / `[dotfiles]`) |
| `.config/mise/config.<env>.toml` | environment 別の上乗せ(下表) |
| `.config/mise/miserc.toml` | マシンの状態から、有効にする environment を決める |
| `mise-link.sh` / `mise-link.ps1` | 上の3つを mise の設定ディレクトリ(`MISE_CONFIG_DIR`、既定は `~/.config/mise`)に link する |
| `setup.sh` / `setup.ps1` | mise の導入、clone、`mise-link`、profile の記録、`mise bootstrap` をまとめて行う |
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

有効にする environment は、`miserc.toml`([miserc](https://mise.jdx.dev/configuration.html#miserc-locations))が
マシンの状態から決める。人が決めるのは profile だけで、`setup.sh` が mise の設定ディレクトリに
`profile.personal` か `profile.work` として記録する。

| 軸 | 値 | 決め方 | 効果 |
|---|---|---|---|
| profile | `personal` / `work` | 記録した profile(どちらも無い、または両方あるときは選ばない) | 個人用ツールの有無(`config.personal.toml`) |
| OS | `linux` / `windows` | mise の `os()` | OS 別の dotfiles(`config.linux.toml` / `config.windows.toml`) |
| class | `omarchy` / `wsldebian` | `/usr/share/omarchy`(omarchy package が持つ)があれば `omarchy`、無い Linux は `wsldebian` | Linux のマシンクラス別ツール・nvim 設定 |
| module | `cli` / `personal-cli` | omarchy 以外の全マシンが `cli`、そのうち profile が `personal` のマシンが `personal-cli` | omarchy が提供するツールを補う |

その結果、マシンごとの `env` は次のとおりになる(Linux の行は `.github/scripts/env-test.sh`、Windows の行は
`.github/scripts/bootstrap-test.ps1` が検証する)。

| マシン | env |
|---|---|
| 個人 omarchy | `["personal", "linux", "omarchy"]` |
| 個人 WSL / Debian | `["personal", "linux", "wsldebian", "cli", "personal-cli"]` |
| 仕事 WSL / Debian | `["work", "linux", "wsldebian", "cli"]` |
| 個人 Windows | `["personal", "windows", "cli", "personal-cli"]` |

`miserc.local.toml` に `env` を書くと、`miserc.toml` が決めた `env` を丸ごと置き換える(一時的な上書き用で、
repo には置かない)。環境変数 `MISE_ENV` や `-E` はすべての miserc より優先されるため、`MISE_ENV` を
引き継いだ端末・マルチプレクサのセッションでは、profile を変えたら開き直す。

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
