import { describe, expect, test } from 'claude-code/testing'
import { ICON, MAX_TICKS, TITLE_MAX, tickGlyph, cellWidth, chooseLayout, fit, headlineParts, railWindow, turnLine } from './layout.ts'

describe('layout', () => {
  test('tick は全部同じ高さで、読んでいる位置だけ高い', () => {
    expect([tickGlyph(false), tickGlyph(true)]).toEqual(['⡄', '⡇'])
    // 移動できなかったプロンプトは点1つ。読んでいる位置ならそちらを優先
    expect([tickGlyph(false, true), tickGlyph(true, true)]).toEqual(['⠄', '⡇'])
  })

  test('上の余白を最優先で取り、残りの行数に応じて 枠付き → 2行 → 1行 → tick の右に並べる と縮む', () => {
    expect(chooseLayout(10)).toEqual({ card: 'boxed', cardRows: 4, margin: 1 })
    expect(chooseLayout(6).card).toBe('boxed')
    expect(chooseLayout(5)).toEqual({ card: 'plain', cardRows: 2, margin: 1 })
    expect(chooseLayout(3)).toEqual({ card: 'line', cardRows: 1, margin: 1 })
    expect(chooseLayout(2)).toEqual({ card: 'inline', cardRows: 0, margin: 1 })
    expect(chooseLayout(1)).toEqual({ card: 'inline', cardRows: 0, margin: 0 })
  })

  test('収まらないときは読んでいる位置を中心に切り出す', () => {
    expect(railWindow(5, 4, 80)).toEqual({ first: 0, size: 5, isClipped: false })
    const win = railWindow(100, 50, 42) // 20 個分の幅 → 両端の印を除いて 18 個
    expect(win).toEqual({ first: 41, size: 18, isClipped: true })
    expect(railWindow(100, 99, 42).first).toBe(82)
    expect(railWindow(500, 0, 1000).size).toBe(MAX_TICKS)
  })

  test('全角を2セルと数えて切り詰め、幅まで空白で埋める', () => {
    expect(cellWidth('あいう abc')).toBe(10)
    expect(fit('あいうえお', 7)).toBe('あいう…')
    expect(cellWidth(fit('あいうえお', 7))).toBe(7)
    expect(fit('a\n  b', 5)).toBe('a b  ')
  })

  test('カードの1行は、本文のすぐ後ろに要約を続け、残りを空白で埋める', () => {
    const wide = headlineParts('短い依頼', '12s', 200)
    expect(wide.title + wide.detail).toBe('短い依頼  12s')
    expect(cellWidth(wide.title + wide.detail + wide.pad)).toBe(200)
    // 本文は TITLE_MAX まで、要約は幅の半分まで
    const long = headlineParts('あ'.repeat(100), '1m 5s', 200)
    expect(cellWidth(long.title)).toBe(TITLE_MAX)
    const narrow = headlineParts('長い本文がここに入ります', '󰔛 3m 5s  9 tools', 20)
    expect(cellWidth(narrow.detail)).toBe(2 + 10)
    expect(cellWidth(narrow.title + narrow.detail + narrow.pad)).toBe(20)
    expect(headlineParts('本文だけ', '', 10)).toEqual({ title: '本文だけ', detail: '', pad: '  ' })
  })

  test('ターンの要約を Nerd Font のアイコンで添える', () => {
    expect(turnLine({ durationMs: 125_000, tools: 13, files: ['/r/a.ts', '/r/b.md', '/r/c.json'] }, false)).toBe(
      `${ICON.time} 2m 5s  ${ICON.tools} 13  ${ICON.file} a.ts +2`,
    )
    expect(turnLine({ spanMs: 12_000, tools: 1, files: [], outcome: 'interrupted' }, false)).toBe(`${ICON.time} 12s  ${ICON.interrupted} interrupted  ${ICON.tools} 1`)
    expect(turnLine({ durationMs: 5000, tools: 2, files: [] }, true)).toBe(`${ICON.running} running  ${ICON.tools} 2`)
    expect(turnLine(undefined, false)).toBe('')
    // アイコンは私用領域の文字で、端末では1セル
    expect(cellWidth(ICON.time + ICON.pillStart)).toBe(2)
  })
})
