#!/usr/bin/env node
// check.mjs — html-plan の runtime を変えたときに、実ブラウザで回帰を検査する開発用の script。計画を書くときには要らない。
//   node check.mjs [plan.packed.html] [--full] [--out <dir>] [--browser <chromium のパス>]
// page を渡さなければ、examples/reminders.html の全検査と examples/parts.html の見た目の検査をする。
// page を渡すと見た目の検査だけをする(操作の検査は例の計画の判断や schema を前提にしている)。--full で操作も検査する。依存の導入と Chromium が要る。
// 3 つの幅で、axe-core(WCAG 2.2 AA)、横のはみ出し、mock の幅超え、state 図のラベルの重なりを調べ、
// 全体の screenshot を保存する。OS が dark でも light で描くことを確かめる。キーボードだけで
// 判断・コメント・取り消し・編集・回答まで進められるか、回答のシートの手編集・merge・衝突・
// 次の動き・送信が働くか、動きが瞬間移動せずキーボードと reduced motion で止まるかを確かめる。問題があれば exit 1。
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
let page0 = args.find((a, i) => !a.startsWith('--') && !['--out', '--browser'].includes(args[i - 1]));
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT = !page0, FULL = DEFAULT || args.includes('--full');
const packTo = (src, name) => { const p = resolve(mkdtempSync(resolve(tmpdir(), 'html-plan-check-')), name); execFileSync(process.execPath, [resolve(here, '../runtime/pack.mjs'), resolve(here, src), '-o', p], { stdio: 'ignore' }); return p; };
if (DEFAULT) page0 = packTo('../examples/reminders.html', 'reminders.packed.html');
const url = pathToFileURL(resolve(page0)).href;
const out = resolve(opt('--out') || resolve(page0, '..', basename(page0, '.html') + '.check'));
mkdirSync(out, { recursive: true });
const exe = opt('--browser') || process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);

const errors = [], warns = [];
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const AXE = require.resolve('axe-core/axe.min.js');

async function open(viewport, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`console: ${m.text()}`); });
  await page.goto(url);
  await page.waitForSelector('html[data-hp-ready]', { timeout: 5000 });
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page, logs };
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
// 動きが終わるまで待つ。起きないことの確認と、動きの途中の測定には使えないので、そこだけ固定の時間を待つ
const quiet = async (page) => {
  await settle(page);
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'), null, { timeout: 5000 }).catch(async () => {
    const names = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.transitionProperty || a.effect?.target?.className || '?'));
    errors.push(`動き: 5秒たっても終わらない animation がある(${[...new Set(names)].join(', ')})`);
  });
};

/* ── 見た目の検査 ── */
for (const width of [390, 768, 1280]) {
  const tag = `${width}px`;
  const { ctx, page, logs } = await open({ width, height: 900 });
  if (width === 1280) await page.screenshot({ path: resolve(out, 'closed.png'), fullPage: true });
  await page.evaluate(() => window.HtmlPlan.expandAll()); await settle(page);
  await page.addScriptTag({ path: AXE });
  const axe = await page.evaluate(() => window.axe.run({ exclude: [['.hp-mock-host']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }));
  axe.violations.forEach((v) => {
    const where = v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ');
    (['serious', 'critical'].includes(v.impact) ? errors : warns).push(`${tag} axe ${v.id} (${v.impact}, ${v.nodes.length} 箇所): ${v.help} — ${where}`);
  });
  const geo = await page.evaluate(() => {
    const E = [], W = []; const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) E.push(`ページが横にはみ出している(${document.documentElement.scrollWidth}px > ${vw}px)`);
    const ov = (a, b, d = 0) => a.left < b.right - d && b.left < a.right - d && a.top < b.bottom - d && b.top < a.bottom - d;
    document.querySelectorAll('.hp-mock-host').forEach((host, i) => {
      const root = host.shadowRoot?.querySelector('.root'); if (!root) return;
      if (root.scrollWidth > root.clientWidth + 1) E.push(`mock ${i + 1}: 中身が設計幅を超えている(${root.scrollWidth}px > ${root.clientWidth}px)`);
    });
    document.querySelectorAll('.hp-mock').forEach((fig, i) => {
      const pins = [...fig.querySelectorAll('.hp-mpin')];
      pins.forEach((p) => { if (p.hidden) E.push(`mock ${i + 1}: pin ${p.textContent} の data-ref が見つからない`); });
      pins.forEach((p, k) => pins.slice(k + 1).forEach((q) => { if (ov(p.getBoundingClientRect(), q.getBoundingClientRect(), 4)) W.push(`mock ${i + 1}: pin ${p.textContent} と ${q.textContent} が重なる`); }));
    });
    document.querySelectorAll('.hp-mc-svg').forEach((svg, i) => {
      const states = [...svg.querySelectorAll('.hp-st > rect:first-child')].map((r) => r.getBoundingClientRect());
      const labels = [...svg.querySelectorAll('.hp-elabel')].map((g) => ({ g, r: g.querySelector('rect').getBoundingClientRect(), t: g.querySelector('text').getBoundingClientRect(), name: `${g.dataset.from}->${g.dataset.to}` }));
      labels.forEach((l, k) => {
        if (states.some((s) => ov(l.r, s))) E.push(`state 図 ${i + 1}: ラベル ${l.name} が state と重なる`);
        labels.slice(k + 1).forEach((o) => { if (ov(l.r, o.r)) E.push(`state 図 ${i + 1}: ラベル ${l.name} と ${o.name} が重なる`); });
        if (l.t.width > l.r.width + 1) E.push(`state 図 ${i + 1}: ラベル ${l.name} の文字が枠からはみ出す`);
      });
      const vb = svg.viewBox.baseVal; const scale = svg.getBoundingClientRect().width / vb.width;
      if (13 * scale < 10) W.push(`state 図 ${i + 1}: 文字が ${(13 * scale).toFixed(1)}px に縮む。state を減らすか列を減らす`);
    });
    // code・mock・抜粋の中は本物の null がありうるので、それ以外の文字だけを見る
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('code, textarea, .hp-lines, .hp-excerpt, .hp-mock-host, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let txt = ''; while (tw.nextNode()) txt += tw.currentNode.textContent + ' ';
    const stray = txt.match(/\b(null|undefined|NaN|\[object Object\])\b/g);
    if (stray) E.push(`描画された文字に ${[...new Set(stray)].join(', ')} がある(値の入れ忘れ)`);
    const bar = document.querySelector('.hp-bar')?.getBoundingClientRect();
    if (bar && (bar.left < 0 || bar.right > vw)) E.push('下のバーが画面からはみ出している');
    document.querySelectorAll('.hp-toggle, .hp-btn, label.hp-opt').forEach((b) => { const r = b.getBoundingClientRect(); if (r.width && r.height < 24) W.push(`押せる要素の高さが ${r.height.toFixed(0)}px(24px 未満): ${b.textContent.trim().slice(0, 20)}`); });
    return { E, W };
  });
  geo.E.forEach((m) => errors.push(`${tag} ${m}`)); geo.W.forEach((m) => warns.push(`${tag} ${m}`));
  logs.forEach((m) => errors.push(`${tag} ${m}`));
  // 広い画面では計画のシートの中でスクロールするので、全体が写る高さに広げる
  const full = await page.evaluate(() => { const p = document.querySelector('hp-plan'); return p.scrollHeight > p.clientHeight && width_wide() ? p.scrollHeight + 16 : 0; function width_wide() { return innerWidth >= 1100; } });
  if (full) await page.setViewportSize({ width, height: full });
  await page.screenshot({ path: resolve(out, `${width}.png`), fullPage: true });
  await ctx.close();
}
{
  const look = (p) => p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, sheet: getComputedStyle(document.querySelector('hp-plan')).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme }));
  const l = await open({ width: 1280, height: 900 }, 'light'), d = await open({ width: 1280, height: 900 }, 'dark');
  const a = await look(l.page), b = await look(d.page);
  if (a.bg !== b.bg || a.sheet !== b.sheet || b.scheme !== 'light') errors.push(`OS が dark のときに light と同じに描かれない(${JSON.stringify(b)})`);
  await l.ctx.close(); await d.ctx.close();
}

