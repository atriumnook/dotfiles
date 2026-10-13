# prompt-rail

入力欄の上に、このセッションのプロンプトを tick の列で並べる Claude Code の mod。
tick にマウスを乗せるとプロンプトとターンの要約をカードで表示し、クリックでその位置へジャンプする。

- 着想: [oikon48/prompt-rail](https://github.com/oikon48/prompt-rail)(MIT)。コードは流用せず書き直している
- デザイン: [beUI Preview Rail](https://beui.dev/components/motion/preview-rail) の細い tick と浮かぶカードを、端末のセルに置き換えた。tick は点字で、読んでいる位置だけ高く明るい(⡄ ⡄ ⡇ ⡄)。画面にまだ描かれていない行のプロンプトには移動できず、一度試すと tick が点1つ(⠄)になる
- 端末(TUI)専用。マウス操作は `"tui": "fullscreen"` が向く
- 番号のピルとターンの要約のアイコンに Nerd Font を使う。端末のフォントが Nerd Font でないと文字化けする

## 開発

```bash
claude --plugin-dir ~/.dotfiles/.claude/marketplace/plugins/prompt-rail   # 保存で読み込み直す
claude plugin validate ~/.dotfiles/.claude/marketplace/plugins/prompt-rail
claude plugin test ~/.dotfiles/.claude/marketplace/plugins/prompt-rail
```

トランスクリプト行へのスクロールはテストキットが応答しないため、クリックでの着地は実機で確認する。
