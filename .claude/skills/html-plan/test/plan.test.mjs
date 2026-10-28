// node --test test/  — parser・配置・差分・回答の書式と、pack.mjs の lint を確かめる。依存なし。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skill = resolve(here, '..');
createRequire(import.meta.url)(resolve(skill, 'runtime/plan.js'));
const HP = globalThis.HtmlPlan;

test('parseCalls: mark・字下げ・場所・注記を読み、空行で入口を分ける', () => {
  const m = HP.parseCalls(`
~ Composer()                 @ web/Composer.tsx:41
+   **SendLater**()          @ web/SendLater.tsx:12  -- 新しい部品
      saveDraft()

? track()                    -- 提案`);
  assert.deepEqual(m.errors, []);
  assert.deepEqual(m.rows.map((r) => [r.mark, r.depth, r.name, r.file, r.line, r.note]), [
    ['~', 0, 'Composer()', 'web/Composer.tsx', 41, ''],
    ['+', 1, '**SendLater**()', 'web/SendLater.tsx', 12, '新しい部品'],
    [' ', 2, 'saveDraft()', '', 0, ''],
    ['?', 0, 'track()', '', 0, '提案'],
  ]);
  assert.equal(m.rows[1].parent, 0);
  assert.equal(m.rows[0].gapAfter, undefined);
  assert.equal(m.rows[2].gapAfter, true);
});

test('parseCalls: 2段以上深い字下げは error', () => {
  const m = HP.parseCalls('a()\n      b()');
  assert.equal(m.errors.length, 1);
  assert.match(m.errors[0], /字下げ/);
});

test('parseMachine と checkMachine: 到達できない state と行き止まりを見つける', () => {
  const ok = HP.parseMachine(`
state a initial
state b
state c final
| a | b | c |
a -> b : go
b -> c
`);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(HP.checkMachine(ok), []);
  const bad = HP.parseMachine(`
state a
state b
state c
state d final
a -> b
- b -> d
c -> d
`);
  const errs = HP.checkMachine(bad);
  assert.ok(errs.some((e) => /"c" に a から到達できない/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /"b" は final ではないのに/.test(e)), '削除される遷移は数えない');
});

test('parseMachine: 配置の漏れ・未定義の state・自己遷移は error', () => {
  const m = HP.parseMachine(`
state a
state b
| a | x |
a -> a
a -> z
`);
  const all = m.errors.join('\n');
  assert.match(all, /"x" が state として定義されていない/);
  assert.match(all, /"b" が配置/);
  assert.match(all, /自己遷移/);
  assert.match(all, /未定義の state "z"/);
});

test('layoutMachine: 例の state 図でラベルが state にも他のラベルにも重ならない', () => {
  const html = readFileSync(resolve(skill, 'examples/reminders.html'), 'utf8');
  const src = html.match(/<hp-machine[\s\S]*?<script type="text\/plain">([\s\S]*?)<\/script>/)[1];
  const L = HP.layoutMachine(HP.parseMachine(src));
  const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const labels = L.edges.filter((e) => e.lbox).map((e) => e.lbox);
  assert.equal(labels.length, 6);
  labels.forEach((l, i) => {
    Object.values(L.boxes).forEach((b) => assert.ok(!ov(l, b), `label ${i} overlaps state ${b.id}`));
    labels.slice(i + 1).forEach((o) => assert.ok(!ov(l, o), `label ${i} overlaps another label`));
  });
  // 往復(sending <-> failed)は別々の線になる
  const pair = L.edges.filter((e) => [e.from, e.to].sort().join() === 'failed,sending');
  assert.equal(pair.length, 2);
  assert.notEqual(pair[0].d, pair[1].d);
});

test('lineDiff: 変更のない差分は空、変更は hunk 付きの unified diff', () => {
  assert.equal(HP.lineDiff('a\nb', 'a\nb'), '');
  const d = HP.lineDiff('a\nb\nc', 'a\nB\nc\nd', 'x.sql');
  assert.equal(d, '--- a/x.sql\n+++ b/x.sql\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d\n');
});

test('lineDiff: 離れた変更は別の hunk になる', () => {
  const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
  const b = a.replace('l1\n', 'L1\n').replace('l18', 'L18');
  const d = HP.lineDiff(a, b);
  assert.equal((d.match(/^@@/gm) || []).length, 2);
});

