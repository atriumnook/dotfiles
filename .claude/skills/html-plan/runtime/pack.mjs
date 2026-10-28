#!/usr/bin/env node
// pack.mjs — 計画ページを lint し、CSS・JS・参照した code を埋め込んだ1ファイルにする。
//   node pack.mjs plan.html [--root <repo>]... [-o out.html] [--lint-only] [--artifact]
// 依存なし。parser は plan.js と同じものを使う。error が1件でもあれば書き出さない。
import { readFileSync, writeFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(realpathSync(fileURLToPath(import.meta.url)));
createRequire(import.meta.url)(resolve(here, 'plan.js'));
const HP = globalThis.HtmlPlan;

const usage = () => { console.error('usage: node pack.mjs plan.html [--root <repo>]... [-o out.html] [--lint-only] [--artifact]'); process.exit(2); };
const args = process.argv.slice(2); const flags = new Set(); const roots = []; let input = null, outPath = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--root') { if (!args[i + 1]) usage(); roots.push(resolve(args[++i].replace(/^~(?=\/|$)/, process.env.HOME))); }
  else if (a === '-o') { if (!args[i + 1]) usage(); outPath = resolve(args[++i]); }
  else if (a.startsWith('--')) flags.add(a);
  else if (!input) input = a; else usage();
}
if (!input) usage();
const inPath = resolve(input); const pageDir = dirname(inPath);
if (!roots.length) roots.push(pageDir);
outPath = outPath || inPath.replace(/\.html?$/, '') + '.packed.html';

