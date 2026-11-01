# prompt-rail

transcript の右端に、このセッションのプロンプトを tick(`-`)の列で並べる Claude Code の mod。ブラウザのスクロールバーのように使う。
tick にマウスを乗せるとプロンプトとターンの要約をカードで表示し、クリックでそのプロンプトの行へジャンプする。

- tick は古い順に上から等間隔に並び、最新が一番下に来る。行数より多いプロンプトは同じ行にまとめ(`=`)、押すたびに次のプロンプトへ移る
- 画面に見えている範囲の tick は Claude の色で、読んでいる位置は太字になる
- まだ描かれていない古い行へは、描かれた行を伝って近づく。遠いと数秒かかり、その間は目標の tick が黄色になる。入力欄の上には何も出さない

## 導入

要件:

- 端末(TUI)の fullscreen 専用(`"tui": "fullscreen"` か `CLAUDE_CODE_NO_FLICKER=1`)。fullscreen でないと transcript の行の外に描けないため、何も表示しない
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
        "repo": "atriumnook/dotfiles"
      }
    }
  }
}
```

dotfiles を使わない環境では、この2つを `~/.claude/settings.json` に書くか、次のコマンドで登録して入れる。

```bash
claude plugin marketplace add atriumnook/dotfiles
claude plugin install prompt-rail@atnook-dotfiles
```

`claude plugin list` で `prompt-rail@atnook-dotfiles` が `Status: ✔ enabled` なら導入済み。

## 更新

```bash
claude plugin marketplace update atnook-dotfiles
claude plugin update prompt-rail@atnook-dotfiles   # 次のセッションか /reload-plugins で反映
```

`plugin.json` に `version` を書いていないので、push した commit がそのまま新しい版になる。

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
