import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { applyIndex, currentIndex, groupKey, landOn, measure, newRail, nextTarget, noteDrawn, report, rowKey, screenOrder } from './index.tsx'

const prompt = (text: string, onScreen: { first: number; last: number; of: number } | null) => ({
  text,
  origin: { kind: 'composer' as const },
  isExpanded: false,
  onScreen,
})

const band = (view: { agentId?: string } = {}) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view,
})

const FULLSCREEN = { columns: 80, rows: 30, isFullscreen: true }

// エンジン自身の描画の代わり
const engineDraws = (on: On) => {
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const UUIDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']

// 3つのプロンプト行を描く。2つ目は上の2行が viewport の上にはみ出し、3つ目は全体が見えている
const drawPrompts = async ($: any, viewport: object = FULLSCREEN) => {
  const mount = (i: number, text: string, onScreen: { first: number; last: number; of: number } | null) =>
    $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'UserMessage', requestId: UUIDS[i], viewport, props: prompt(text, onScreen) })
  return [await mount(0, '最初のプロンプト', null), await mount(1, '二つ目のプロンプト', { first: 2, last: 3, of: 4 }), await mount(2, '三つ目のプロンプト', { first: 0, last: 3, of: 4 })]
}

test('見えている行のうち一番下の行だけが、右端に tick を等間隔に描く', async ($, on) => {
  const clock = mock.clock(on)
  engineDraws(on)
  const [, second, third] = await drawPrompts($)
  await clock.advance(10)

  // viewport は 2つ目の見えている2行と、3つ目の4行で6行。最後の行は「Jump to bottom」が
  // pointer を取るので、最新の tick はその1つ上の行に来る
  const ticks = await third!.findAll({ type: 'Button' })
  expect(ticks.map((t: any) => t.key)).toEqual(['jump-0', 'jump-2', 'jump-4'])
  const column = (await third!.drawn()) as any
  const tops = column.children.slice(1).map((box: any) => box.props.top)
  // 3つ目の行の先頭は viewport の上端から2行下にある
  expect(tops).toEqual([-2, 0, 2])
  expect(column.children.slice(1).every((box: any) => box.props.left === 79)).toBe(true)
  // 上の行は、後に描かれる行に塗られるので描かない
  expect(await second!.findAll({ type: 'Button' })).toHaveLength(0)
})

test('見えている範囲の tick は Claude の色で、読んでいる位置は白の太字で示す', async ($, on) => {
  const clock = mock.clock(on)
  engineDraws(on)
  const [, , third] = await drawPrompts($)
  await clock.advance(10)

  const marks = await third!.findAll({ type: 'Text', text: '━' })
  // 見えていない tick も背景に溶けない inactive で描く
  expect(marks.map((t: any) => t.props.color)).toEqual(['inactive', 'text', 'claude'])
  expect(marks.map((t: any) => t.props.weight)).toEqual([undefined, 'semibold', undefined])
  // pointer を乗せたときのカード。本文とターンの要約を枠に入れ、隠しておく
  expect(await third!.find({ type: 'Text', text: /最初のプロンプト/ })).toBeDefined()
  const cards = (await third!.drawn()) as any
  expect(cards.children[1].children[1].props).toMatchObject({ position: 'absolute', display: 'none' })
})

test('fullscreen でないときは、右端の列を描かない', async ($, on) => {
  const clock = mock.clock(on)
  engineDraws(on)
  const [, , third] = await drawPrompts($, { columns: 80, rows: 30, isFullscreen: false })
  await clock.advance(10)
  expect(await third!.findAll({ type: 'Button' })).toHaveLength(0)
})

test('帯には何も描かず、エンジンの描画に任せる', async ($, on) => {
  engineDraws(on)
  await drawPrompts($)
  const ui = await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'AbovePrompt', props: band() })
  expect(((await ui.drawn()) as any).children).toEqual(['engine'])
})

test('tick を押してスクロールを断られたら、その理由をトーストで伝える', async ($, on) => {
  const clock = mock.clock(on)
  engineDraws(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const [, , third] = await drawPrompts($)
  await clock.advance(10)

  await third!.press({ key: 'jump-0' })
  await clock.advance(10)
  // テストキットはトランスクリプト行へのスクロールに答えないので、その断りがそのまま届く
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^1 へジャンプできません: /)
})

test('見えている行の上下は、描かれた順ではなくトランスクリプトでの順番で決める', () => {
  const rail = newRail()
  applyIndex(rail, {
    prompts: [{ id: UUIDS[0]!, text: 'a', turn: { tools: 0, files: [] } }],
    owners: new Map([['tool-1', 0]]),
    order: new Map([[UUIDS[0]!, 0], ['tool-1', 1]]),
  })
  // 後から描かれても、トランスクリプトで前にある行が上
  report(rail, 'ToolResult\u0000tool-1', 'tool-1', { first: 0, last: 2, of: 3 })
  report(rail, 'ToolUse\u0000tool-1', 'tool-1', { first: 1, last: 1, of: 2 })
  report(rail, `UserMessage\u0000${UUIDS[0]}`, rowKey(UUIDS[0]!), null)
  expect(rail.top).toBe('ToolUse\u0000tool-1')
  expect(rail.bottom).toBe('ToolResult\u0000tool-1')
  // 上の行: 見えている分(of - first)、下の行: last + 1
  expect(rail.height).toBe(1 + 3)
  report(rail, `UserMessage\u0000${UUIDS[0]}`, rowKey(UUIDS[0]!), { first: 3, last: 4, of: 5 })
  expect(rail.top).toBe(`UserMessage\u0000${UUIDS[0]}`)
  expect(rail.height).toBe(2 + 2 + 3)
})

