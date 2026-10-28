# 要素の構文

`hp-calls`・`hp-machine`、および `<` を含む `hp-code` は、**本文を最初の子の `<script type="text/plain">…</script>` に入れる。** script の中では `<` や `>`、generics をそのまま書ける。囲まないと、最初の `<` から先が HTML として解釈され、pack が error を出す。

行単位の要素では、行頭の mark の意味をそろえている。`+` は追加、`-` は削除、`~` は変更、`?` は提案(読み手が取り消せる)。

コメントは、claim・code の行・呼び出しの行・mock の注記・引用に付けられる。書き手が付ける印は要らない。

## `hp-plan` と `hp-claim`

| 属性 | 付ける要素 | 働き |
|---|---|---|
| `new` `changed` `deleted` | `hp-plan` | 提案で追加・変更・削除する file の数。見出しの下に「提案 · 9 ファイル 新規 6 変更 3」と出る。0 の属性は省く |
| `kind="shared"` / `kind="scope"` | `hp-claim` | 番号のない最後の2つの枝(共有・対象外) |
| `at="path:line"` | 3段目の `hp-claim` | 呼び出しの行のうち、同じ `@ path:line` を持つ行に「この claim へ」の矢印が付く。`<p>` がなければ path が claim になる |
| `id` | `hp-claim` | `<a href="#id">` の行き先。閉じた claim の中でも、途中を開いて移動する |

claim の最初の子は claim を書いた `<p>`(中で `<code>` と `<b>` を使える)。次に exhibit を1つ。必要なら `hp-ask` か `hp-note`。最後に子の claim。

ページは最初、すべての claim を閉じて表示する。1段目の claim の一覧が要約になる。閉じた claim には、下にある未確認の判断・変更・コメントの数が出る。1段目の見出しはスクロールしても上に残る。

## `hp-why` と `hp-quote` — 依頼の原文

```html
<hp-why>
  <hp-quote from="ユーザー" via="prompt">タスクの期限前に通知がほしい。</hp-quote>
</hp-why>
```

`hp-why` は「依頼の原文 · n 件」として折りたたまれる。`from` は発言者の名前、`via` は経路(prompt、slack、issue など)。中身は書き換えない。

## `hp-mock` — 実際の HTML を枠に入れ、欄の幅に合わせて縮小する

```html
<hp-mock w="420" caption="タスク詳細の期限の下に、通知の行を足す。">
  <template>
    <div class="ui row"><span class="muted">通知</span><span class="grow"></span><span class="btn" data-ref="add">＋ 追加</span></div>
  </template>
  <hp-pin ref="add" anchor="tr" title="新しいボタン">期限が未設定のタスクでは出さない。</hp-pin>
</hp-mock>

<hp-mock frame="terminal" title="tasklet" w="460"><template><span class="dim">$</span> tasklet remind add 42 --before 1h
<span class="g">✓</span> <b>11/5 17:00</b> に通知する</template></hp-mock>
```

- `frame="none|browser|phone|terminal"`(既定は `none`)。`w` は設計する幅で、shadow root の中でその幅で描き、欄が狭ければ縮小する。`h` を付けると高さで切る。`url`(browser)と `title`(terminal)は枠の上の帯に出る。`caption` は下に出る。
- **要点を示す最小の範囲を描く。** カード1枚、menu 1つ、行1つを、`w` 480 以下で描く。スマートフォンでも読める。画面全体は概観だけにし、そのときは `thumbnail` を付ける。
- 中は普通の HTML。補助の class: `.ui`(余白)`.row` `.col` `.grow` `.muted` `.small` `.btn` `.btn.pri` `.card` `.input` `.menu`(子の `.on` が選択中)`.badge`。複数の mock で同じ CSS を使うときは、ページに `<style data-mock-shared>…</style>` を1つ置く。
- terminal の枠は暗い mono の面で、`.dim .g .r .y .b` と `<b>` を使える。
- `data-ref="名前"` の要素に `<hp-pin ref="名前">` で番号を付ける。`anchor="tr|tl|br|bl|r|l|c"` で角を選ぶ(既定は `tr`)。要素がないときは `at="x%,y%"`。pin の `title` は要点の数語、本文は省いてよい。pin は mock の下に番号付きの一覧として出て、一覧の各行にコメントできる。
- 文字が出力の振る舞い(CLI、log、生成される file)は、terminal の mock か、出力の `hp-code` にする。

## `hp-machine` — lifecycle を、state ごとの画面と一緒に示す

```html
<hp-machine caption="state を押すと、その state のときの画面を表示する。">
<script type="text/plain">
state scheduled initial  # 時刻を待っている
state sending            # worker が行を確保して送信している
state sent final         # 送信した
state failed             # 送信に失敗した

| scheduled | sending | sent |
| .         | failed  | .    |

scheduled -> sending : 時刻になった
sending   -> sent    : 成功
sending   -> failed  : エラー
+ failed  -> sending : 再送
</script>
  <div data-state="scheduled sending sent"><hp-mock …>…</hp-mock></div>
  <div data-state="failed"><hp-mock …>…</hp-mock></div>
</hp-machine>
```

