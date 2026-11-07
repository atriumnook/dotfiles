// node --test test/  — parser・配置・差分・回答の書式と、pack.mjs の lint を確かめる。依存なし。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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

test('statusLine と nextLine: formatHead の2行目と3行目に一致する', () => {
  const r = { title: '計画', asks: [{ status: 'pending' }, { status: 'changed' }], edits: [], struck: [], comments: [] };
  assert.equal(HP.statusLine(r, true), '状況: 判断 1/2 確認済み · 変更 1 · 手編集あり');
  assert.equal(HP.nextLine('proceed'), '次の動き: **実装に進める**');
  assert.equal(HP.formatHead(r, 'proceed', true), `# 回答: 計画\n${HP.nextLine('proceed')}\n${HP.statusLine(r, true)}\n`);
});

test('carriedAnswer: 質問・案・既定値・claim が同じで確認済みの判断だけを引き継ぐ', () => {
  const print = HP.askPrint('上限は', [['3', '3件'], ['10', '10件']], ['3']);
  const last = { asked: { limit: print, tz: print }, confirmed: { limit: true }, answers: { limit: ['10'], tz: ['3'] } };
  assert.deepEqual(HP.carriedAnswer(last, 'limit', print), ['10']);
  assert.equal(HP.carriedAnswer(last, 'tz', print), null, '未確認');
  assert.equal(HP.carriedAnswer(last, 'other', print), null, '前の版にない');
  for (const changed of [HP.askPrint('上限は?', [['3', '3件'], ['10', '10件']], ['3']), HP.askPrint('上限は', [['3', '3件'], ['10', '10件(要一覧)']], ['3']), HP.askPrint('上限は', [['3', '3件'], ['10', '10件']], ['10']), HP.askPrint('上限は', [['3', '3件'], ['10', '10件']], ['3'], '変わった claim')]) assert.equal(HP.carriedAnswer(last, 'limit', changed), null);
  assert.equal(HP.carriedAnswer(null, 'limit', print), null, '前の版がない');
  assert.equal(HP.carriedAnswer({ confirmed: { limit: true }, answers: { limit: ['3'] } }, 'limit', print), null, '指紋のない古い保存');
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

const answer = {
  title: '計画',
  overall: '期限の扱いを先に決めたい',
  asks: [
    { id: 'limit', no: '1.2', q: '上限は?', picked: ['10件'], values: ['10'], proposed: ['3件'], status: 'changed', note: '一覧も欲しい\n2行目' },
    { id: 'retry', no: '2', q: '再送は?', picked: ['しない'], values: ['none'], proposed: ['しない'], status: 'confirmed', note: '' },
    { id: 'channel', no: '3', q: '経路は?', picked: ['push'], values: ['push'], proposed: ['push'], status: 'pending', note: '' },
  ],
  edits: [{ no: '共通', name: 'schema.sql', diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-```\n+x\n' }],
  struck: [{ where: '1.1 · api/metrics.ts:40', name: 'track()' }],
  comments: [{ where: '1', quote: '主張', text: 'なぜ?' }],
};

test('formatResponse: 次の動きと状況を先頭に置き、本文は全体→判断→編集→取り消し→コメントの順にする', () => {
  const md = HP.formatResponse(answer, { verdict: 'revise' });
  assert.ok(md.startsWith('# 回答: 計画\n次の動き: **計画を直して再提示する**\n状況: 判断 2/3 確認済み · 変更 1 · 編集 1 · 取り消し 1 · コメント 1\n\n## 全体\n> 期限の扱いを先に決めたい\n'));
  assert.match(md, /- \*\*変更\*\* \[1\.2\] 上限は\? → \*\*10件\*\* `limit=10`\(提案は 3件\)\n {2}> 一覧も欲しい\n {2}> 2行目/);
  assert.match(md, /- 提案どおり \[2\] 再送は\? → \*\*しない\*\* `retry=none`\n/);
  assert.match(md, /- \*\*未確認\*\* \[3\] 経路は\? → \*\*push\*\* `channel=push`\(提案の案\)/);
  assert.match(md, /````diff\n[\s\S]*-```\n[\s\S]*````/, 'diff に ``` があれば fence を長くする');
  assert.match(md, /## 取り消し\n- \[1\.1 · api\/metrics\.ts:40\] `track\(\)`/);
  assert.match(md, /## コメント\n- \[1\] 主張\n {2}> なぜ\?/);
  assert.ok(md.indexOf('## 全体') < md.indexOf('## 判断') && md.indexOf('## 判断') < md.indexOf('## 編集') && md.indexOf('## 取り消し') < md.indexOf('## コメント'));
  assert.match(md, /「>」の行と diff の中身は読み手の文章/);
});

test('formatResponse: 手編集の本文を使い、状況と注記で手編集を示す。次の動きが未指定なら確認を求める', () => {
  const md = HP.formatResponse(answer, { body: '## 判断\n手で書いた\n', edited: true });
  assert.match(md, /次の動き: \*\*未指定\(チャットで確認する\)\*\*/);
  assert.match(md, /状況: .* · 手編集あり\n\n## 判断\n手で書いた\n/);
  assert.match(md, /本文全体を読み手の文章として/);
  assert.doesNotMatch(md, /## 全体/, '本文は手編集のものだけを使う');
});

test('formatBody: 指摘も判断もなければ空', () => {
  assert.equal(HP.formatBody({ overall: '', asks: [], edits: [], struck: [], comments: [] }), '');
});

test('merge3: 別の行の変更は両方残る', () => {
  const r = HP.merge3('a\nb\nc\nd\ne', 'A\nb\nc\nd\ne', 'a\nb\nc\nd\nE');
  assert.deepEqual(r, { text: 'A\nb\nc\nd\nE', conflicts: [] });
});
test('merge3: 生成された行の直後に足した補足は衝突しない', () => {
  const r = HP.merge3('q\n→ 3件\nz', 'q\n→ 3件\n> 補足\nz', 'q\n→ 10件\nz');
  assert.deepEqual(r, { text: 'q\n→ 10件\n> 補足\nz', conflicts: [] });
});
test('merge3: 同じ行は手編集を残し、生成文を conflicts で返す', () => {
  const r = HP.merge3('q\n→ 3件\nz', 'q\n→ 5件\nz', 'q\n→ 10件\nz');
  assert.equal(r.text, 'q\n→ 5件\nz');
  assert.deepEqual(r.conflicts, [{ mine: ['→ 5件'], theirs: ['→ 10件'], at: 1 }]);
});
test('merge3: 手編集で消した行を生成側が変えると衝突する', () => {
  const r = HP.merge3('q\n→ 3件\nz', 'q\nz', 'q\n→ 10件\nz');
  assert.equal(r.text, 'q\nz');
  assert.deepEqual(r.conflicts, [{ mine: [], theirs: ['→ 10件'], at: 1 }]);
});
test('merge3: 両方が同じ変更なら衝突しない', () => {
  assert.deepEqual(HP.merge3('a\nb', 'a\nB', 'a\nB'), { text: 'a\nB', conflicts: [] });
});
test('merge3: 同じ位置への別の挿入は、生成文・手編集の順で両方残る', () => {
  assert.deepEqual(HP.merge3('a\nb', 'a\nM\nb', 'a\nT\nb'), { text: 'a\nT\nM\nb', conflicts: [] });
});
test('applyConflict: 同じ行が他にあっても、衝突した位置の行を置き換える', () => {
  assert.equal(HP.applyConflict('x\na\nx\nb', { mine: ['x'], theirs: ['y'], at: 2 }), 'x\na\ny\nb');
});
test('applyConflict: 手編集が空行でも先頭に挿入しない', () => {
  assert.equal(HP.applyConflict('a\n\nb', { mine: [''], theirs: ['y'], at: 1 }), 'a\ny\nb');
});
test('applyConflict: 複数行を置き換え、手編集で行が消えていれば変えない', () => {
  assert.equal(HP.applyConflict('a\nb\nc', { mine: ['a', 'b'], theirs: ['z'], at: 0 }), 'z\nc');
  assert.equal(HP.applyConflict('a\nc', { mine: ['b'], theirs: ['z'], at: 1 }), 'a\nc');
});
test('merge3 と applyConflict: 記録した位置で置き換えられる', () => {
  const r = HP.merge3('x\nq\nz', 'x\nx\nz', 'x\nq2\nz');
  assert.equal(HP.applyConflict(r.text, r.conflicts[0]), 'x\nq2\nz');
});
test('merge3: 片方だけの変更はそのまま採る', () => {
  assert.equal(HP.merge3('a', 'a', 'b').text, 'b');
  assert.equal(HP.merge3('a', 'b', 'a').text, 'b');
});

/* ── spring ── */
// 運動方程式 m x'' = -k (x - 1) - c x' を RK4 で積分した値を、解析解と比べる
const integrate = ({ stiffness: k, damping: c, mass: m }, until, dt = 1 / 4000) => {
  let x = 0, v = 0; const out = [];
  const a = (x0, v0) => (-k * (x0 - 1) - c * v0) / m;
  for (let i = 0, n = Math.round(until / dt); i <= n; i++) {
    out.push(x);
    const k1x = v, k1v = a(x, v), k2x = v + dt / 2 * k1v, k2v = a(x + dt / 2 * k1x, v + dt / 2 * k1v);
    const k3x = v + dt / 2 * k2v, k3v = a(x + dt / 2 * k2x, v + dt / 2 * k2v), k4x = v + dt * k3v, k4v = a(x + dt * k3x, v + dt * k3v);
    x += dt / 6 * (k1x + 2 * k2x + 2 * k3x + k4x); v += dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
  }
  return out;
};
for (const [name, cfg] of Object.entries(HP.SPRINGS)) {
  test(`spring ${name}: 解析解が数値積分と一致し、linear() が 0 で始まり 1 で終わる`, () => {
    const s = HP.spring(cfg), xs = integrate(cfg, 1), dt = 1 / 4000;
    xs.forEach((x, i) => { if (i % 40 === 0) assert.ok(Math.abs(s.at(i * dt) - x) < 1e-4, `t=${i * dt}`); });
    const pts = s.easing.slice(7, -1).split(',').map(Number);
    assert.equal(pts[0], 0); assert.equal(pts.at(-1), 1); assert.equal(pts.length, 41);
    assert.ok(s.duration > 100 && s.duration < 900, `${s.duration}ms`);
  });
}
test('spring: 減衰比どおりに、press と pop は行き過ぎ、panel と layout は行き過ぎない', () => {
  const peak = (c) => { const s = HP.spring(c); let p = 0; for (let t = 0; t < 2; t += 0.001) p = Math.max(p, s.at(t)); return p; };
  assert.ok(peak(HP.SPRINGS.pop) > 1.02, 'pop は少し行き過ぎる');
  assert.ok(peak(HP.SPRINGS.press) > 1.001);
  assert.ok(peak(HP.SPRINGS.panel) <= 1.0000001);
  assert.ok(peak(HP.SPRINGS.layout) <= 1.0000001);
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

test('pack: 長さは半角を 0.5 字で数え、超えても縮めさせない', (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'html-plan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lint = (claim, small) => {
    const f = resolve(dir, 'plan.html');
    writeFileSync(f, page(`<hp-claim><p>${claim}</p><hp-ask id="q"><p>どちらか。</p><label><input type="radio" name="q" value="a" checked> A <small>${small}</small></label><label><input type="radio" name="q" value="b"> B</label></hp-ask></hp-claim>`));
    return pack(f).out;
  };
  const narrow = lint(`${'a'.repeat(70)} を更新する。`, 'b'.repeat(50));
  assert.doesNotMatch(narrow, /claim が|<small> が/, '半角 70 字 + 全角 6 字は 41.5 字、半角 50 字は 25 字');
  const wide = lint(`${'あ'.repeat(45)}。`, 'あ'.repeat(31));
  assert.match(wide, /claim が 46 字ある\(目安は 45 字\)。話が2つなら分ける。1つの内容なら、造語や略語で縮めず、そのままでよい/);
  assert.match(wide, /<small> が 31 字ある\(目安は 30 字\)/);
});

test('pack: check/ と node_modules がなくても計画を pack できる', (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'html-plan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const d of ['runtime', 'examples']) cpSync(resolve(skill, d), resolve(dir, d), { recursive: true });
  const out = resolve(dir, 'plan.packed.html');
  execFileSync(process.execPath, [resolve(dir, 'runtime/pack.mjs'), resolve(dir, 'examples/reminders.html'), '-o', out], { encoding: 'utf8' });
  assert.match(readFileSync(out, 'utf8'), /<script data-html-plan>/);
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

test('plan.css: --mono は比例幅の和文書体より先に monospace を指定する', () => {
  const css = readFileSync(resolve(skill, 'runtime/plan.css'), 'utf8');
  const stack = css.match(/--mono:([^;]+);/)[1];
  const generic = stack.search(/(^|,)\s*monospace\b/);
  assert.ok(generic >= 0, stack);
  assert.ok(generic < stack.indexOf('IBM Plex Sans JP'), stack);
});