if (FULL) {
/* ── キーボードだけで最後まで進めるか ── */
{
  const { ctx, page, logs } = await open({ width: 1280, height: 900 }, 'light');
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('html[data-hp-ready]');
  const fail = (m) => errors.push(`キーボード: ${m}`);
  const active = () => page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, ask: !!a?.closest('fieldset.hp-ask'), cls: a?.className || '', text: (a?.textContent || '').trim().slice(0, 40) }; });
  const pending = () => page.evaluate(() => +document.documentElement.dataset.hpPending);
  const total = await pending();
  const secs = () => page.evaluate(() => [...document.querySelectorAll('.hp-asec')].filter((s) => !s.hidden).map((s) => s.querySelector('.hp-asec-h').textContent).join(' / '));
  if (await secs() !== `未回答${total}`) fail(`答える前の欄が「未回答${total}」だけでない(${await secs()})`);
  if ((await page.evaluate(() => document.querySelector('.hp-composer').textContent)).includes('チャットで確認')) fail('未回答の欄の代わりに案内の文が残っている');
  await page.keyboard.press('n');
  if (!(await active()).ask) fail('n で未回答の判断に移らない');
  await page.keyboard.press('2'); await settle(page);
  if (total > 1 && await secs() !== `未回答${total - 1} / 回答済み1`) fail(`1件答えたあとの欄の件数が合わない(${await secs()})`);
  for (let i = 0; i < 12 && (await pending()) > 0; i++) {
    await page.keyboard.press('n'); if (!(await active()).ask) { fail('n で次の未回答の判断に移らない'); break; }
    await page.keyboard.press('Enter'); await settle(page);
  }
  if (await pending()) fail(`判断が ${await pending()} 件未回答のまま残った`);
  // claim にコメントする
  await page.keyboard.press('O'); await page.keyboard.press('j');
  if (!(await active()).cls.includes('hp-toggle')) fail('j で claim の見出しに移らない');
  await page.keyboard.press('c'); await settle(page);
  if ((await active()).tag !== 'TEXTAREA') fail('c でコメント欄が開かない');
  await page.keyboard.type('期限のないタスクはどう表示する?'); await page.keyboard.press('Control+Enter'); await settle(page);
  // code の行にコメントする(行への移動は Tab の代わりに focus で入る)
  await page.evaluate(() => window.HtmlPlan.expandAll());
  await page.focus('hp-code .hp-line'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('c'); await settle(page);
  if ((await active()).tag !== 'TEXTAREA') fail('code の行で c を押してもコメント欄が開かない');
  await page.keyboard.type('ここは 404 では?'); await page.keyboard.press('Control+Enter'); await settle(page);
  // 呼び出しを取り消す
  const strikeRow = await page.$('.hp-row[data-mark="?"]');
  if (strikeRow) { await strikeRow.focus(); await page.keyboard.press('x'); }
  // schema を編集する
  const editBtn = await page.$('#schema .hp-code-acts .hp-btn');
  if (editBtn) {
    await editBtn.focus(); await page.keyboard.press('Enter'); await settle(page);
    if ((await active()).tag !== 'TEXTAREA') fail('編集ボタンで編集欄が開かない');
    await page.keyboard.press('Control+End'); await page.keyboard.type('\nALTER TABLE reminders ADD COLUMN channel text;'); await page.keyboard.press('Control+Enter'); await settle(page);
  }
  // state 図を操作する
  const st = await page.$('.hp-st[data-id="failed"]');
  if (st) { await st.focus(); await page.keyboard.press('Enter'); await settle(page);
    if (!(await page.evaluate(() => { const s = document.querySelector('.hp-mc-screen [data-state~="failed"]'); return s && !s.hidden; }))) fail('state 図で Enter を押しても画面が切り替わらない'); }
  // 回答
  await page.keyboard.press('Escape'); await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('r'); await settle(page);
  const md = await page.evaluate(() => document.querySelector('dialog[open] textarea.hp-out')?.value || '');
  if (!md) fail('回答のシートに本文がない');
  const expect = { '## 判断': '判断の節', '**変更**': '変えた判断', '提案どおり': '確認した判断', '期限のないタスク': 'claim へのコメント', 'ここは 404': '行へのコメント', '## 編集': '編集の節', '+ALTER TABLE': '編集の diff' };
  if (strikeRow) expect['## 取り消し'] = '取り消しの節';
  Object.entries(expect).forEach(([s, what]) => { if (!md.includes(s)) fail(`回答に${what}がない(「${s}」)`); });
  if (md.includes('未回答')) fail('すべて答えたのに回答に「未回答」が残る');
  if (md.indexOf('期限のないタスク') > md.indexOf('ここは 404')) fail('回答のコメントがページ上の順に並んでいない');
  writeFileSync(resolve(out, 'response.md'), md);
  await page.keyboard.press('Escape');
  // 再読み込みしても回答が残るか
  await page.reload(); await page.waitForSelector('html[data-hp-ready]');
  const kept = await page.evaluate(() => window.HtmlPlan.response('proceed'));
  if (!kept.includes('期限のないタスク') || +(await page.evaluate(() => document.documentElement.dataset.hpPending)) !== 0) fail('再読み込みで回答が消えた');
  logs.forEach((m) => errors.push(`キーボード: ${m}`));
  if (total < 1) warns.push('判断が1つもないので、判断の操作は検査していない');
  await ctx.close();
}

