#!/usr/bin/env bun

import { basename } from 'node:path';

const BRAILLE = ' ⣀⣄⣤⣦⣶⣷⣿';
const R = '\x1b[0m';

// Midnight Navy neutral ramp (single hue, tone only — HSL ≈ 220°, 18%)
// ダーク背景 (#1e1e2e 想定) でのコントラスト比: VALUE 8.6 > IDENT 6.2 > LABEL 3.8 > SEP
const VALUE = '\x1b[38;2;180;188;206m'; // 数値 42% / 47m
const IDENT = '\x1b[38;2;150;159;180m'; // モデル名・cwd・規則外ブランチ
const LABEL = '\x1b[38;2;112;121;143m'; // ラベル ctx/5h/7d・残り時間・cold
const SEP   = '\x1b[38;2;62;70;90m';    // セパレータ │

const ADD  = '\x1b[38;2;46;230;130m';
const DEL  = '\x1b[38;2;255;92;92m';

// Branch accents (git workflow semantics, high-chroma, dark-theme)
const BR_MAIN    = '\x1b[38;2;226;230;240m'; // main/master
const BR_DEV     = '\x1b[38;2;100;181;246m'; // develop/dev
const BR_FEAT    = '\x1b[38;2;38;222;129m';  // feat/*
const BR_FIX     = '\x1b[38;2;255;145;77m';  // fix/hotfix
const BR_RELEASE = '\x1b[38;2;179;136;255m'; // release/*

// effort.level: 略号＋段階色でレベルを符号化。
// ultracode はドキュメント上 xhigh として報告される場合があるため両方を定義し、
// 未知値は EFFORT 外として生の文字列を中間色で表示する(将来値でも壊れない)。
const EFFORT = {
  low:       { abbr: 'lo',  tone: LABEL },
  medium:    { abbr: 'md',  tone: IDENT },
  high:      { abbr: 'hi',  tone: VALUE },
  xhigh:     { abbr: 'xh',  tone: '\x1b[38;2;200;206;220m' },
  max:       { abbr: 'max', tone: '\x1b[38;2;179;136;255m' },
  ultracode: { abbr: 'uc',  tone: '\x1b[38;2;255;128;191m' },
};

function effortSeg(level) {
  if (level == null) return '';
  const e = EFFORT[level];
  if (!e) return `${IDENT}${level}${R}`; // 未知値フォールバック
  return `${e.tone}${e.abbr}${R}`;
}

// Gradient stops: traffic-light semantics
const G_LO  = [46, 230, 130];
const G_MID = [255, 214, 0];
const G_HI  = [255, 82, 82];

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function gradient(pct) {
  pct = Math.min(Math.max(pct, 0), 100);
  let r, g, b;
  if (pct < 50) {
    const t = pct / 50;
    r = lerp(G_LO[0], G_MID[0], t);
    g = lerp(G_LO[1], G_MID[1], t);
    b = lerp(G_LO[2], G_MID[2], t);
  } else {
    const t = (pct - 50) / 50;
    r = lerp(G_MID[0], G_HI[0], t);
    g = lerp(G_MID[1], G_HI[1], t);
    b = lerp(G_MID[2], G_HI[2], t);
  }
  return `\x1b[38;2;${r};${g};${b}m`;
}

function brailleBar(pct, width = 6) {
  pct = Math.min(Math.max(pct, 0), 100);
  const level = pct / 100;
  let bar = '';
  for (let i = 0; i < width; i++) {
    const segStart = i / width;
    const segEnd = (i + 1) / width;
    if (level >= segEnd) {
      bar += BRAILLE[7];
    } else if (level <= segStart) {
      bar += BRAILLE[0];
    } else {
      const frac = (level - segStart) / (segEnd - segStart);
      bar += BRAILLE[Math.min(Math.floor(frac * 7), 7)];
    }
  }
  return bar;
}

