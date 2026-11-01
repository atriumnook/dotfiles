// レールの見た目を決める純粋関数。位置と幅は端末のセルで数える。
import type { Turn } from './transcript.ts'

// 東アジアの全角と絵文字は2セル
const isWide = (code: number) =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe4f) ||
  (code >= 0xff00 && code <= 0xff60) ||
  (code >= 0xffe0 && code <= 0xffe6) ||
  (code >= 0x1f300 && code <= 0x1faff) ||
  (code >= 0x20000 && code <= 0x3fffd)

const cells = (char: string) => (isWide(char.codePointAt(0) ?? 0) ? 2 : 1)

export const cellWidth = (text: string) => [...text].reduce((sum, char) => sum + cells(char), 0)

// 1行に潰し、width セルを超える分を … で切ったうえで、width セルまで空白で埋める
export function fit(text: string, width: number) {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (width <= 0) return ''
  let out = ''
  let used = 0
  if (cellWidth(flat) > width) {
    for (const char of flat) {
      if (used + cells(char) > width - 1) break
      out += char
      used += cells(char)
    }
    out += '…'
    used += 1
  } else {
    out = flat
    used = cellWidth(flat)
  }
  return out + ' '.repeat(Math.max(0, width - used))
}

// 1行 width セルずつに折り返し、maxLines 行まで返す。収まらない分は最後の行を … で切る。
// 各行は width セルまで空白で埋める
export function wrap(text: string, width: number, maxLines: number) {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lines: string[] = []
  let line = ''
  let used = 0
  for (const char of flat) {
    if (used + cells(char) > width) {
      lines.push(line)
      line = ''
      used = 0
    }
    line += char
    used += cells(char)
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = fit(lines[maxLines - 1]! + '……', width)
  }
  return lines.map(l => fit(l, width))
}

export function duration(ms: number) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

// Nerd Font のアイコン(端末のフォントが Nerd Font であること前提)
export const ICON = {
  time: '\u{f051b}', // 󰔛 timer-outline
  tools: '\u{f0ad}', //  wrench
  file: '\u{f0214}', // 󰈔 file
  running: '\u{f046e}', // 󰑮 run
  interrupted: '\u{f03e4}', // 󰏤 pause
  error: '\u{ea87}', //  error
  pillStart: '\u{e0b6}', //  丸い左端
  pillEnd: '\u{e0b4}', //  丸い右端
} as const

// ターンの要約: `󰔛 2m 5s   13  󰈔 app.ts +2`。分からない部分は省く
export function turnLine(turn: Turn | undefined, isRunning: boolean) {
  const parts: string[] = []
  const ms = turn?.durationMs ?? turn?.spanMs
  if (isRunning) parts.push(`${ICON.running} running`)
  else if (ms !== undefined) parts.push(`${ICON.time} ${duration(ms)}`)
  if (turn?.outcome === 'interrupted') parts.push(`${ICON.interrupted} interrupted`)
  if (turn?.outcome === 'error') parts.push(`${ICON.error} API error`)
  if (turn && turn.tools > 0) parts.push(`${ICON.tools} ${turn.tools}`)
  if (turn && turn.files.length > 0) {
    const rest = turn.files.length - 1
    parts.push(`${ICON.file} ${baseName(turn.files[0]!)}${rest > 0 ? ` +${rest}` : ''}`)
  }
  return parts.join('  ')
}

// tick を置く行ごとの、プロンプトの番号。count 個を rows 行に古い順で等間隔に置き、
// 最新を一番下にする。count が rows を超えると、同じ行に複数のプロンプトが入る
export function tickRows(count: number, rows: number): number[][] {
  const out: number[][] = Array.from({ length: Math.max(1, rows) }, () => [])
  const last = out.length - 1
  for (let i = 0; i < count; i++) out[count === 1 ? last : Math.round((i * last) / (count - 1))]!.push(i)
  return out
}

// カードの幅
export const CARD_MAX = 56
export const cardWidth = (columns: number) => Math.max(20, Math.min(CARD_MAX, columns - 4))

// カードの上端の行。tick の行に合わせ、viewport の下にはみ出すなら上へ寄せる
export const cardTop = (tickRow: number, cardRows: number, height: number) => Math.max(0, Math.min(tickRow, height - cardRows))
