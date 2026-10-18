# prompt-rail

入力欄の上に、このセッションのプロンプトを tick の列で並べる Claude Code の mod。
tick にマウスを乗せるとプロンプトとターンの要約をカードで表示し、クリックでそのプロンプトの位置へ移動する。

- tick は点字で、画面に見えている一番古いプロンプトの tick だけ高く明るい(⡄ ⡄ ⡇ ⡄)
- 画面にまだ描かれていない行のプロンプトには移動できない。試した tick は点1つ(⠄)になり、その行が描かれると元に戻る

## 導入

要件:

- 端末(TUI)専用。マウスで操作するなら `"tui": "fullscreen"` にする
- 番号のピルとターンの要約のアイコンに Nerd Font を使うため、端末のフォントが Nerd Font でないと文字化けする

この dotfiles を適用したマシンでは手作業は要らない。`.claude/settings.json` の次の2つにより、
Claude Code の起動時に marketplace が GitHub から取り込まれ、prompt-rail が有効になる。

```json
{
  "enabledPlugins": { "prompt-rail@atnook-dotfiles": true },
  "extraKnownMarketplaces": {
    "atnook-dotfiles": {
      "source": {
        "source": "github",
        "repo": "atriumnook/dotfiles",
        "path": ".claude/marketplace/.claude-plugin/marketplace.json",
        "sparsePaths": [".claude/marketplace"]
      }
    }
  }
}
```

dotfiles を使わない環境では、この2つを `~/.claude/settings.json` に書く。
marketplace.json がリポジトリ直下に無いため、`claude plugin marketplace add atriumnook/dotfiles` では登録できない。

`claude plugin list` で `prompt-rail@atnook-dotfiles` が `Status: ✔ enabled` なら導入済み。

## 更新

```bash
claude plugin marketplace update atnook-dotfiles   # 次のセッションか /reload-plugins で反映
```

## 開発

作業中のファイルを直接読み込んで確かめる。

```bash
claude --plugin-dir ~/.dotfiles/.claude/marketplace/plugins/prompt-rail   # 保存で読み込み直す
claude plugin validate ~/.dotfiles/.claude/marketplace/plugins/prompt-rail
claude plugin test ~/.dotfiles/.claude/marketplace/plugins/prompt-rail
```

クリックでの移動はテストで確かめられないため、実機で確認する。

Claude Code は GitHub から取り込んだ複製を読むので、編集は push しないと導入済みの環境に反映されない。
push したら「更新」の手順で取り込む。
