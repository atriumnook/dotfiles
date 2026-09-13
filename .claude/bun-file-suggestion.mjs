#!/usr/bin/env bun

const { query } = await Bun.stdin.json();
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const fd = Bun.spawn(['fd', '--hidden'], { cwd, stdout: 'pipe' });
const fzf = Bun.spawn(['fzf', `--filter=${query}`], {
  stdin: fd.stdout,
  stdout: 'pipe',
});

const output = await new Response(fzf.stdout).text();
const lines = output.split('\n').filter(Boolean).slice(0, 20);
Bun.write(Bun.stdout, lines.join('\n'));