/* ── 回答のシート: 常に見える・手編集・merge・衝突・次の動き・再読み込み・送信 ── */
{
  const { ctx, page, logs } = await open({ width: 1280, height: 900 });
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } } }); });
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('html[data-hp-ready]');
  const fail = (m) => errors.push(`回答: ${m}`);
  const body = () => page.inputValue('textarea.hp-out');
  const tab = (name) => page.click(`.hp-tab[data-tab="${name}"]`);
  const pick = (name) => page.evaluate((n) => { const on = [...document.querySelectorAll(`input[name="${n}"]`)]; const t = on.find((i) => !i.checked); t.closest('fieldset').removeAttribute('data-compact'); t.click(); return t.value; }, name);
  const name = await page.evaluate(() => document.querySelector('fieldset.hp-ask input')?.name);
  const geom = await page.evaluate(() => { const d = document.querySelector('.hp-composer'), r = d.getBoundingClientRect(), p = document.querySelector('hp-plan').getBoundingClientRect(); return { open: d.open, modal: d.matches(':modal'), free: p.right <= r.left, inView: r.right <= innerWidth && r.bottom <= innerHeight, bar: getComputedStyle(document.querySelector('.hp-bar')).display, active: document.activeElement?.tagName }; });
  if (!geom.open || geom.modal) fail('広い画面で回答のシートが常に出ていない');
  if (!geom.free || !geom.inView) fail('回答のシートが計画に重なるか、画面からはみ出す');
  if (geom.bar !== 'none') fail('広い画面で下のバーが残る');
  if (geom.active !== 'BODY') fail('開いただけで focus が移った');
  const openCount = () => page.evaluate(() => [...document.querySelectorAll('fieldset.hp-ask')].filter((f) => !f.hasAttribute('data-compact')).length);
  if (await openCount() !== 1) fail('最初に開く判断が1つではない');
  await page.keyboard.press('r');
  if (!(await page.evaluate(() => document.activeElement.className)).includes('hp-overall')) fail('r で「全体への指摘」に focus が移らない');
  await page.keyboard.type('通知より先に期限の扱いを決めたい');
  if (!(await body()).startsWith('## 全体\n> 通知より先に')) fail('全体への指摘が本文の先頭に入らない');
  await tab('body');
  await page.fill('textarea.hp-out', (await body()).replace('\n\n## 判断', '\n手で足した一文\n\n## 判断'));
  await pick(name); await settle(page);
  let t = await body();
  if (!t.includes('手で足した一文') || !t.includes('**変更**')) fail('判断を変えたときに手編集と新しい判断が両立しない');
  if (!(await page.textContent('.hp-dlg-sum')).includes('手編集')) fail('要約に手編集の行数が出ない');
  const line = t.split('\n').find((l) => l.includes('**変更**'));
  await page.fill('textarea.hp-out', t.replace(line, '- 手で書いた答え'));
  await page.evaluate((n) => { [...document.querySelectorAll(`input[name="${n}"]`)].find((i) => i.defaultChecked).click(); }, name); await settle(page);
  if (!(await body()).includes('手で書いた答え') || await page.locator('.hp-conf').count() !== 1) fail('衝突で手編集を残して警告を出さない');
  if (!(await page.locator('.hp-conf').textContent()).includes('手で書いた答え')) fail('衝突の警告に手編集の内容がない');
  await page.screenshot({ path: resolve(out, 'composer.png') });
  await page.addScriptTag({ path: AXE });
  const axe = await page.evaluate(() => window.axe.run('.hp-composer', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }));
  axe.violations.forEach((v) => (['serious', 'critical'].includes(v.impact) ? errors : warns).push(`回答 axe ${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  // 入力のたびに衝突の欄を作り直さない(選択中の文字やフォーカスが消える)
  const rebuilt = await page.evaluate(() => { const b = document.querySelector('.hp-conf button'); document.querySelector('.hp-overall').dispatchEvent(new Event('input', { bubbles: true })); return b !== document.querySelector('.hp-conf button'); });
  if (rebuilt) fail('入力のたびに衝突の欄が作り直される');
  await page.click('.hp-conf button:has-text("ページでの変更を使う")'); await settle(page);
  if ((await body()).includes('手で書いた答え') || await page.locator('.hp-conf').count()) fail('「ページでの変更を使う」で衝突が解消しない');
  await page.click('.hp-revise'); await page.waitForFunction(() => window.__copied);
  const copied = await page.evaluate(() => window.__copied);
  if (!copied.startsWith('# 回答: ') || !copied.includes('次の動き: **計画を直して再提示する**') || !copied.includes('手編集あり') || !copied.includes('手で足した一文') || !copied.includes('本文全体を読み手の文章として')) fail('コピーした回答に次の動き・手編集・注記がない');
  await page.reload(); await page.waitForSelector('html[data-hp-ready]');
  const kept = await page.evaluate(() => window.HtmlPlan.response('proceed'));
  if (!kept.includes('手で足した一文') || !kept.includes('通知より先に') || !kept.includes('次の動き: **実装に進める**')) fail('再読み込みで手編集か全体への指摘が消えた');
  await page.click('.hp-cmp-sub button:has-text("手編集を捨てる")'); await page.click('.hp-cmp-sub button:has-text("もう一度押すと捨てる")'); await settle(page);
  if ((await body()).includes('手で足した一文')) fail('手編集を捨てても本文に残る');
  logs.forEach((m) => errors.push(`回答: ${m}`));
  await ctx.close();

  // Artifact の環境(window.claude)を stub して、送信の経路を確かめる
  const s = await open({ width: 1280, height: 900 });
  await s.page.addInitScript(() => {
    window.__sent = {};
    window.claude = { use: async (n) => (n === 'db'
      ? { doc: (p) => ({ set: async (v) => { window.__sent.path = p; window.__sent.doc = v; } }) }
      : { canSendToClaude: async () => 'available', anchorFor: async () => 'a', sendToClaude: async (m) => { window.__sent.comment = m.text; } }) };
  });
  await s.page.reload(); await s.page.waitForSelector('html[data-hp-ready]');
  // 広い画面ではシートが最初から出ている。r を押さなくても、表示中のボタンから送れる
  await s.page.waitForFunction(() => !document.querySelector('.hp-cmp-sub button:first-child').hidden, null, { timeout: 3000 }).catch(() => errors.push('回答: 広い画面で開いただけでは送信できる状態にならない'));
  // 入力欄の中の Ctrl+Enter では送らない
  await s.page.focus('.hp-overall'); await s.page.keyboard.press('Control+Enter'); await s.page.waitForTimeout(300);
  if (await s.page.evaluate(() => window.__sent.comment || window.__sent.path)) errors.push('回答: 入力欄の中の Ctrl+Enter で送信された');
  await s.page.evaluate(() => { window.__sent = {}; });
  await s.page.click('.hp-go'); await s.page.waitForFunction(() => window.__sent.comment, null, { timeout: 5000 }).catch(() => errors.push('回答: 広い画面のボタンから送信されない'));
  const sent = await s.page.evaluate(() => window.__sent);
  if (sent.doc && (sent.doc.verdict !== 'proceed' || !sent.doc.markdown.includes('次の動き: **実装に進める**') || !sent.comment.includes(sent.path) || !sent.comment.includes('次の動き'))) errors.push('回答: 送信の db・コメントに次の動きが入らない');
  await s.ctx.close();

  // 幅 1100px をまたぐ: 広い画面では modal でなく常に出し、狭い画面では閉じてバーに戻す。書いた内容は残す
  const w = await open({ width: 1280, height: 900 });
  const sheet = () => w.page.evaluate(() => { const d = document.querySelector('.hp-composer'); return { open: d.open, modal: d.matches(':modal'), bar: !!document.querySelector('.hp-bar')?.getClientRects().length, overall: document.querySelector('.hp-overall').value, over: document.documentElement.scrollWidth > innerWidth + 1 }; });
  await w.page.fill('.hp-overall', 'リサイズの前に書いた指摘');
  await w.page.setViewportSize({ width: 900, height: 900 }); await settle(w.page);
  let st = await sheet();
  if (st.open || !st.bar || st.over) errors.push('リサイズ: 狭くしてもシートが閉じずバーに戻らない');
  await w.page.keyboard.press('r'); await settle(w.page);
  st = await sheet();
  if (!st.modal || st.overall !== 'リサイズの前に書いた指摘') errors.push('リサイズ: 狭くしたあとのシートが modal でないか、書いた指摘が消えた');
  await w.page.setViewportSize({ width: 1280, height: 900 }); await settle(w.page);
  st = await sheet();
  if (!st.open || st.modal || st.bar || st.over || st.overall !== 'リサイズの前に書いた指摘') errors.push('リサイズ: modal のまま広くすると、シートが常に出る状態に戻らない');
  w.logs.forEach((m) => errors.push(`リサイズ: ${m}`));
  await w.ctx.close();

  // 再発行: 同じ title の前の版から、変わっていない判断の回答と補足だけを引き継ぐ。1つ目の判断の質問を変えた版と、最後の判断の claim を変えた版で確かめる
  const v1 = readFileSync(page0, 'utf8'), v2 = v1.replace(/(<hp-ask\b[^>]*>\s*<p>)/, '$1(変更)');
  if (v2 !== v1) {
    let served = v1;
    const c = await open({ width: 1280, height: 900 });
    await c.ctx.route(url, (r) => r.fulfill({ contentType: 'text/html', body: served }));
    const head = () => c.page.evaluate(() => window.HtmlPlan.response('proceed'));
    const swap = async (html) => { served = html; await c.page.reload(); await c.page.waitForSelector('html[data-hp-ready]'); };
    await swap(v1);
    const total = await c.page.locator('fieldset.hp-ask').count();
    // 変えた判断と同じ claim にある判断も、引き継がない
    const untouched = (html, lastToo) => c.page.evaluate(([src, both]) => { const asks = [...new DOMParser().parseFromString(src, 'text/html').querySelectorAll('hp-ask')]; const hit = (a) => { const t = a.closest('hp-claim'); return t ? [...t.querySelectorAll('hp-ask')] : [a]; }; const out = new Set(hit(asks[0])); if (both) hit(asks.at(-1)).forEach((a) => out.add(a)); return asks.length - out.size; }, [html, lastToo]);
    const keep = await untouched(v1, false), keepBoth = await untouched(v1, true);
    await c.page.evaluate(() => document.querySelectorAll('.hp-confirm').forEach((b) => b.click()));
    await c.page.fill('.hp-overall', '前の版への指摘');
    await c.page.evaluate(() => { const n = [...document.querySelectorAll('.hp-ask-note')].at(-1); n.value = '最後の判断の補足'; n.dispatchEvent(new Event('input', { bubbles: true })); }); await settle(c.page);
    if (!(await head()).includes(`判断 ${total}/${total} 回答済み`)) errors.push('再発行: 検査の準備で全判断を回答済みにできない');
    await swap(v2);
    let md = await head();
    if (!md.includes(`判断 ${keep}/${total} 回答済み`)) errors.push(`再発行: 変わっていない判断だけを引き継いでいない(${md.split('\n')[2]})`);
    if (keep && !(await c.page.locator('.hp-dlg-warn').textContent()).includes(`判断 ${keep} 件は、前の版の回答を引き継ぎました`)) errors.push('再発行: 引き継いだことが画面に出ない');
    if (keep === total - 1 && !md.includes('最後の判断の補足')) errors.push('再発行: 引き継いだ判断の補足が消えた');
    if (md.includes('前の版への指摘')) errors.push('再発行: 全体への指摘を引き継いだ');
    await swap(v1);
    if (!(await head()).includes('前の版への指摘')) errors.push('再発行: 前の版を開き直すと、その版の回答が消えている');
    // 前の版をあとから変えても、引き継ぎ済みの版は変わらない
    await c.page.evaluate(() => { const n = [...document.querySelectorAll('.hp-ask-note')].at(-1); n.value = '前の版にあとから書いた補足'; n.dispatchEvent(new Event('input', { bubbles: true })); }); await settle(c.page);
    await swap(v2);
    md = await head();
    if (!md.includes(`判断 ${keep}/${total} 回答済み`) || md.includes('前の版にあとから書いた補足')) errors.push('再発行: 引き継いだ回答が保存されず、再読み込みで変わる');
    await swap(v2.replace(/(<hp-ask\b(?![\s\S]*<hp-ask\b))/, '<p>(claim を変更)</p>$1'));
    if (!(await head()).includes(`判断 ${keepBoth}/${total} 回答済み`)) errors.push(`再発行: claim が変わった判断を引き継いだ(${(await head()).split('\n')[2]})`);
    await swap(v2);
    await c.page.getByRole('button', { name: '回答を消去' }).click(); await c.page.getByRole('button', { name: 'もう一度押すと消去' }).click();
    await c.page.waitForLoadState(); await c.page.waitForSelector('html[data-hp-ready]');
    await swap(v1.replace(/(<hp-ask\b[^>]*>\s*<p>)/, '$1(再度変更)'));
    if (!(await head()).includes(`判断 0/${total} 回答済み`)) errors.push('再発行: 回答を消去したのに、次の版へ引き継がれた');
    c.logs.forEach((m) => errors.push(`再発行: ${m}`));
    await c.ctx.close();
  } else if (/<hp-ask\b/.test(v1)) warns.push('再発行: 直下に <p> のある hp-ask がなく、再発行の検査を省いた');

  // 狭い画面: 下のバーからシートを開く。閉じると答えた判断が畳まれる
  const n = await open({ width: 390, height: 800 });
  if (await n.page.evaluate(() => document.querySelector('.hp-composer').open)) errors.push('回答: 狭い画面で最初からシートが開いている');
  await n.page.keyboard.press('r'); await settle(n.page);
  if (!(await n.page.evaluate(() => document.querySelector('.hp-composer').matches(':modal')))) errors.push('回答: 狭い画面で modal にならない');
  if (await n.page.evaluate(() => document.querySelector('.hp-composer').scrollWidth > innerWidth + 1)) errors.push('回答: 狭い画面で横にはみ出す');
  await n.page.screenshot({ path: resolve(out, 'composer-390.png') });
  await n.page.keyboard.press('Escape'); await settle(n.page);
  if (await n.page.evaluate(() => document.querySelector('.hp-composer').open)) errors.push('回答: 狭い画面で Esc で閉じない');
  await n.page.keyboard.press('n'); await settle(n.page);
  if (!(await n.page.evaluate(() => !!document.activeElement?.closest('fieldset.hp-ask')))) errors.push('回答: 狭い画面で n で判断へ移らない');
  await n.ctx.close();
}

/* ── 動き: 高さは瞬間移動しない・途中で逆向きにできる・判断は順に開く・キーボードと reduced motion では動かない ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', reducedMotion: 'no-preference' });
  const page = await ctx.newPage(); const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(url); await page.waitForSelector('html[data-hp-ready]');
  const intro = await page.evaluate(() => Math.round(Math.max(0, ...document.getAnimations().map((a) => a.effect.getComputedTiming().endTime))));
  await quiet(page);
  const fail = (m) => errors.push(`動き: ${m}`);
  if (intro > 300) fail(`ページを開いたときの動きが全体で ${intro}ms かかる(300ms 以内にする)`);
  const running = (p = page) => p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && !(a instanceof CSSTransition)).length);
  await page.evaluate(() => window.HtmlPlan.collapseAll());
  const trace = (ms) => page.evaluate((limit) => new Promise((res) => { const el = document.querySelector('hp-claim')._body; const t0 = performance.now(); const hs = []; const f = () => { hs.push(el.getBoundingClientRect().height); if (performance.now() - t0 < limit) requestAnimationFrame(f); else res(hs); }; requestAnimationFrame(f); }), ms);
  const head = 'hp-claim .hp-toggle';
  let tr = trace(650); await page.click(head); let hs = await tr;
  const to = hs.at(-1); let jump = 0; for (let i = 1; i < hs.length; i++) jump = Math.max(jump, Math.abs(hs[i] - hs[i - 1]));
  if (to < 50) fail('claim を開いても高さが増えない');
  if (jump / to > 0.3) fail(`claim を開くと1フレームで全高の ${Math.round(jump / to * 100)}% 飛ぶ(瞬間移動)`);
  if (new Set(hs.map((x) => Math.round(x))).size < 6) fail('claim の高さが途中の値を取らない');
  tr = trace(650); await page.click(head); hs = await tr;
  const tail = hs.filter((x) => x > 0).at(-1) ?? 0;
  if (tail / to > 0.02) fail(`claim を閉じると最後に ${Math.round(tail)}px 飛ぶ`);
  // 閉じる途中で中身が見え直さない(透明になった中身の不透明度が、縮みきる前に戻らない)
  await page.click(head); await quiet(page);
  const rebound = page.evaluate(() => new Promise((res) => { const el = document.querySelector('hp-claim')._body; const t0 = performance.now(); let prev = 1, up = 0; const f = () => { const o = +getComputedStyle(el).opacity; if (!el.hidden && el.getBoundingClientRect().height > 1 && o > prev + 0.05) up++; prev = o; if (performance.now() - t0 < 650) requestAnimationFrame(f); else res(up); }; requestAnimationFrame(f); }));
  await page.click(head);
  if (await rebound) fail('claim を閉じる途中で、透明になった中身が見え直す(ちらつく)');
  await quiet(page); await page.click(head); await quiet(page);
  tr = trace(650); await page.click(head); await page.waitForTimeout(110); await page.click(head); await page.waitForTimeout(90); await page.click(head); hs = await tr;
  jump = 0; for (let i = 1; i < hs.length; i++) jump = Math.max(jump, Math.abs(hs[i] - hs[i - 1]));
  if (jump / to > 0.3) fail(`途中で逆向きにすると1フレームで全高の ${Math.round(jump / to * 100)}% 飛ぶ`);
  await quiet(page);
  const leftover = await page.evaluate(() => { const b = document.querySelector('hp-claim')._body; return { overflow: b.style.overflow, n: b.getAnimations().length }; });
  if (leftover.overflow || leftover.n) fail('claim の動きの後に overflow か animation が残る');
  // 案を押すと、枠が滑ってから次の判断が開き、左の計画がその claim へ動く
  await page.evaluate(() => window.HtmlPlan.expandAll());
  const before = await page.evaluate(() => document.querySelector('hp-plan').scrollTop);
  // 答えて次へ進む間に、回答の tab 全体を動かさない(同じ tab を表示し直してぼやけていた)。答えた判断は回答済みの欄へ滑って移る
  const during = page.evaluate(() => new Promise((res) => { const panel = document.getElementById('hp-panel-answer'); let panelMoved = false, slid = false, staggered = false, badgeMoved = false, openedAt = null; const t0 = performance.now();
    const f = () => { if (panel.getAnimations().length) panelMoved = true; if (document.querySelectorAll('.hp-alist fieldset.hp-ask').length && [...document.querySelectorAll('fieldset.hp-ask')].some((fs) => fs.getAnimations().some((a) => a.effect.getKeyframes().some((k) => k.translate)))) slid = true;
      if ([...document.querySelectorAll('fieldset.hp-ask > *')].some((k) => k.getAnimations().some((a) => a.effect.getTiming().delay > 0))) staggered = true;
      if ([...document.querySelectorAll('.hp-badge')].some((b) => b.getAnimations().some((a) => a.effect.getKeyframes().some((k) => k.scale || k.filter || k.translate)))) badgeMoved = true;
      if (openedAt == null && [...document.querySelectorAll('fieldset.hp-ask:not([data-compact])')].some((fs) => fs.querySelector('.hp-ask-no')?.textContent.startsWith('判断 2/'))) openedAt = Math.round(performance.now() - t0);
      if (performance.now() - t0 < 1100) requestAnimationFrame(f); else res({ panelMoved, slid, staggered, badgeMoved, openedAt }); };
    requestAnimationFrame(f); }));
  await page.click('fieldset.hp-ask:not([data-compact]) label.hp-opt:not(:has(input:checked))'); await page.waitForTimeout(380);
  const ind = await page.evaluate(() => { const f = document.querySelector('fieldset.hp-ask:not([data-compact])'), lb = f.querySelector('label.hp-opt:has(input:checked)'), i = f.querySelector('.hp-opt-ind'), a = i.getBoundingClientRect(), b = lb.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + 10); return { dy: Math.abs(a.top - b.top), dh: Math.abs(a.height - b.height), label: !!top?.closest('label.hp-opt') }; });
  if (ind.dy > 1 || ind.dh > 1) fail('選択の枠が選んだ案に重ならない');
  if (!ind.label) fail('選択の枠が案の上に被さっている');
  // 畳む前の timer とスクロールは animation に出ないので、次の判断の claim が画面に入るのを待つ
  await page.waitForFunction(() => { const second = document.querySelectorAll('fieldset.hp-ask')[1], r = document.querySelector('.hp-ask-anchor[data-now]')?.getBoundingClientRect(), p = document.querySelector('hp-plan').getBoundingClientRect(); return second && !second.hasAttribute('data-compact') && r && r.top >= p.top && r.bottom <= p.bottom; }, null, { timeout: 3000 }).catch(() => {}); await quiet(page);
  const moves = await during;
  if (moves.panelMoved) fail('次の判断へ進むときに、回答の tab 全体が動く(ぼやける)');
  if (!moves.slid) fail('答えた判断が、回答済みの欄へ滑らずに一瞬で移る');
  if (moves.staggered) fail('判断を開くときに、中身をずらして出している(答えるたびに起きる動きなので、ずらさない)');
  if (moves.badgeMoved) fail('claim の見出しの札が、数が変わるたびに動く');
  if (moves.openedAt == null || moves.openedAt > 400) fail(`案を選んでから次の判断が開くまで ${moves.openedAt ?? '1100 以上'}ms かかる`);
  const flow = await page.evaluate(() => { const fs = [...document.querySelectorAll('fieldset.hp-ask')]; const open = fs.filter((f) => !f.hasAttribute('data-compact')); const anchors = document.querySelectorAll('.hp-ask-anchor[data-now]'); const r = anchors[0]?.getBoundingClientRect(); const p = document.querySelector('hp-plan').getBoundingClientRect(); return { open: open.length, second: !!open[0]?.querySelector('.hp-ask-no')?.textContent.startsWith('判断 2/'), now: anchors.length, inView: r && r.top >= p.top && r.bottom <= p.bottom, top: document.querySelector('hp-plan').scrollTop }; });
  if (flow.open !== 1 || !flow.second) fail('案を押しても次の判断が開かない');
  if (flow.now !== 1 || !flow.inView) fail('開いた判断の claim が計画の画面内に来ない');
  if (flow.top === before) fail('判断を進めても左の計画が動かない');
  // 回答のボタンを押しても、開いている判断は畳まない
  await page.click('.hp-revise'); await page.waitForTimeout(250);
  if (await page.evaluate(() => document.querySelectorAll('fieldset.hp-ask:not([data-compact])').length) !== 1) fail('回答のボタンで判断が畳まれた');
  // タブの枠は選んだタブに重なる
  await quiet(page); await page.click('.hp-tab[data-tab="body"]');
  if (await page.evaluate(() => document.getElementById('hp-panel-body').getAnimations().length)) fail('tab を切り替えると中身が動く');
  await quiet(page);
  const th = await page.evaluate(() => { const a = document.querySelector('.hp-tab-thumb').getBoundingClientRect(), b = document.querySelector('.hp-tab[aria-selected="true"]').getBoundingClientRect(); return Math.abs(a.left - b.left) + Math.abs(a.width - b.width); });
  if (th > 2) fail('タブの枠が選んだタブに重ならない');
  // 畳み始めた判断を 110ms 以内に開き直しても、あとから畳まれない
  await page.click('.hp-tab[data-tab="answer"]'); await quiet(page);
  const reopened = await page.evaluate(async () => {
    const fs = [...document.querySelectorAll('fieldset.hp-ask')], anchors = [...document.querySelectorAll('.hp-ask-anchor')];
    const no = (f) => +f.querySelector('.hp-ask-no').textContent.match(/判断 (\d+)\//)[1];
    const cur = fs.findIndex((f) => !f.hasAttribute('data-compact')), other = fs.findIndex((f) => f.hasAttribute('data-compact'));
    fs[other].querySelector('.hp-ask-sum').click(); anchors[no(fs[cur]) - 1].click();
    await new Promise((r) => setTimeout(r, 800));
    const stuck = [...fs[cur].children].filter((k) => k.getClientRects().length && +getComputedStyle(k).opacity < 0.9).length;
    return { open: !fs[cur].hasAttribute('data-compact'), count: fs.filter((f) => !f.hasAttribute('data-compact')).length, stuck };
  });
  if (!reopened.open || reopened.count !== 1) fail('畳み始めた判断を開き直すと、あとから畳まれる');
  if (reopened.stuck) fail('開き直した判断の中身が透明のまま残る');
  // キーボードでは動かさない
  await page.click('.hp-tab[data-tab="answer"]'); await quiet(page);
  await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('n');
  if (await running()) fail('n で移るときに動く');
  logs.forEach((m) => errors.push(`動き: ${m}`));
  await ctx.close();

  // 案の上で押して外で離したあとに矢印キーで選んでも、マウスの回答として次へ進まない
  const dc = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', reducedMotion: 'no-preference' });
  const dp = await dc.newPage(); await dp.goto(url); await dp.waitForSelector('html[data-hp-ready]'); await quiet(dp);
  const lb = await dp.locator('fieldset.hp-ask:not([data-compact]) label.hp-opt').first().boundingBox();
  await dp.mouse.move(lb.x + 40, lb.y + 10); await dp.mouse.down(); await dp.mouse.move(10, 10); await dp.mouse.up();
  await dp.focus('fieldset.hp-ask:not([data-compact]) input:checked'); await dp.keyboard.press('ArrowDown'); await dp.waitForTimeout(700);
  if (await dp.evaluate(() => document.querySelector('fieldset.hp-ask').hasAttribute('data-compact'))) fail('矢印キーで選んだのに次の判断へ進んだ');
  await dc.close();

  // 狭い画面のシート: ボタンから広がり、閉じる動きを見せてから消える。色の覆いは途中まで残らない
  const nc = await browser.newContext({ viewport: { width: 900, height: 800 }, colorScheme: 'light', reducedMotion: 'no-preference' });
  const np = await nc.newPage(); await np.goto(url); await np.waitForSelector('html[data-hp-ready]'); await quiet(np);
  await np.click('.hp-respond');
  if (!(await running(np))) fail('マウスで開いたシートが動かない');
  const sheetEnd = await np.evaluate(() => Math.round(Math.max(0, ...document.getAnimations().filter((a) => !(a instanceof CSSTransition)).map((a) => a.effect.getComputedTiming().endTime))));
  if (sheetEnd > 300) fail(`狭い画面のシートが開ききるまで ${sheetEnd}ms かかる(300ms 以内にする)`);
  await np.waitForTimeout(110);
  if (await np.evaluate(() => { const c = document.querySelector('.hp-cmp-cover'); return c && +getComputedStyle(c).opacity > 0.05; })) fail('シートが広がる途中で色の覆いが残る');
  await quiet(np);
  if (await np.evaluate(() => getComputedStyle(document.querySelector('.hp-composer')).clipPath) !== 'none') fail('シートの clip-path が残る');
  await np.click('.hp-cmp-close');
  if (!(await np.evaluate(() => document.querySelector('.hp-composer').open))) fail('閉じる動きを待たずにシートが消える');
  await np.waitForFunction(() => !document.querySelector('.hp-composer').open, null, { timeout: 3000 }).catch(() => fail('閉じる動きの後にシートが残る'));
  await np.keyboard.press('r');
  if (await running(np)) fail('r で開いたシートが動く');
  await np.keyboard.press('Escape');
  if (await np.evaluate(() => document.querySelector('.hp-composer').open)) fail('Esc でシートがすぐ閉じない');
  await nc.close();

  // reduced motion: 位置・高さの動きはなし
  const r = await open({ width: 900, height: 800 });
  await r.page.click('hp-claim .hp-toggle');
  const moved = await r.page.evaluate(() => document.getAnimations().flatMap((a) => a.effect?.getKeyframes?.() || []).some((k) => k.translate || k.height || k.filter));
  if (moved) errors.push('動き: reduced motion で位置や高さが動く');
  // 最初の claim は開いているので、閉じてからもう一度押して開く
  await r.page.click('hp-claim .hp-toggle');
  if (await r.page.evaluate(() => document.getAnimations().flatMap((a) => a.effect?.getKeyframes?.() || []).some((k) => k.translate || k.height || k.filter))) errors.push('動き: reduced motion で claim を開くと位置や高さが動く');
  if (!(await r.page.evaluate(() => document.getAnimations().some((a) => a.effect?.getKeyframes?.().some((k) => k.opacity != null))))) errors.push('動き: reduced motion で claim を開いても何も変わらない(透明度の変化まで止めている)');
  await r.page.click('.hp-respond');
  const moved2 = await r.page.evaluate(() => document.getAnimations().flatMap((a) => a.effect?.getKeyframes?.() || []).some((k) => k.translate || k.clipPath));
  if (moved2) errors.push('動き: reduced motion でシートが動く');
  if (!(await r.page.evaluate(() => document.getAnimations().some((a) => a.effect?.getKeyframes?.().some((k) => k.opacity != null))))) errors.push('動き: reduced motion でシートを開いても何も変わらない');
  await r.ctx.close();
}

/* ── 図の動き: 状態図は実際にある遷移だけを点でたどり、画面はちらつかない。取り消しは深さの順に及ぶ。番号と注記は連動する ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', reducedMotion: 'no-preference' });
  const page = await ctx.newPage(); const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(url); await page.waitForSelector('html[data-hp-ready]'); await quiet(page);
  await page.evaluate(() => window.HtmlPlan.expandAll()); await quiet(page);
  const fail = (m) => errors.push(`図: ${m}`);
  const mc = page.locator('figure.hp-machine').first();
  if (await mc.count()) {
    await mc.scrollIntoViewIfNeeded(); await quiet(page);
    const now = () => mc.evaluate((f) => f.querySelector('.hp-st[aria-pressed="true"]')?.dataset.id);
    const dotMoving = () => mc.evaluate((f) => f.querySelector('.hp-mc-dot')?.getAnimations().length > 0);
    const start = await now();
    await mc.locator('.hp-mc-outs button').first().click();
    if (!(await dotMoving())) fail('「次:」を押しても、点が遷移の線をたどらない');
    if (await mc.evaluate((f) => [...f.querySelectorAll('.hp-mc-screen > [data-state]')].some((s) => s.getAnimations().length))) fail('状態を変えると、下の画面の中身が動く(ちらつく)');
    await quiet(page);
    if ((await now()) === start) fail('点がたどったあとに状態が変わらない');
    // 直接の遷移がない状態を押したときは、ない遷移を見せない
    const back = await mc.evaluate((f, id) => !f.querySelector(`.hp-edge[data-from="${f.querySelector('.hp-st[aria-pressed="true"]').dataset.id}"][data-to="${id}"]`), start);
    if (back) { await mc.locator(`.hp-st[data-id="${start}"]`).click(); if (await dotMoving()) fail('直接の遷移がない状態を押しても、点が線をたどる'); await quiet(page); if ((await now()) !== start) fail('状態を押しても、その状態に移らない'); }
    // キーボードで押したときは動かさない
    await mc.locator('.hp-mc-outs button').first().focus(); await page.keyboard.press('Enter');
    if (await dotMoving()) fail('キーボードで遷移を押すと点が動く');
    await quiet(page);
    // 判断の案に合わせて、条件付きの遷移(例の計画の「再送」)が出入りする
    const retryOff = () => mc.evaluate((f) => f.querySelector('.hp-edge[data-from="failed"][data-to="sending"]')?.classList.contains('off'));
    if (!(await retryOff())) fail('選ばれていない案の遷移(再送)が描かれている');
    await page.evaluate(() => document.querySelector('input[name="retry"][value="3x5m"]').click()); await quiet(page);
    if (await retryOff()) fail('案を選んでも、その案の遷移(再送)が出ない');
    await page.evaluate(() => document.querySelector('input[name="retry"][value="none"]').click()); await quiet(page);
    if (!(await retryOff())) fail('案を戻しても、遷移(再送)が消えない');
    // 主な経路の再生: 押したときだけ一度たどって止まる。再生中に押すと止まる
    const play = mc.locator('.hp-mc-play');
    if (await play.count()) {
      await play.click(); let saw = false;
      for (let i = 0; i < 40 && (await play.textContent()) !== '主な経路を再生'; i++) { if (await dotMoving()) saw = true; await page.waitForTimeout(100); }
      if (!saw) fail('「主な経路を再生」で点が動かない');
      if ((await play.textContent()) !== '主な経路を再生') fail('「主な経路を再生」が終わっても止まらない');
      await play.click(); await page.waitForTimeout(150); await play.click(); await quiet(page);
      const stopped = await now(); await page.waitForTimeout(1200);
      if ((await now()) !== stopped || await dotMoving()) fail('再生中に押しても止まらない');
    } else fail('上の段が遷移でつながっているのに「主な経路を再生」が出ない');
  }
  // 呼び出しの木: 取り消し線が引かれ、子孫は深さの順に遅れて薄くなる
  const parent = await page.evaluate(() => { const rows = [...document.querySelectorAll('.hp-row')]; const i = rows.findIndex((r, k) => r.dataset.mark && r.querySelector('.hp-strike') && rows[k + 1] && +rows[k + 1].style.getPropertyValue('--d') > +r.style.getPropertyValue('--d')); if (i < 0) return -1; rows[i].dataset.checkRow = '1'; rows[i].scrollIntoView({ block: 'center' }); return i; });
  if (parent >= 0) {
    const row = page.locator('.hp-row[data-check-row]'); await row.hover(); await row.locator('.hp-strike').click();
    const st = await page.evaluate(() => ({ line: document.getAnimations().some((a) => a instanceof CSSTransition && a.effect.pseudoElement === '::after' && a.transitionProperty === 'transform'), delays: [...document.querySelectorAll('.hp-row.under-struck')].map((r) => ({ d: +r.style.getPropertyValue('--d'), ms: parseFloat(getComputedStyle(r).transitionDelay) * 1000 })).sort((a, b) => a.d - b.d) }));
    if (!st.line) fail('取り消し線が引かれる動きがない');
    // 深い行ほど遅れる(同じ深さは同じ遅れ)。DOM の並び順ではなく深さで比べる
    const bad = !st.delays.length || st.delays[0].ms < 50 || st.delays.some((x, i) => i && (x.d === st.delays[i - 1].d ? x.ms !== st.delays[i - 1].ms : x.ms <= st.delays[i - 1].ms));
    if (bad) fail(`取り消しの子孫が深さの順に薄くならない(${st.delays.map((x) => `深さ${x.d}:${x.ms}ms`).join(', ')})`);
    await quiet(page); await row.locator('.hp-strike').click(); await quiet(page);
  }
  // mock の番号と注記: マウスを載せたときとキーボードで入ったときに連動する
  const li = page.locator('.hp-plegend li').first();
  if (await li.count()) {
    const hl = () => li.evaluate((l) => l.closest('figure').querySelector('.hp-mpin').classList.contains('hl'));
    await li.scrollIntoViewIfNeeded(); await li.hover();
    if (!(await hl())) fail('注記の行にマウスを載せても、mock の番号が強調されない');
    await page.mouse.move(2, 2); await li.locator('button').first().focus();
    if (!(await hl())) fail('キーボードで注記の行に入っても、mock の番号が強調されない');
  }
  logs.forEach((m) => errors.push(`図: ${m}`));
  await ctx.close();
}

}

await browser.close();
writeFileSync(resolve(out, 'report.json'), JSON.stringify({ errors, warns }, null, 2));
warns.forEach((m) => console.log('  ⚠ ' + m));
errors.forEach((m) => console.log('  ✗ ' + m));
console.log(`${errors.length ? '✗' : '✓'} error ${errors.length} 件、warning ${warns.length} 件。screenshot と回答は ${out}`);
// 引数なしのときは、部品カタログも見た目の検査にかける
let catalogFailed = false;
if (DEFAULT) { console.log('examples/parts.html'); try { execFileSync(process.execPath, [fileURLToPath(import.meta.url), packTo('../examples/parts.html', 'parts.packed.html'), ...(opt('--browser') ? ['--browser', opt('--browser')] : [])], { stdio: 'inherit' }); } catch { catalogFailed = true; } }
process.exit(errors.length || catalogFailed ? 1 : 0);
