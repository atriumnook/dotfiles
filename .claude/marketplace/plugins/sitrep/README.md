# sitrep

入力欄の上に、作業の状況を4行のカードで出す Claude Code の mod。
本人が口を挟む必要があるかを一目で分かるように、カードの色を andon に倣って変える。

```
╭───────────────────────────────────────────────────────────╮
│  ● DECIDE  sitrep                  ✎ 3   ✓ npm test   0: hide │
│ NOW     gitconfig を include 方式に分割済み                  │
│ OPEN    · 未検証の変更 a.ts                                  │
│         · macOS では未確認                                   │
│ DECIDE  既存の symlink をどうするか                          │
│         1: include で進める   2: symlink に戻す              │
│ NEXT    3: commit する                                       │
╰───────────────────────────────────────────────────────────╯
```

- `NOW` は作業の現在地、`OPEN` は未確認の点(置いた仮定・確かめられなかったこと・残るリスク)、`DECIDE` は本人にしか決められない判断、`NEXT` は次の一手
- 色: 緑 `ON TRACK`、黄 `REVIEW`(未確認がある)、赤 `DECIDE`(判断待ち)・`FAILED`(検証が失敗)。ターンの最中は `◆ WORKING` の1行だけを出す
- 入力欄が空のとき `1`〜`4` を押すと、そのプロンプトが下書きとして入力欄に入る。送信は自分で Enter を押す。`0` で次のレポートまでカードを隠す。一番上の候補は Tab でも取れる

情報源は2つに分けている。

- 編集したファイル・最後の検証コマンドの成否・その後に編集した未検証のファイルは、ツールの記録からモデルを使わずに拾う(メインループのみ)
- `NOW`・`OPEN`・`DECIDE`・`NEXT` は、ターンの終わりにセッションを fork して書かせる。fork はセッションの prompt cache を共有するので、短い返答1回ぶんで済む
- 色はモデルに聞かず両方から決める。検証が失敗していれば、モデルが何と言っても緑にならない

検証コマンドとして数えるのは `npm test`・`pytest`・`tsc`・`shellcheck`・`bats`・`claude plugin test` などの一覧に一致したものだけで、表示するのも一致した語だけ(コマンドに含まれるトークンなどは出さない)。

## 導入

要件:

- 端末(TUI)と desktop の入力欄の上に出る。他の画面には出ない
- 回答が 80 文字以上のターンごとに fork を1回使う

この dotfiles を適用したマシンでは手作業は要らない。`.claude/settings.json` の次の2つにより、
Claude Code の起動時に marketplace が GitHub から取り込まれ、sitrep が有効になる。

```json
{
  "enabledPlugins": { "sitrep@atnook-dotfiles": true },
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
claude plugin install sitrep@atnook-dotfiles
```

`claude plugin list` で `sitrep@atnook-dotfiles` が `Status: ✔ enabled` なら導入済み。

## 更新

```bash
claude plugin marketplace update atnook-dotfiles
claude plugin update sitrep@atnook-dotfiles        # 次のセッションか /reload-plugins で反映
```

`plugin.json` に `version` を書いていないので、push した commit がそのまま新しい版になる。

## 開発

作業中のファイルを直接読み込んで確かめる。

```bash
claude --plugin-dir ~/.dotfiles/.claude/marketplace/plugins/sitrep   # 保存で読み込み直す
claude plugin validate ~/.dotfiles/.claude/marketplace/plugins/sitrep
claude plugin test ~/.dotfiles/.claude/marketplace/plugins/sitrep
```

fork が書くレポートの中身と、実際の端末での見た目はテストで確かめられないため、実機で確認する。

Claude Code は GitHub から取り込んだ複製を読むので、編集は push しないと導入済みの環境に反映されない。
push したら「更新」の手順で取り込む。
