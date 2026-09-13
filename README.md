# dotfiles (mise bootstrap 管理)

chezmoi から `mise bootstrap` へ移行した dotfiles。ファイルは **home ミラー**構成
(リポジトリ内のパスが `$HOME` 相対に一致)で保持し、`[dotfiles]` の **symlink モード**で配置する。

## 構成

- リポジトリ直下 = `$HOME` のミラー(`.zshrc`, `.config/...`, `.claude/...` など)
- `.config/mise/config.toml` = mise グローバル設定(`[settings]` / `[tools]` / `[dotfiles]`)
- `.config/mise/config.<env>.toml` = 環境別の上乗せ設定
  - profile 軸: `config.personal.toml` / `config.work.toml`
  - マシンクラス軸: `config.omarchy.toml` / `config.wsldebian.toml`
- `dotfiles.root` = `~/.dotfiles`(mise 既定。リポジトリのクローン先も同じ)

## 環境選択(environment)

profile とマシンクラスを 2 軸で選ぶ。有効化する environment は、mise 公式推奨の
**`~/.config/mise/miserc.toml`**(他 config より先に読まれる)で宣言する。
これはマシン固有値なので共有せず、各マシンに置く(gitignore 済み)。

```sh
# セットアップ(マシンごとに一度)
cp ~/.dotfiles/.config/mise/miserc.toml.example ~/.config/mise/miserc.toml
$EDITOR ~/.config/mise/miserc.toml   # 例: env = ["personal", "omarchy"]
```

未宣言のマシンでは base のみロードされ、profile/クラス別ツールが入らないので注意。

- OS 差(Linux 限定ツール等)は `[tools]` の `os = "linux"` で表現
- WSL/Debian でのみ入れる CLI(bat/eza/lazygit/neovim/zoxide)と nvim 設定一式は `config.wsldebian.toml`
- omarchy が pacman 等で提供するものは mise に載せない(shim で隠さない)

## 操作

```sh
mise bootstrap dotfiles diff      # 適用差分の確認(read-only)
mise bootstrap dotfiles status    # 現状確認
mise bootstrap dotfiles apply     # symlink 適用(既存実ファイルの置換には別途対応が必要)
mise bootstrap --dry-run          # 全体の適用予定を確認
```

## omarchy デフォルトの保護

- omarchy 管理のパス/ツールは `[dotfiles]`/`[tools]` に登録しない(登録が無ければ触れない)
- `apply` は既存衝突ファイルを既定で上書きしない(`--force` 必須)
- `[history] exclude` で hypr など omarchy 所有パスを capture/autosave から除外

## 切り戻し

移行元 chezmoi は `~/.local/share/chezmoi`(タグ `pre-mise-cutover`)に温存。
問題時は当該 symlink を削除し `chezmoi apply` で実ファイルへ復元する。
