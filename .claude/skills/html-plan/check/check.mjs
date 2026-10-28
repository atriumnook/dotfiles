#!/usr/bin/env node
// check.mjs — pack した計画ページを実ブラウザで開き、目で見る前に機械で分かる問題を検査する。
//   node check.mjs plan.packed.html [--out <dir>] [--browser <chromium のパス>]
// 3 つの幅 × ライト/ダークで、axe-core(WCAG 2.2 AA)、横のはみ出し、mock の幅超え、
// state 図のラベルの重なりを調べ、全体の screenshot を保存する。最後にキーボードだけで
// 判断・コメント・取り消し・編集・回答まで進められるかを確かめる。問題があれば exit 1。
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const page0 = args.find((a, i) => !a.startsWith('--') && !['--out', '--browser'].includes(args[i - 1]));
if (!page0) { console.error('usage: node check.mjs plan.packed.html [--out <dir>] [--browser <path>]'); process.exit(2); }
const url = pathToFileURL(resolve(page0)).href;
const out = resolve(opt('--out') || resolve(page0, '..', basename(page0, '.html') + '.check'));
mkdirSync(out, { recursive: true });
const exe = opt('--browser') || process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);

const errors = [], warns = [];
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const AXE = require.resolve('axe-core/axe.min.js');

async function open(viewport, colorScheme) {
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

/* ── 見た目の検査 ── */
for (const width of [390, 768, 1280]) for (const scheme of ['light', 'dark']) {
  const tag = `${width}px ${scheme}`;
  const { ctx, page, logs } = await open({ width, height: 900 }, scheme);
  if (width === 1280 && scheme === 'light') await page.screenshot({ path: resolve(out, 'closed.png'), fullPage: true });
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
  await page.screenshot({ path: resolve(out, `${width}-${scheme}.png`), fullPage: true });
  await ctx.close();
}

/* ── キーボードだけで最後まで進めるか ── */
{
  const { ctx, page, logs } = await open({ width: 1280, height: 900 }, 'light');
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('html[data-hp-ready]');
  const fail = (m) => errors.push(`キーボード: ${m}`);
  const active = () => page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, ask: !!a?.closest('fieldset.hp-ask'), cls: a?.className || '', text: (a?.textContent || '').trim().slice(0, 40) }; });
  const pending = () => page.evaluate(() => +document.documentElement.dataset.hpPending);
  const total = await pending();
  await page.keyboard.press('n');
  if (!(await active()).ask) fail('n で未確認の判断に移らない');
  await page.keyboard.press('2'); await settle(page);
  for (let i = 0; i < 12 && (await pending()) > 0; i++) {
    await page.keyboard.press('n'); if (!(await active()).ask) { fail('n で次の未確認の判断に移らない'); break; }
    await page.keyboard.press('Enter'); await settle(page);
  }
  if (await pending()) fail(`判断が ${await pending()} 件未確認のまま残った`);
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
  const md = await page.evaluate(() => document.querySelector('dialog[open] textarea')?.value || '');
  if (!md) fail('r で回答のダイアログが開かない');
  const expect = { '## 判断': '判断の節', '(変更。提案は': '変えた判断', '(提案のまま確認)': '確認した判断', '期限のないタスク': 'claim へのコメント', 'ここは 404': '行へのコメント', '## 編集': '編集の節', '+ALTER TABLE': '編集の diff' };
  if (strikeRow) expect['## 取り消し'] = '取り消しの節';
  Object.entries(expect).forEach(([s, what]) => { if (!md.includes(s)) fail(`回答に${what}がない(「${s}」)`); });
  if (md.includes('未確認')) fail('すべて確認したのに回答に「未確認」が残る');
  if (md.indexOf('期限のないタスク') > md.indexOf('ここは 404')) fail('回答のコメントがページ上の順に並んでいない');
  writeFileSync(resolve(out, 'response.md'), md);
  await page.keyboard.press('Escape');
  // 再読み込みしても回答が残るか
  await page.reload(); await page.waitForSelector('html[data-hp-ready]');
  const kept = await page.evaluate(() => window.HtmlPlan.markdown());
  if (!kept.includes('期限のないタスク') || +(await page.evaluate(() => document.documentElement.dataset.hpPending)) !== 0) fail('再読み込みで回答が消えた');
  logs.forEach((m) => errors.push(`キーボード: ${m}`));
  if (total < 1) warns.push('判断が1つもないので、判断の操作は検査していない');
  await ctx.close();
}

await browser.close();
writeFileSync(resolve(out, 'report.json'), JSON.stringify({ errors, warns }, null, 2));
warns.forEach((m) => console.log('  ⚠ ' + m));
errors.forEach((m) => console.log('  ✗ ' + m));
console.log(`${errors.length ? '✗' : '✓'} error ${errors.length} 件、warning ${warns.length} 件。screenshot と回答は ${out}`);
process.exit(errors.length ? 1 : 0);