test('思考だけのツール群とロゴの下の行は、トランスクリプトに無い行として一番下に並べない', () => {
  const rail = newRail()
  applyIndex(rail, {
    prompts: [{ id: UUIDS[0]!, text: 'a', turn: { tools: 0, files: [] } }],
    owners: new Map(),
    order: new Map([
      [UUIDS[0]!, 0],
      [UUIDS[1]!, 1],
      [UUIDS[2]!, 2],
    ]),
  })
  const group = groupKey([], `collapsed-${UUIDS[1]}`)
  expect(group).toBe(rowKey(UUIDS[1]!))
  expect(groupKey([{}, { tool_use_id: 'tool-1' }], `collapsed-${UUIDS[1]}`)).toBe('tool-1')
  report(rail, 'InfoNotice\u0000notice-1', 'notice-1', { first: 0, last: 0, of: 1 })
  report(rail, `ToolGroup\u0000collapsed-${UUIDS[1]}`, group, { first: 0, last: 1, of: 2 })
  report(rail, `AssistantMessage\u0000${UUIDS[2]}`, rowKey(UUIDS[2]!), { first: 0, last: 2, of: 5 })
  expect(screenOrder(rail).map(row => row.name.slice(0, row.name.indexOf('\u0000')))).toEqual(['InfoNotice', 'ToolGroup', 'AssistantMessage'])
  expect(rail.height).toBe(1 + 2 + 3)
})

test('着地した行より上に残った行を消し、着地した行を読んでいる位置にする', () => {
  const rail = newRail()
  applyIndex(rail, {
    prompts: UUIDS.map((id, i) => ({ id, text: `プロンプト ${i + 1}`, turn: { tools: 0, files: [] } })),
    owners: new Map(),
    order: new Map(UUIDS.map((id, i) => [id, i])),
  })
  UUIDS.forEach(id => report(rail, `UserMessage\u0000${id}`, rowKey(id), { first: 0, last: 1, of: 2 }))
  // 分割描画された行は uuid の最終グループが変わるが、同じプロンプトとして扱う
  landOn(rail, `${UUIDS[1]!.slice(0, 24)}000000000001`)
  expect([...rail.screen.keys()]).not.toContain(`UserMessage\u0000${UUIDS[0]}`)
  expect(currentIndex(rail)).toBe(1)
  measure(rail)
  expect(rail.top).toBe(`UserMessage\u0000${UUIDS[1]!.slice(0, 24)}000000000001`)
})

test('まとめた行を押すと、上端にあるプロンプトの次へ移り、最後の次は最初に戻る', () => {
  const rail = newRail()
  UUIDS.forEach((id, i) => noteDrawn(rail, id, `プロンプト ${i + 1}`))
  expect(nextTarget(rail, [0, 1, 2])).toBe(0)
  report(rail, `UserMessage\u0000${UUIDS[1]}`, rowKey(UUIDS[1]!), { first: 0, last: 1, of: 2 })
  expect(nextTarget(rail, [0, 1, 2])).toBe(2)
  report(rail, `UserMessage\u0000${UUIDS[1]}`, rowKey(UUIDS[1]!), null)
  report(rail, `UserMessage\u0000${UUIDS[2]}`, rowKey(UUIDS[2]!), { first: 0, last: 1, of: 2 })
  expect(nextTarget(rail, [0, 1, 2])).toBe(0)
  expect(nextTarget(rail, [1])).toBe(1)
})

test('トランスクリプトに保存された行は、描かれた行と重ねて載せない', () => {
  const rail = newRail()
  noteDrawn(rail, UUIDS[0]!, '最初のプロンプト')
  noteDrawn(rail, 'not-a-uuid', '保存前のプロンプト')
  applyIndex(rail, {
    prompts: [
      { id: UUIDS[0]!, text: '最初のプロンプト', turn: { tools: 0, files: [] } },
      { id: UUIDS[1]!, text: '保存前のプロンプト', turn: { tools: 0, files: [] } },
    ],
    owners: new Map(),
    order: new Map([
      [UUIDS[0]!, 0],
      [UUIDS[1]!, 1],
    ]),
  })
  expect(rail.list.map(entry => entry.id)).toEqual([UUIDS[0], UUIDS[1]])
})

test('読んでいる位置は、見えているプロンプトの行を、それより前の応答の行より優先する', () => {
  const rail = newRail()
  UUIDS.forEach((id, i) => noteDrawn(rail, id, `プロンプト ${i + 1}`))
  applyIndex(rail, { prompts: [], owners: new Map([['a0', 0]]), order: new Map() })
  report(rail, 'AssistantMessage\u0000a0', 'a0', { first: 0, last: 1, of: 2 })
  expect(currentIndex(rail)).toBe(0)
  report(rail, `UserMessage\u0000${UUIDS[2]}`, rowKey(UUIDS[2]!), { first: 0, last: 1, of: 2 })
  expect(currentIndex(rail)).toBe(2)
})
