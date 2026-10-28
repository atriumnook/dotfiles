import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { applyIndex, currentIndex, landOn, newRail, noteDrawn, refusalNotice, rowKey } from './index.tsx'

const prompt = (text: string, onScreen: { first: number; last: number; of: number } | null) => ({
  text,
  origin: { kind: 'composer' as const },
  isExpanded: false,
  onScreen,
})

const band = (maxRows: number, view: { agentId?: string } = {}) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: maxRows },
  view,
})

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

// 帯の描画のうちレールの部分。先頭はレールより下にある描画(engineDraws の engine)
const railOf = (drawn: any) => drawn.children[1]

const UUIDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']

// 3つのプロンプト行を描く。2つ目と3つ目が画面に見えている
const drawPrompts = async ($: any) => {
  await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'UserMessage', requestId: UUIDS[0], props: prompt('最初の依頼', null) })
  await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'UserMessage', requestId: UUIDS[1], props: prompt('二つ目の依頼', { first: 2, last: 3, of: 4 }) })
  await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'UserMessage', requestId: UUIDS[2], props: prompt('三つ目の依頼', { first: 0, last: 3, of: 4 }) })
}

test('点字の tick で読んでいる位置だけを高く明るくし、カードをホバーに仕込む', async ($, on) => {
  const clock = mock.clock(on)
  engineDraws(on)
  await drawPrompts($)
  await clock.advance(200)

  const ui = await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'AbovePrompt', props: band(10) })
  const ticks = await ui.findAll({ type: 'Button' })
  expect(ticks.map(t => t.key)).toEqual(['jump-0', 'jump-1', 'jump-2'])
  // 見えている行のうち一番古い、2つ目を読んでいる
  expect(ticks.map(t => t.props.label)).toEqual(['⡄', '⡇', '⡄'])
  expect(ticks.map(t => t.props.dimColor)).toEqual([true, false, true])
  // 休止時のカードは読んでいるプロンプト。各 tick のホバーで現れるカードも描いてある
  expect((await ui.findAll({ type: 'Text', text: /二つ目の依頼/ })).length).toBe(2)
  expect((await ui.findAll({ type: 'Text', text: /最初の依頼/ })).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /╭─+╮/ })).toBeDefined()
  // 番号は角丸のピル。休止時は控えめな色、ホバー中のカードはアクセント色
  const pills = await ui.findAll({ type: 'Text', text: ' 2 ' })
  expect(pills.map(p => p.props.backgroundColor)).toEqual(['subtle', 'suggestion'])
  // 上に空行を1行置く
  expect(railOf(await ui.drawn()).children[0].children[0].children).toEqual([' '])
})

test('着地したプロンプトを読んでいる位置にし、それより前の行が残っていても無視する', () => {
  const rail = newRail()
  UUIDS.forEach((id, i) => noteDrawn(rail, id, `依頼 ${i + 1}`))
  rail.screen.set('AssistantMessage\u0000stale', rowKey(UUIDS[0]!))
  expect(currentIndex(rail)).toBe(0)
  // 分割描画された行は uuid の最終グループが変わるが、同じプロンプトとして扱う
  landOn(rail, `${UUIDS[2]!.slice(0, 24)}000000000001`)
  expect(currentIndex(rail)).toBe(2)
})

test('トランスクリプトに保存された行は、描かれた行と重ねて載せない', () => {
  const rail = newRail()
  noteDrawn(rail, UUIDS[0]!, '最初の依頼')
  noteDrawn(rail, 'not-a-uuid', '保存前の依頼')
  applyIndex(rail, {
    prompts: [{ id: UUIDS[0]!, text: '最初の依頼', turn: { tools: 0, files: [] } }, { id: UUIDS[1]!, text: '保存前の依頼', turn: { tools: 0, files: [] } }],
    owners: new Map(),
    known: new Set([UUIDS[0]!, UUIDS[1]!]),
  })
  expect(rail.list.map(entry => entry.id)).toEqual([UUIDS[0], UUIDS[1]])
})

test('tick を押してスクロールを断られたら、その理由をトーストで伝える', async ($, on) => {
  const clock = mock.clock(on)
  engineDraws(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await drawPrompts($)
  await clock.advance(200)

  const ui = await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'AbovePrompt', props: band(10) })
  await ui.press({ key: 'jump-2' })
  // テストキットはトランスクリプト行へのスクロールに答えないので、その断りがそのまま届く
  expect(toasts).toHaveLength(1)
  expect((await ui.findAll({ type: 'Button' })).map(t => t.props.dimColor)).toEqual([true, false, true])
})