- `state <id> [initial] [final]  # 説明の1文`。initial がなければ最初の state が初期 state になる。
- **`| a | b | . |` の行で state を並べる。** 1行が1段で、`.` は空き。主な経路を上の段に、それ以外を下に置く。配置がないと3列ずつ自動で並べ、遷移が交差しやすい。
- `a -> b : ラベル`。ラベルはキー・code・2語程度。行頭の `+` は提案で増える遷移(緑の破線)、`-` はなくなる遷移(赤の破線)。判断で増減する遷移には `+` を付ける。machine 全体が新しいなら mark は付けない。
- 線が別の state を横切るときは曲線で迂回し、ラベルは state・他のラベル・線を避けて置く。自己遷移は描けないので、state の説明に書く。
- 読み手には、図・現在の state の説明・次に行ける遷移・その state の画面(`data-state` に id を空白区切りで並べた div)が見える。state を押す(または focus して Enter)と移る。
- pack は、到達できない state、final でない行き止まり、配置の漏れを error にする。state は8個まで。

## `hp-calls` — 何が変わるかを呼び出しの木で示す

```html
<hp-calls caption="Enter で行のコードを開く。不要な行は x で取り消す。">
<script type="text/plain">
~ TaskDetail()                          @ web/src/tasks/TaskDetail.tsx:58
+   **ReminderPicker**()                @ web/src/tasks/ReminderPicker.tsx:1
+     POST /api/tasks/:id/reminders     @ web/src/api/reminders.ts:12
-   legacyAlarm(task)                   @ web/src/tasks/alarm.ts:30  -- 使わなくなる
    saveTask()                          @ web/src/tasks/save.ts:30

~ router.post('/tasks/:id/reminders')   @ api/src/reminders/routes.ts:24
?   trackReminderCreated()              @ api/src/metrics.ts:40  -- 提案。不要なら取り消す
</script>
</hp-calls>
```

- 1行に1呼び出し。1列目が mark(`+ - ~ ?` か空白)。字下げは2文字で1段。`**太字**` は新しく作る symbol(`+` で太字がない行は、既存のものへの新しい呼び出し)。
- 行末に `@ path:line`、必要なら ` -- 注記`。空行で入口を分ける。
- pack は `@ path:line` の file を `--root` の下で見つけると、前後6行を埋め込む。読み手は行を押す(Enter)とその code を開ける。まだない file の行は開けないので、重要なものには3段目の claim(`at=` が同じもの)を付ける。新しい関数を既存の file に足すときは、足す位置の行を書く。
- 読み手は mark の付いた行を取り消せる(`x`)。取り消した行の子孫も薄くなり、回答の「取り消し」に入る。
- 1つの木は15行以内にする。

## `hp-code` — code の一部を、注記付きで示す

```html
<hp-code language="ts" src="api/src/reminders/store.ts" lines="12-24" hl="18">
  <hp-pin line="18" title="上限を超えたら 409">画面は追加ボタンを無効にする。</hp-pin>
</hp-code>

<hp-code language="ts" title="worker/src/reminders/send.ts" sketch>
<script type="text/plain">
await push.send(r.deviceTokens, message(r));
</script>
</hp-code>

<hp-code id="schema" language="sql" title="migrations/0031_reminders.sql" diff editable caption="編集すると、差分が回答に入る。">
<script type="text/plain">
 CREATE TABLE reminders (
   id        uuid PRIMARY KEY,
-  due       timestamptz,
+  remind_at timestamptz NOT NULL
 );
</script>
</hp-code>
```

- `language` は色付けに使う(ts、js、sql、py、go、rs、proto、sh、yaml など)。`lang` は HTML の言語属性なので使わない(pack が error にする)。
- 既存の code は `src="path" lines="a-b"` で、pack が file から埋め込む(`--root` かページのフォルダの外、および秘密情報の file は読まない)。まだない code は `title` を付けて本文に書き、`sketch` を付ける。`file` と `start` で、本文に書いた code の file 名と開始行を示せる。
- `diff` を付けると、各行の1列目が mark になる(`+`、`-`、それ以外は空白)。
- `hl="18,20-22"` は行を強調する。`<hp-pin line="N" title="…">` は、その行の下に注記を出す。行番号は gutter に出る番号(diff では新しい側の番号)。
- `editable` を付けると、読み手が編集でき、回答に unified diff が入る。schema には `editable` と `id` を付ける。
- 読み手は ↑↓ で行を移動し、`c` で行にコメントできる。
- 40行以内にする。論点を示す範囲に絞る。

## `hp-ask` — 判断

```html
<hp-ask id="limit">
  <p>1タスクあたりの通知の上限をいくつにするか。</p>
  <p>補足が要るときだけ、2つめの段落に書く。</p>
  <label><input type="radio" name="limit" value="3" checked> 3件 <small>依頼の2回に、余裕を1件足した数</small></label>
  <label><input type="radio" name="limit" value="10"> 10件 <small>画面に一覧の表示が要る</small></label>
</hp-ask>
```

- 最初の `<p>` が問い(50字以内)。選択肢は `<label><input type="radio" name value>` で、推奨案に `checked` を付ける。複数選べる判断は `type="checkbox"`。name はページ全体で一意にする。
- 読み手には「判断 n/N」の番号と、推奨案に「提案」の印が見える。未確認の判断は強い枠で目立つ。読み手が案を選ぶか「この案で確定」を押すまで、未確認のままである(画面に表示されただけでは確認にしない)。どの判断にも「補足を書く」の欄が付く。
- キー操作: `n` で次の未確認へ、`1`〜`9` で案を選ぶ、Enter で確定。下のバーに「判断 2/4 確認済み」と出る。

## `hp-note` — 注記

```html
<hp-note><b>前提</b> push 通知の送信基盤は既にある。</hp-note>
```

claim と exhibit を補う注記。多用しない。
