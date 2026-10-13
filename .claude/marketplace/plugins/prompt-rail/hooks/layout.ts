// 帯の見た目を決める純粋関数。Preview Rail(beUI)の寸法を端末のセルに置き換える。
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

// カードの1行: 本文のすぐ後ろに2セル空けて要約を続け、残りを空白で埋めて width セルにする。
// 本文は TITLE_MAX セルまで、要約は width の半分まで。右端に寄せると、広い端末で本文から離れすぎる
export const TITLE_MAX = 60
export function headlineParts(title: string, detail: string, width: number) {
  const detailW = detail ? Math.min(cellWidth(detail), Math.floor(width / 2)) : 0
  const room = Math.max(1, width - (detail ? detailW + 2 : 0))
  const titleW = Math.min(cellWidth(title.replace(/\s+/g, ' ').trim()), TITLE_MAX, room)
  const head = fit(title, titleW)
  const tail = detail ? `  ${fit(detail, detailW)}` : ''
  return { title: head, detail: tail, pad: ' '.repeat(Math.max(0, width - titleW - cellWidth(tail))) }
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

// tick は点字1文字。Preview Rail の休止時と同じく全部同じ高さにそろえ、読んでいる
// 位置だけを高く(点4つ)する。移動できなかったプロンプトは点1つで区別する
export const tickGlyph = (isCurrent: boolean, isUnreachable = false) =>
  isCurrent ? '\u{2847}' : isUnreachable ? '\u{2804}' : '\u{2844}' // ⡇ / ⠄ / ⡄

// 帯の行数の内訳。入力欄の上に使える行数(maxRows)は端末の高さで変わり、実際には
// 2行ほどしか無いことが多い。トランスクリプトとの間の余白(1行)を最優先で取り、
// 残りでカードを大きくする。2行しか無ければ、カードを tick と同じ行の右に並べる
// ('inline')。下側はエンジンが1行空けている。
export type Layout = { card: 'boxed' | 'plain' | 'line' | 'inline'; cardRows: number; margin: number }
export function chooseLayout(maxRows: number): Layout {
  if (maxRows >= 1 + 4 + 1) return { card: 'boxed', cardRows: 4, margin: 1 }
  if (maxRows >= 1 + 2 + 1) return { card: 'plain', cardRows: 2, margin: 1 }
  if (maxRows >= 1 + 1 + 1) return { card: 'line', cardRows: 1, margin: 1 }
  return { card: 'inline', cardRows: 0, margin: maxRows >= 2 ? 1 : 0 }
}

// tick は2セルおき。左端は少し空ける: ウィンドウ端だとポインタが最初の tick を
// 離れる瞬間をホバー終了として拾えない
export const RAIL_INSET = 2
export const TICK_GAP = 2
// 一度に描く tick の上限。カードの重ね描きで描画の文字数上限に近づかないようにする
export const MAX_TICKS = 60

// 収まらない数のプロンプトは、読んでいる位置を中心にした範囲だけ描き、‹ › で続きを示す
export function railWindow(count: number, center: number, width: number) {
  const fits = Math.max(1, Math.floor((width - RAIL_INSET) / TICK_GAP))
  if (count <= Math.min(fits, MAX_TICKS)) return { first: 0, size: count, isClipped: false }
  const size = Math.max(1, Math.min(fits - 2, MAX_TICKS))
  const first = Math.min(Math.max(0, center - Math.floor(size / 2)), count - size)
  return { first, size, isClipped: true }
}

// カードの幅と、tick の真上に来る左端位置
export const CARD_MAX = 56
export const cardWidth = (width: number) => Math.max(12, Math.min(CARD_MAX, width))
export const cardLeft = (tickX: number, width: number) => Math.max(0, Math.min(tickX - 3, width - cardWidth(width)))