test('2行しか無ければ、上に空行を置き、カードを tick と同じ行の右に並べる', async ($, on) => {
  const clock = mock.clock(on)
  engineDraws(on)
  await drawPrompts($)
  await clock.advance(200)

  const ui = await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'AbovePrompt', props: band(2) })
  const root = railOf(await ui.drawn())
  expect(root.children).toHaveLength(2)
  expect(root.children[0].children[0].children).toEqual([' '])
  const row = root.children[1]
  expect(row.children.filter((child: any) => child.type === 'Button')).toHaveLength(3)
  // 行の最後がカード。休止時は読んでいるプロンプト、ホバーで現れるカードを重ねてある
  const card = row.children.at(-1)
  expect(JSON.stringify(card)).toContain('二つ目の依頼')
  expect(card.children.filter((child: any) => child.props?.position === 'absolute')).toHaveLength(3)
  expect(await ui.find({ type: 'Text', text: /╭/ })).toBeUndefined()
})

test('下にある mod とエンジンの描画を残し、レールをその下に描く', async ($, on) => {
  const clock = mock.clock(on)
  engineDraws(on)
  await drawPrompts($)
  await clock.advance(200)

  const ui = await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'AbovePrompt', props: band(10) })
  const drawn = (await ui.drawn()) as any
  expect(drawn.children).toHaveLength(2)
  expect(drawn.children[0].children).toEqual(['engine'])
  expect(JSON.stringify(railOf(drawn))).toContain('jump-1')
})

test('読んでいる位置は、見えているプロンプトの行を、それより前の応答の行より優先する', () => {
  const rail = newRail()
  UUIDS.forEach((id, i) => noteDrawn(rail, id, `依頼 ${i + 1}`))
  applyIndex(rail, { prompts: [], owners: new Map([['a0', 0]]), known: new Set() })
  rail.screen.set('AssistantMessage\u0000a0', 'a0')
  expect(currentIndex(rail)).toBe(0)
  rail.screen.set(`UserMessage\u0000${UUIDS[2]}`, rowKey(UUIDS[2]!))
  expect(currentIndex(rail)).toBe(2)
})

test('端末以外・サブエージェント表示中・プロンプトが無いときは、エンジンの描画に任せる', async ($, on) => {
  const clock = mock.clock(on)
  engineDraws(on)
  const empty = await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'AbovePrompt', props: band(10) })
  expect((await empty.find({ type: 'Text' }))?.text).toBe('engine')
  await empty.unmount()

  await drawPrompts($)
  await clock.advance(200)
  const desktop = await $.ui.mount({ plugin: 'prompt-rail', surface: 'desktop', component: 'AbovePrompt', props: band(10) })
  expect((await desktop.find({ type: 'Text' }))?.text).toBe('engine')
  await desktop.unmount()

  const agent = await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'AbovePrompt', props: band(10, { agentId: 'a1' }) })
  expect((await agent.find({ type: 'Text' }))?.text).toBe('engine')
})

test('tick の間に空白を挟み、同じ行に平らに並べる', async ($, on) => {
  const clock = mock.clock(on)
  engineDraws(on)
  await drawPrompts($)
  await clock.advance(200)

  const ui = await $.ui.mount({ plugin: 'prompt-rail', surface: 'terminal', component: 'AbovePrompt', props: band(2) })
  // Fragment で包むと Box になり、高さ1行の中で空白が下に積まれて見えなくなる
  const find = (node: any): any =>
    node?.children?.some((child: any) => child?.type === 'Button') ? node : (node?.children ?? []).map(find).find(Boolean)
  const row = find(await ui.drawn())
  const cells = row.children.filter((child: any) => child.type !== 'Box')
  expect(cells.map((child: any) => (child.type === 'Button' ? child.props.label : child.children.join('')))).toEqual(['  ', '⡄', ' ', '⡇', ' ', '⡄', ' '])
})

test('行が描かれていないため移動できなかったプロンプトに目印を付け、その行が描かれたら外す', () => {
  const rail = newRail()
  UUIDS.forEach((id, i) => noteDrawn(rail, id, `依頼 ${i + 1}`))
  const key = rowKey(UUIDS[0]!)
  expect(refusalNotice(rail, key, 'nothing drawn under that requestId')).toBe('このプロンプトの行はまだ画面に描かれていないため、移動できません')
  expect(rail.unreachable.has(key)).toBe(true)
  // ほかの理由の断りはそのまま伝え、目印は付けない
  expect(refusalNotice(rail, rowKey(UUIDS[1]!), 'the window moved meanwhile')).toBe('the window moved meanwhile')
  expect(rail.unreachable.has(rowKey(UUIDS[1]!))).toBe(false)
  // 描かれたら外れ、描き直しが要ることを返す
  expect(noteDrawn(rail, UUIDS[0]!, '依頼 1')).toBe(true)
  expect(rail.unreachable.has(key)).toBe(false)
})