let html = readFileSync(inPath, 'utf8');
const errors = [], warns = [], notes = [];
const lineOf = (idx) => html.slice(0, idx).split('\n').length;
const attrs = (s) => { const o = {}; String(s).replace(/([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, (m, k, a, b, c) => { o[k.toLowerCase()] = a ?? b ?? c ?? ''; return ''; }); return o; };
const stripTags = (t) => String(t).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const scriptOf = (inner) => { const m = inner.match(/<script\s+type=["']?text\/plain["']?\s*>([\s\S]*?)<\/script>/i); return m ? m[1] : null; };
const blocksOf = (tag) => [...html.matchAll(new RegExp(`<(${tag})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'g'))].map((m) => ({ whole: m[0], a: attrs(m[2]), inner: m[3], idx: m.index, at: `${lineOf(m.index)} 行 <${tag}${attrs(m[2]).id ? '#' + attrs(m[2]).id : ''}>` }));

/* ── 読み込む file の制限: --root かページのフォルダの中にあり(symlink は解決する)、秘密情報の file ではないこと ── */
const real = (p) => { try { return realpathSync(p); } catch { return null; } };
const FENCE = [...new Set([...roots, pageDir])].map(real).filter(Boolean);
const inside = (f) => FENCE.some((d) => f === d || f.startsWith(d.endsWith(sep) ? d : d + sep));
const SECRET_NAME = /(^|[\\/])(\.(git|ssh|aws|gnupg|kube|docker|password-store)([\\/]|$)|\.env(\.[^\\/]*)?$|\.netrc$|\.npmrc$|\.pypirc$|\.pgpass$|\.git-credentials$|id_(rsa|dsa|ecdsa|ed25519)[^\\/]*$|credentials[^\\/]*$|secrets?(\.[^\\/]*)?$|[^\\/]*_history$)|\.(pem|key|p12|pfx|jks|keystore|tfvars|tfstate|kdbx|ovpn)$/i;
const SECRET_TEXT = /sk-ant-[\w-]{10,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,}|xox[abeprs]-[\w-]{10,}|AIza[\w-]{30,}|eyJ[\w-]{20,}\.[\w-]{10,}\.|(?:password|passwd|secret|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["'][^"'\s$<{]{12,}["']/i;
const reads = new Set();
function readRepoFile(p, at) {
  for (const cand of [...roots.map((r) => resolve(r, p)), resolve(pageDir, p)]) {
    if (!existsSync(cand) || !statSync(cand).isFile()) continue;
    const f = real(cand);
    if (!f || !inside(f)) { errors.push(`${at}: "${p}" は --root とページのフォルダの外にあるので読まない`); return null; }
    if (SECRET_NAME.test(f)) { errors.push(`${at}: "${p}" は秘密情報の file に見えるので読まない`); return null; }
    const text = readFileSync(f, 'utf8');
    if (SECRET_TEXT.test(text)) { errors.push(`${at}: "${p}" に秘密情報らしい文字列があるので埋め込まない`); return null; }
    reads.add(relative(roots[0], f) || p); return text;
  }
  return undefined;
}

/* ── 文書 ── */
if (!/<title>[^<]+<\/title>/i.test(html)) errors.push('<title> がない。tab と Artifact の名前になる');
if (!/<html[^>]*\blang=["']ja["']/i.test(html)) warns.push('<html lang="ja"> にする。和文の禁則と字形が lang で決まる');
if (!/<hp-plan\b/.test(html)) errors.push('<hp-plan> がない');
if (!/<h1[\s>]/i.test(html)) errors.push('<h1> がない。回答の見出しに使う');
if (!/plan\.css/.test(html) && !/<style[^>]*data-html-plan/.test(html)) errors.push('plan.css を link していない');
if (!/plan\.js/.test(html) && !/<script[^>]*data-html-plan/.test(html)) errors.push('plan.js を読み込んでいない');
const KNOWN = new Set(['hp-plan', 'hp-claim', 'hp-why', 'hp-quote', 'hp-code', 'hp-pin', 'hp-calls', 'hp-machine', 'hp-mock', 'hp-ask', 'hp-note']);
for (const m of html.matchAll(/<(hp-[a-z-]+)\b/g)) if (!KNOWN.has(m[1])) errors.push(`${lineOf(m.index)} 行: 未知の要素 <${m[1]}>。使える要素: ${[...KNOWN].join(' ')}`);
const ids = {}; for (const m of html.matchAll(/\sid=["']([^"']+)["']/g)) { if (ids[m[1]]) errors.push(`id="${m[1]}" が重複している(${ids[m[1]]} 行と ${lineOf(m.index)} 行)`); ids[m[1]] = lineOf(m.index); }
{ const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); const t = m ? stripTags(m[1]) : '';
  if (t && (/[。.!?！？]$/.test(t) || t.length > 30)) warns.push(`<h1>「${t}」: 変更と場所を名詞句で、30字以内に書く(例「Tasklet のタスク期限リマインダー」)。文にしない`); }

/* ── code ── */
html = html.replace(/<(hp-code)\b([^>]*)>([\s\S]*?)<\/hp-code>/g, (whole, tag, rawAttrs, inner, idx) => {
  const a = attrs(rawAttrs); const at = `${lineOf(idx)} 行 <hp-code${a.id ? '#' + a.id : ''}>`;
  if (a.lang) errors.push(`${at}: lang= は HTML の言語属性で、支援技術が読み上げの言語を誤る。言語は language="${a.lang}" と書く`);
  let src = scriptOf(inner); let extra = '';
  if (src == null && a.src) {
    const text = readRepoFile(a.src, at);
    if (text === undefined) { errors.push(`${at}: src="${a.src}" が ${roots.map((r) => relative(process.cwd(), r) || '.').join(', ')} に見つからない`); return whole; }
    if (text === null) return whole;
    const all = text.split('\n'); let start = 1, body = text;
    if (a.lines) {
      const mm = a.lines.match(/^(\d+)(?:-(\d+))?$/); if (!mm) { errors.push(`${at}: lines="${a.lines}" は 20-34 の形で書く`); return whole; }
      start = +mm[1]; const end = +(mm[2] || mm[1]);
      if (start < 1 || end > all.length || start > end) { errors.push(`${at}: lines="${a.lines}" だが ${a.src} は ${all.length} 行`); return whole; }
      body = all.slice(start - 1, end).join('\n');
    }
    src = body; extra = `${a.file ? '' : ` file="${a.src}"`}${a.start ? '' : ` start="${start}"`}`;
    inner = `<script type="text/plain">\n${body.replace(/<\/script/gi, '<\\/script')}\n</script>` + inner;
    notes.push(`${a.src}${a.lines ? ':' + a.lines : ''} を埋め込んだ`);
  }
  if (src == null) { if (/<(?!\/?hp-pin\b)[a-z]/i.test(inner)) errors.push(`${at}: code を <script type="text/plain"> で囲んでいない。< が HTML として解釈される`); src = inner.replace(/<hp-pin[\s\S]*?<\/hp-pin>/g, ''); }
  if (!src.trim()) { errors.push(`${at}: code が空`); return whole; }
  const rows = HP.parseCode(src, 'diff' in a); const st = +(a.start || (a.lines || '').split('-')[0] || 1);
  const shown = new Set(); let n = st; rows.forEach((r) => { if (r.mark !== '-') shown.add(n++); });
  for (const p of inner.matchAll(/<hp-pin\b([^>]*)>/g)) { const pa = attrs(p[1]); if (!pa.line) errors.push(`${at}: <hp-pin> に line="" がない`); else if (!shown.has(+pa.line)) errors.push(`${at}: <hp-pin line="${pa.line}"> の行がない(表示は ${st}〜${n - 1} 行)`); }
  if (rows.length > 40) warns.push(`${at}: ${rows.length} 行ある。論点を示す 40 行以内に絞る`);
  if (a.src && !a.lines && rows.length > 12) warns.push(`${at}: src の file 全体を出している。lines="a-b" で範囲を絞る`);
  return `<hp-code${rawAttrs}${extra}>${inner}</hp-code>`;
});

/* ── 呼び出しの木: @ path:line が読める行には前後 6 行の抜粋を埋め込む ── */
html = html.replace(/<(hp-calls)\b([^>]*)>([\s\S]*?)<\/hp-calls>/g, (whole, tag, rawAttrs, inner, idx) => {
  const at = `${lineOf(idx)} 行 <hp-calls>`; const src = scriptOf(inner);
  if (src == null) { errors.push(`${at}: 本文を <script type="text/plain"> で囲む`); return whole; }
  const m = HP.parseCalls(src); m.errors.forEach((e) => errors.push(`${at}: ${e}`));
  if (!m.rows.some((r) => r.mark !== ' ')) warns.push(`${at}: + - ~ ? の行がない。変わる呼び出しに mark を付ける`);
  if (m.rows.length > 16) warns.push(`${at}: ${m.rows.length} 行ある。入口ごとに分けて 15 行以内にする`);
  const have = new Set([...inner.matchAll(/data-excerpt=["']([^"']+)["']/g)].map((x) => x[1]));
  let add = '';
  for (const r of m.rows) {
    if (!r.file || !r.line) continue; const k = `${r.file}:${r.line}`; if (have.has(k)) continue; have.add(k);
    const text = readRepoFile(r.file, at); if (text == null) continue;
    const L = text.split('\n'); if (r.line > L.length) { warns.push(`${at}: ${k} — file は ${L.length} 行`); continue; }
    const s0 = Math.max(1, r.line - 6), s1 = Math.min(L.length, r.line + 6);
    add += `\n<script type="text/plain" data-excerpt="${k}" data-start="${s0}">\n${L.slice(s0 - 1, s1).join('\n').replace(/<\/script/gi, '<\\/script')}\n</script>`;
  }
  return add ? `<hp-calls${rawAttrs}>${inner}${add}</hp-calls>` : whole;
});

/* ── state machine ── */
for (const b of blocksOf('hp-machine')) {
  const src = scriptOf(b.inner); if (src == null) { errors.push(`${b.at}: 本文を <script type="text/plain"> で囲む`); continue; }
  const m = HP.parseMachine(src); m.errors.concat(HP.checkMachine(m)).forEach((e) => errors.push(`${b.at}: ${e}`));
  if (m.order.length > 8) warns.push(`${b.at}: state が ${m.order.length} 個ある。8 個以内に分ける`);
  if (!m.grid.length && m.order.length > 3) warns.push(`${b.at}: 配置(| a | b | の行)がない。主な経路を上の段に、それ以外を下の段に置く`);
  const L = HP.layoutMachine(m);
  const ov = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  const labels = L.edges.filter((e) => e.lbox);
  labels.forEach((e, i) => {
    if (Object.values(L.boxes).some((bx) => ov(e.lbox, bx))) warns.push(`${b.at}: 遷移 ${e.from}->${e.to} のラベルが state と重なる。配置を変えるかラベルを短くする`);
    if (labels.slice(i + 1).some((o) => ov(e.lbox, o.lbox))) warns.push(`${b.at}: 遷移 ${e.from}->${e.to} のラベルが別のラベルと重なる`);
  });
  for (const s of b.inner.matchAll(/data-state=["']([^"']+)["']/g)) s[1].split(/[\s,]+/).forEach((id) => { if (id && !m.states[id]) errors.push(`${b.at}: data-state="${id}" の state がない`); });
}

/* ── mockup ── */
for (const b of blocksOf('hp-mock')) {
  const tpl = b.inner.match(/<template>([\s\S]*?)<\/template>/i);
  if (!tpl) { errors.push(`${b.at}: <template> の中に mock の HTML を書く`); continue; }
  for (const p of b.inner.matchAll(/<hp-pin\b([^>]*)>/g)) {
    const pa = attrs(p[1]);
    if (pa.ref) { if (!new RegExp(`data-ref=["']${pa.ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(tpl[1])) errors.push(`${b.at}: <hp-pin ref="${pa.ref}"> の data-ref が template にない`); }
    else if (!/^\d+(\.\d+)?%?\s*,\s*\d+(\.\d+)?%?$/.test(pa.at || '')) errors.push(`${b.at}: <hp-pin> には ref="名前" か at="x%,y%" が要る`);
  }
  const w = +(b.a.w || 480); if (w > 520 && !('thumbnail' in b.a)) warns.push(`${b.at}: w=${w}。スマートフォンでは ${Math.round(358 / w * 100)}% に縮む。要点の部分だけを w ≤ 480 で描く(全体図なら thumbnail を付ける)`);
}

/* ── 判断 ── */
const names = new Set();
for (const b of blocksOf('hp-ask')) {
  if (!b.a.id) warns.push(`${b.at}: id を付ける。回答と保存の key になる`);
  const q = b.inner.match(/<p[^>]*>([\s\S]*?)<\/p>/i); if (!q) errors.push(`${b.at}: 最初の <p> に問いを書く`);
  else if (stripTags(q[1]).length > 50) warns.push(`${b.at}: 問いが ${stripTags(q[1]).length} 字ある。50 字以内にし、補足は2つめの <p> に書く`);
  const inputs = [...b.inner.matchAll(/<input\b([^>]*)>/gi)].map((m) => attrs(m[1]));
  if (!inputs.length) errors.push(`${b.at}: 選択肢がない。<label><input type="radio" name value> 案</label> で書く`);
  const groups = [...new Set(inputs.map((i) => i.name))];
  groups.forEach((g) => {
    if (!g) { errors.push(`${b.at}: name のない input がある`); return; }
    const rs = inputs.filter((i) => i.name === g);
    if (rs.some((r) => !r.value)) errors.push(`${b.at}: "${g}" の input すべてに value が要る`);
    if (rs[0].type === 'radio' && !rs.some((r) => 'checked' in r)) errors.push(`${b.at}: "${g}" に checked がない。推奨案を checked にする`);
    if (names.has(g)) errors.push(`${b.at}: name "${g}" が別の判断でも使われている`); names.add(g);
  });
  for (const s of b.inner.matchAll(/<small>([\s\S]*?)<\/small>/g)) if (stripTags(s[1]).length > 30) warns.push(`${b.at}: 選択肢の <small> が ${stripTags(s[1]).length} 字ある。30 字以内で違いだけを書く`);
}

/* ── claim の木 ── */
{
  const flat = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|template|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/(<hp-(machine|ask|calls|mock|code|note|quote)\b[^>]*>)[\s\S]*?(<\/hp-\2>)/gi, '$1$3');
  const root = { no: '', kids: [], l: 0, a: {} }; const stack = [root];
  for (const t of flat.matchAll(/<(\/?)hp-claim\b([^>]*)>|<hp-(mock|machine|calls|code)\b|<(hp-ask)\b|<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const top = stack[stack.length - 1];
    if (t[0].startsWith('<hp-claim') || t[0].startsWith('</hp-claim')) {
      if (t[1]) { if (stack.length > 1) stack.pop(); else errors.push('</hp-claim> の対応する開始タグがない'); continue; }
      const a = attrs(t[2]); const n = { a, kids: [], ex: [], asks: [], claim: null, l: top.l + 1 };
      n.no = a.kind === 'shared' ? '共有' : a.kind === 'scope' ? '対象外' : (top.no && !top.a.kind ? top.no + '.' : '') + (top.kids.filter((k) => !k.a.kind).length + 1);
      top.kids.push(n); stack.push(n); continue;
    }
    if (stack.length === 1) continue;
    if (t[3]) top.ex.push('hp-' + t[3]);
    else if (t[4]) { top.asks.push({ afterKids: top.kids.length > 0, afterEx: top.ex.length > 0 }); }
    else if (t[5] != null && top.claim == null && !top.ex.length && !top.kids.length) top.claim = stripTags(t[5]);
  }
  if (stack.length > 1) errors.push(`<hp-claim> が ${stack.length - 1} 個閉じていない`);
  const walk = (n) => {
    const at = `claim ${n.no}`;
    if (n.claim == null && !n.a.at) errors.push(`${at}: 最初の子に、主張を1文で書いた <p> を置く(場所の claim なら at="path:line")`);
    if (n.claim && n.l <= 2 && !n.a.kind) {
      if (!/[。！？]$/.test(n.claim)) warns.push(`${at}:「${n.claim.slice(0, 30)}」は見出しになっている。真偽を判定できる1文にして「。」で終える`);
      if (n.claim.length > 45) warns.push(`${at}: claim が ${n.claim.length} 字ある。45 字以内の1文にする`);
    }
    if (n.ex.length > 1) warns.push(`${at}: exhibit が ${n.ex.length} 個ある(${n.ex.join(', ')})。1つの claim に1つ。残りは子の claim にする`);
    if (!n.ex.length && !n.kids.length && n.a.kind !== 'scope') warns.push(`${at}: 主張を示す exhibit がない`);
    if (n.asks.some((x) => x.afterKids)) warns.push(`${at}: 判断は exhibit の後、子の claim の前に置く`);
    if (n.asks.some((x) => !x.afterEx) && n.ex.length) warns.push(`${at}: 判断が exhibit より前にある`);
    if (n.kids.length > 5) warns.push(`${at}: 子の claim が ${n.kids.length} 個ある。5 個以内にまとめる`);
    if (n.l > 3) warns.push(`${at}: ${n.l} 段目。3 段(何が・どう・どこで)までにする`);
    n.kids.forEach(walk);
  };
  const tops = root.kids.filter((k) => !k.a.kind);
  if (tops.length > 5) warns.push(`最上位の claim が ${tops.length} 個ある。5 個以内にする(共有と対象外は別に数える)`);
  if (root.kids.length && !root.kids.some((k) => k.a.kind === 'scope')) warns.push('kind="scope" の claim がない。変更しないものを最後に書く');
  const i = root.kids.findIndex((k) => k.a.kind); if (i >= 0 && root.kids.slice(i).some((k) => !k.a.kind)) warns.push('kind="shared" と kind="scope" の claim は最後に置く');
  root.kids.forEach(walk);
  const nAsk = (flat.match(/<hp-ask\b/g) || []).length; if (nAsk > 5) warns.push(`判断が ${nAsk} 個ある。作るものが変わる分岐だけを 2〜5 個にし、残りは推奨で決める`);
}

/* ── 文章: clarify-ja の観点のうち、機械的に見つけられるもの。ユーザーの引用・code・mock の中は対象外 ── */
{
  const body = (html.match(/<hp-plan[\s\S]*<\/hp-plan>/i) || [''])[0]
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<(hp-quote|code|kbd)\b[\s\S]*?<\/\1>/gi, ' ');
  const texts = [...body.matchAll(/<(p|li|small|hp-pin|hp-note)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map((m) => [stripTags(m[3]), attrs(m[2]).title || ''].join(' '))
    .concat([...body.matchAll(/\s(?:caption|title)="([^"]*)"/g)].map((m) => m[1])).map((t) => t.trim()).filter(Boolean);
  const RULES = [
    [/と言えるでしょう|が重要です|が重要である|鍵となる|シームレス|を実現する|を実現します|に寄与|結論から言うと|いかがでしたか|させていただ/, '定型句(clarify-ja 12)。具体的な事実を書く'],
    [/かもしれない|かもしれません|と思われ|と考えられ/, 'ぼかし(clarify-ja 13)。言い切るか、確かめる方法を書く'],
    [/大幅に|非常に|かなり|十分に|極めて/, '程度語(clarify-ja 13)。数値を書く'],
    [/の実施|を実施|化を図る|を行う|を行います/, '名詞化(clarify-ja 2)。誰が何をするかを動詞で書く'],
    [/が効く|に効く|が効いて|刺さる/, '比喩的な動詞(clarify-ja 5)。何がどう変わるかを書く'],
    [/[→⇒]/, '記号で文をつないでいる(clarify-ja 15)。文で書く'],
    [/(です|ます|でした|ました|ません)[。」]?$/m, '敬体。計画は常体(〜する、〜である)で書く'],
  ];
  const hits = new Map();
  for (const t of texts) for (const [re, msg] of RULES) { const m = t.match(re); if (m) { if (!hits.has(msg)) hits.set(msg, []); hits.get(msg).push(m[0]); } }
  hits.forEach((v, msg) => warns.push(`文章: ${msg} — ${[...new Set(v)].slice(0, 5).map((x) => `「${x}」`).join(' ')}`));
  const long = texts.flatMap((t) => t.split(/(?<=[。！？])/)).map((s) => s.trim()).filter((s) => s.length > 80);
  if (long.length) warns.push(`文章: 80 字を超える文が ${long.length} 個ある。1文に1つの内容にする — 「${long[0].slice(0, 24)}…」`);
}

/* ── 埋め込み ── */
const runtime = (name) => readFileSync(resolve(here, name), 'utf8');
let packed = html;
if (!flags.has('--lint-only')) {
  packed = packed.replace(/<link\b[^>]*href=["'][^"']*plan\.css["'][^>]*>/i, () => `<style data-html-plan>\n${runtime('plan.css')}\n</style>`);
  packed = packed.replace(/<script\b[^>]*src=["'][^"']*plan\.js["'][^>]*>\s*<\/script>/i, () => `<script data-html-plan>\n${runtime('plan.js').replace(/<\/script/gi, '<\\/script')}\n</script>`);
}

/* ── 報告 ── */
const rel = (p) => relative(process.cwd(), p) || p;
console.log(basename(inPath));
notes.forEach((m) => console.log('  · ' + m));
warns.forEach((m) => console.log('  ⚠ ' + m));
errors.forEach((m) => console.log('  ✗ ' + m));
if (errors.length) { console.log(`✗ error ${errors.length} 件、warning ${warns.length} 件。直してからもう一度実行する`); process.exit(1); }
if (flags.has('--lint-only')) { console.log(`✓ lint 通過${warns.length ? `(warning ${warns.length} 件)` : ''}`); process.exit(0); }
writeFileSync(outPath, packed);
if (reads.size) console.log(`  ページに入った code: ${[...reads].sort().join(', ')}`);
console.log(`✓ ${rel(outPath)}  ${(Buffer.byteLength(packed) / 1024).toFixed(0)} KB${warns.length ? `  warning ${warns.length} 件` : ''}`);
if (flags.has('--artifact')) {   // Artifact tool は自分で <html><head><body> を付けるので、中身だけを書き出す
  const art = packed.replace(/<!doctype[^>]*>\s*/i, '').replace(/<\/?html\b[^>]*>\s*/gi, '').replace(/<meta\b[^>]*charset[^>]*>\s*/i, '').replace(/<meta\b[^>]*viewport[^>]*>\s*/i, '').replace(/<\/?(head|body)\b[^>]*>\s*/gi, '');
  const artPath = outPath.replace(/(\.packed)?\.html?$/, '.artifact.html'); writeFileSync(artPath, art);
  console.log(`✓ ${rel(artPath)}  Artifact tool で publish する`);
}