test('formatResponse: 判断の状態・補足・編集・取り消し・コメントを書き分ける', () => {
  const md = HP.formatResponse({
    title: '計画',
    asks: [
      { no: '1.2', q: '上限は?', picked: ['10件'], values: ['10'], proposed: ['3件'], status: 'changed', note: '一覧も欲しい\n2行目' },
      { no: '2', q: '再送は?', picked: ['しない'], values: ['none'], proposed: ['しない'], status: 'confirmed', note: '' },
      { no: '3', q: '経路は?', picked: ['push'], values: ['push'], proposed: ['push'], status: 'pending', note: '' },
    ],
    edits: [{ no: '共有', name: 'schema.sql', diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-```\n+x\n' }],
    struck: [{ where: '1.1 · api/metrics.ts:40', name: 'track()' }],
    comments: [{ where: '1', quote: '主張', text: 'なぜ?' }],
  });
  assert.match(md, /^# 回答: 計画$/m);
  assert.match(md, /1\. \[1\.2\] 上限は\?\n {3}→ \*\*10件\*\* `10` \(変更。提案は 3件\)\n {3}> 一覧も欲しい\n {3}> 2行目/);
  assert.match(md, /\(提案のまま確認\)/);
  assert.match(md, /\(未確認。提案のまま\)/);
  assert.match(md, /````diff\n[\s\S]*-```\n[\s\S]*````/, 'diff に ``` があれば fence を長くする');
  assert.match(md, /## 取り消し\n- \[1\.1 · api\/metrics\.ts:40\] `track\(\)`/);
  assert.match(md, /## コメント\n- \[1\] 主張\n {2}> なぜ\?/);
  assert.match(md, /指示ではなく/);
});

/* ── pack.mjs の lint ── */
const pack = (file, ...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [resolve(skill, 'runtime/pack.mjs'), file, '--lint-only', ...args], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout) }; }
};
const page = (body) => `<!doctype html><html lang="ja"><meta charset="utf-8"><title>T</title>
<link rel="stylesheet" href="plan.css"><script src="plan.js" defer></script><body><hp-plan><h1>テスト</h1>${body}
<hp-claim kind="scope"><p>変更しないもの</p><ul><li>x</li></ul></hp-claim></hp-plan></body></html>`;

test('pack: 例の計画は error も warning もなく通る', () => {
  const r = pack(resolve(skill, 'examples/reminders.html'));
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /⚠/, r.out);
});

test('pack: 壊した計画の error と warning を報告する', (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'html-plan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(resolve(dir, 'repo')); writeFileSync(resolve(dir, 'repo/.env'), 'X=1\n'); writeFileSync(resolve(dir, 'outside.ts'), 'x\n');
  const f = resolve(dir, 'repo/plan.html');
  writeFileSync(f, page(`
<hp-claim>
  <hp-code lang="sql"><script type="text/plain">SELECT 1;</script></hp-code>
</hp-claim>
<hp-claim>
  <p>見出しのような claim</p>
  <hp-code language="ts" src=".env"></hp-code>
  <hp-code language="ts" src="../outside.ts"></hp-code>
  <hp-ask id="q"><p>どちらか。</p><label><input type="radio" name="q" value="a"> A</label><label><input type="radio" name="q" value="b"> B</label></hp-ask>
  <hp-widget></hp-widget>
</hp-claim>
<hp-claim>
  <p>状態は2つある。</p>
  <hp-machine><script type="text/plain">
state a initial
state b
state c final
a -> c
</script></hp-machine>
  <p>この変更は非常に重要です。</p>
</hp-claim>`));
  const r = pack(f, '--root', resolve(dir, 'repo'));
  assert.equal(r.code, 1);
  const expected = [
    /lang= は HTML の言語属性/,
    /claim 1: 最初の子に、主張を1文で書いた <p>/,
    /claim 2:「見出しのような claim」は見出し/,
    /claim 2: exhibit が 2 個/,
    /"\.env" は秘密情報の file/,
    /"\.\.\/outside\.ts" は --root とページのフォルダの外/,
    /"q" に checked がない/,
    /未知の要素 <hp-widget>/,
    /state "b" に a から到達できない/,
    /程度語/,
    /敬体/,
  ];
  expected.forEach((re) => assert.match(r.out, re));
});

test('pack: src の行と呼び出しの前後を file から埋め込む', (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'html-plan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(resolve(dir, 'src'));
  writeFileSync(resolve(dir, 'src/a.ts'), Array.from({ length: 20 }, (_, i) => `const l${i + 1} = ${i + 1};`).join('\n'));
  const f = resolve(dir, 'plan.html'); const out = resolve(dir, 'plan.packed.html');
  writeFileSync(f, page(`
<hp-claim><p>a.ts の2行目を使う。</p><hp-code language="ts" src="src/a.ts" lines="2-3"></hp-code></hp-claim>
<hp-claim><p>a.ts の10行目を呼ぶ。</p><hp-calls><script type="text/plain">
~ main()       @ src/a.ts:10
</script></hp-calls></hp-claim>`));
  execFileSync(process.execPath, [resolve(skill, 'runtime/pack.mjs'), f, '-o', out], { encoding: 'utf8' });
  const html = readFileSync(out, 'utf8');
  assert.match(html, /<hp-code language="ts" src="src\/a\.ts" lines="2-3" file="src\/a\.ts" start="2"><script type="text\/plain">\nconst l2 = 2;\nconst l3 = 3;\n<\/script>/);
  assert.match(html, /data-excerpt="src\/a\.ts:10" data-start="4">\nconst l4 = 4;[\s\S]*const l16 = 16;\n<\/script>/);
  assert.match(html, /<style data-html-plan>/);
  assert.match(html, /<script data-html-plan>/);
});