// resets_at (Unix epoch 秒) からリセットまでの残り時間を適応単位で整形
function fmtRemaining(resetsAt) {
  if (resetsAt == null) return '';
  let s = resetsAt - Math.floor(Date.now() / 1000);
  if (s <= 0) return ''; // リセット済み・過去は非表示
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600);  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function fmt(label, pct, resetsAt) {
  const p = Math.round(pct);
  const base = `${LABEL}${label}${R} ${gradient(pct)}${brailleBar(pct)}${R} ${VALUE}${p}%${R}`;
  const rem = fmtRemaining(resetsAt);
  return rem ? `${base} ${LABEL}${rem}${R}` : base;
}

// prompt_cache: 失効までの残り時間。失効済みは cold
function cacheSeg(pc) {
  if (!pc?.caching_observed) return '';
  const rem = pc.warm ? fmtRemaining(pc.expires_at) : '';
  return rem ? `${LABEL}cache${R} ${VALUE}${rem}${R}` : `${LABEL}cache${R} ${LABEL}cold${R}`;
}

function branchColor(name) {
  if (/^(main|master)$/.test(name))         return BR_MAIN;
  if (/^(develop|dev)$/.test(name))         return BR_DEV;
  if (/^(feat|feature)\//.test(name))       return BR_FEAT;
  if (/^(fix|hotfix|bugfix)\//.test(name))  return BR_FIX;
  if (/^release\//.test(name))              return BR_RELEASE;
  return IDENT;
}

// execSync 廃止。シェルを挟まないので Windows でも問題なく動く
function git(args, cwd) {
  if (!cwd) return '';
  try {
    const result = Bun.spawnSync(['git', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) return '';
    return result.stdout.toString().trim();
  } catch {
    return '';
  }
}

function parseDiffStat(raw) {
  let add = 0, del = 0;
  const m1 = raw.match(/(\d+) insertion/);
  const m2 = raw.match(/(\d+) deletion/);
  if (m1) add = parseInt(m1[1]);
  if (m2) del = parseInt(m2[1]);
  return { add, del };
}

const data = await Bun.stdin.json();
const model = data?.model?.display_name ?? 'Claude';
const effort = effortSeg(data?.effort?.level);
const parts = [effort ? `${IDENT}${model}${R} ${effort}` : `${IDENT}${model}${R}`];

const cache = cacheSeg(data?.prompt_cache);
if (cache) parts.push(cache);

const ctx = data?.context_window?.used_percentage;
if (ctx != null) parts.push(fmt('ctx', ctx));

const five = data?.rate_limits?.five_hour?.used_percentage;
if (five != null) parts.push(fmt('5h', five, data?.rate_limits?.five_hour?.resets_at));

const week = data?.rate_limits?.seven_day?.used_percentage;
if (week != null) parts.push(fmt('7d', week, data?.rate_limits?.seven_day?.resets_at));

const line1 = parts.join(` ${SEP}│${R} `);

const cwd = data?.workspace?.current_dir ?? data?.cwd ?? '';
const dir = cwd ? basename(cwd) : '';
const worktree = data?.workspace?.git_worktree; // linked worktree 内でのみ存在
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);

const segments = [];
// worktree 名がディレクトリ名と同じなら dir に wt ラベルを付けるだけにする
if (dir) segments.push(worktree === dir ? `${LABEL}wt${R} ${IDENT}${dir}${R}` : `${IDENT}${dir}${R}`);
if (worktree && worktree !== dir) segments.push(`${LABEL}wt${R} ${VALUE}${worktree}${R}`);
if (branch) {
  const display = branch.length > 30 ? branch.slice(0, 29) + '…' : branch;
  segments.push(`${branchColor(branch)}${display}${R}`);
}

// HEAD 基準の正味差分(staged + unstaged を1回で取得し、二重計上を避ける)
const { add, del } = parseDiffStat(git(['diff', 'HEAD', '--shortstat'], cwd));
const diff = [];
if (add > 0) diff.push(`${ADD}+${add}${R}`);
if (del > 0) diff.push(`${DEL}-${del}${R}`);
if (diff.length) segments.push(diff.join(' '));

const line2 = segments.join(` ${SEP}│${R} `);
await Bun.write(Bun.stdout, line2 ? `${line1}\n${line2}` : line1);
