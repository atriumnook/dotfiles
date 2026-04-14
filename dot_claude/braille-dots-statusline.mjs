#!/usr/bin/env bun

import { basename } from 'node:path';

const BRAILLE = ' ⣀⣄⣤⣦⣶⣷⣿';
const R = '\x1b[0m';
const DIFF_MAX = 500;

// Midnight Navy neutral ramp (single hue, tone only — HSL ≈ 220°, 18%)
const T80 = '\x1b[38;2;162;170;188m'; // 数値 42% / ブランチ名
const T65 = '\x1b[38;2;108;117;138m'; // ラベル ctx/5h/7d
const T50 = '\x1b[38;2;68;78;99m';    // モデル名・cwd
const T35 = '\x1b[38;2;36;44;61m';    // セパレータ │

// Branch accents (git workflow semantics, high-chroma, dark-theme)
const BR_MAIN    = '\x1b[38;2;226;230;240m'; // main/master
const BR_DEV     = '\x1b[38;2;100;181;246m'; // develop/dev
const BR_FEAT    = '\x1b[38;2;38;222;129m';  // feat/*
const BR_FIX     = '\x1b[38;2;255;145;77m';  // fix/hotfix
const BR_RELEASE = '\x1b[38;2;179;136;255m'; // release/*

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

function brailleBar(pct, width = 8) {
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

function fmt(label, pct) {
  const p = Math.round(pct);
  return `${T65}${label}${R} ${gradient(pct)}${brailleBar(pct)}${R} ${T80}${p}%${R}`;
}

function branchColor(name) {
  if (/^(main|master)$/.test(name))         return BR_MAIN;
  if (/^(develop|dev)$/.test(name))         return BR_DEV;
  if (/^(feat|feature)\//.test(name))       return BR_FEAT;
  if (/^(fix|hotfix|bugfix)\//.test(name))  return BR_FIX;
  if (/^release\//.test(name))              return BR_RELEASE;
  return T65;
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
const parts = [`${T50}${model}${R}`];

const ctx = data?.context_window?.used_percentage;
if (ctx != null) parts.push(fmt('ctx', ctx));

const five = data?.rate_limits?.five_hour?.used_percentage;
if (five != null) parts.push(fmt('5h', five));

const week = data?.rate_limits?.seven_day?.used_percentage;
if (week != null) parts.push(fmt('7d', week));

const line1 = parts.join(` ${T35}│${R} `);

const cwd = data?.cwd ?? '';
const dir = cwd ? basename(cwd) : '';
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);

const segments = [];
if (dir) segments.push(`${T50}${dir}${R}`);
if (branch) {
  const color = branchColor(branch);
  const display = branch.length > 30 ? branch.slice(0, 29) + '…' : branch;
  segments.push(`${color}⣿${R} ${T80}${display}${R}`);
}

const unstaged = parseDiffStat(git(['diff', '--shortstat'], cwd));
const staged   = parseDiffStat(git(['diff', '--cached', '--shortstat'], cwd));
const add = unstaged.add + staged.add;
const del = unstaged.del + staged.del;

if (add > 0 || del > 0) {
  const addPct = Math.min(add / DIFF_MAX * 100, 100);
  const delPct = Math.min(del / DIFF_MAX * 100, 100);
  let diff = '';
  if (add > 0) diff += `\x1b[38;2;46;230;130m${brailleBar(addPct)}${R}`;
  if (add > 0 && del > 0) diff += ' ';
  if (del > 0) diff += `\x1b[38;2;255;82;82m${brailleBar(delPct)}${R}`;
  segments.push(diff);
}

const line2 = segments.join(` ${T35}│${R} `);
Bun.write(Bun.stdout, line2 ? `${line1}\n${line2}` : line1);
