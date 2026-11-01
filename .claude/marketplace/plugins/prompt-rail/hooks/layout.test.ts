import { describe, expect, test } from 'claude-code/testing'
import { ICON, cardTop, cellWidth, fit, tickRows, turnLine, wrap } from './layout.ts'

describe('layout', () => {
  test('tick は古い順に上から等間隔に並び、最新が一番下に来る', () => {
    expect(tickRows(3, 5)).toEqual([[0], [], [1], [], [2]])
    expect(tickRows(1, 5)).toEqual([[], [], [], [], [0]])
    expect(tickRows(0, 3)).toEqual([[], [], []])
    // 行数と同じ数なら1行に1つずつ
    expect(tickRows(4, 4)).toEqual([[0], [1], [2], [3]])
  })

  test('行数を超えるプロンプトは、同じ行にまとめる。順番は入れ替えない', () => {
    const rows = tickRows(7, 3)
    expect(rows.flat()).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(rows.every(row => row.length > 0)).toBe(true)
    expect(rows.at(-1)).toContain(6)
  })

  test('カードは tick の行に合わせ、下にはみ出すなら上へ寄せ、viewport の上端より上には出さない', () => {
    expect(cardTop(3, 4, 20)).toBe(3)
    expect(cardTop(18, 4, 20)).toBe(16)
    expect(cardTop(5, 30, 20)).toBe(0)
  })

  test('本文を幅で折り返し、行数を超える分を … で切る', () => {
    expect(wrap('あいうえおかきくけこ', 6, 4)).toEqual(['あいう', 'えおか', 'きくけ', 'こ    '])
    const cut = wrap('あいうえおかきくけこ', 6, 2)
    expect(cut).toEqual(['あいう', 'えお…'.padEnd(4)])
    expect(cut.map(cellWidth)).toEqual([6, 6])
    expect(wrap('a\n  b', 5, 2)).toEqual(['a b  '])
  })

  test('全角を2セルと数えて切り詰め、幅まで空白で埋める', () => {
    expect(cellWidth('あいう abc')).toBe(10)
    expect(fit('あいうえお', 7)).toBe('あいう…')
    expect(cellWidth(fit('あいうえお', 7))).toBe(7)
    expect(fit('a\n  b', 5)).toBe('a b  ')
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
