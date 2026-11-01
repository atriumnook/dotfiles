import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'
import { cleanText, indexRows, isPromptText, parseLine, type Row, type TranscriptIndex, type Turn } from './transcript.ts'
import { ICON, cardTop, cardWidth, cellWidth, fit, tickRows, turnLine, wrap } from './layout.ts'

// このセッションのトランスクリプトのパス。hot reload 後の session.start はパスを持たないため
const TRANSCRIPT = { plugin: 'prompt-rail', key: 'transcript' } as const
// 本人が送った行(端末の入力欄・Remote Control・SDK)
const PROMPT_KINDS = new Set(['composer', 'bridge', 'sdk'])
// 保存前のプロンプト行が一時的に描かれる id
const PROVISIONAL_ID = 'placeholder'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// 描かれていない行へは、描かれた一番古い行への scroll を繰り返して近づく。その回数と、1回ごとに待つ上限
const MAX_HOPS = 400
const HOP_WAIT_MS = 300
const POLL_MS = 16
// カードに載せる本文の行数と、まとめた行のカードに並べるプロンプトの数
const CARD_TEXT_LINES = 4
const CARD_LIST_MAX = 8
// 同じトランスクリプト行から描かれた行の、画面での上下(順番が同じ行どうしで比べる)
const COMPONENT_RANK: Record<string, number> = { UserMessage: 0, AssistantMessage: 1, ToolUse: 2, ToolGroup: 2, ToolResult: 3 }

const encoder = new TextEncoder()

// 1つのメッセージが複数行に分かれて描かれると、保存時の uuid の最終グループを
// 行番号に置き換えた id になる。uuid は先頭4グループで突き合わせる
export const rowKey = (id: string) => (UUID.test(id) ? id.slice(0, 24) : id)

type Entry = { id: string; text: string; turn?: Turn }
// 見えている行。first・last・of は onScreen の値(行の先頭の空行を 0 行目と数える)
type Seen = { key: string; first: number; last: number; of: number }

// セッション中に保つ状態。module を読み込み直すと作り直される
type Rail = {
  index: TranscriptIndex
  // 描かれたが、トランスクリプトにはまだ無いプロンプト行(送った直後など)
  extras: Entry[]
  list: Entry[]
  byKey: Map<string, number>
  ownerByKey: Map<string, number>
  orderByKey: Map<string, number>
  reader: { path: string; offset: number; rows: Row[] }
  isReading: boolean
  isReadAgain: boolean
  // 行のキー → 最後に描かれた requestId(ジャンプ先と、ジャンプが伝う行)
  drawn: Map<string, string>
  // 見えている行(コンポーネントと requestId)。見えなくなった行は報告で消える
  screen: Map<string, Seen>
  // 描かれた順。トランスクリプトにまだ無い行の上下に使う
  seen: Map<string, number>
  // 見えている行のうち一番上。まとめた行を押したときの次の移動先を決める
  top: string | undefined
  // 右端の列を描く行: 見えている行のうち一番下。どの行よりも後に描かれるので、列とカードが塗られない
  bottom: string | undefined
  // transcript の viewport の行数。最後に測れた値
  height: number
  // 読んでいるプロンプトのキー。見えている行が無い間は保つ
  reading: string | undefined
  // 移動中のジャンプ。seq が変わったら、前のジャンプはやめる
  seeking: { key: string; seq: number } | undefined
  jumps: number
  // 最後に描き直させたときの列の内容。変わったら描き直させる
  drawnLook: string
  isRedrawPending: boolean
  // 表示中のトランスクリプトがサブエージェントのものなら、その id
  viewAgent: string | undefined
  isRunning: boolean
  // turn_duration 行が書かれる前に、エンジンが報告したターンの所要時間
  reported: Map<string, number>
}

const emptyIndex = (): TranscriptIndex => ({ prompts: [], owners: new Map(), order: new Map() })

export const newRail = (): Rail => ({
  index: emptyIndex(),
  extras: [],
  list: [],
  byKey: new Map(),
  ownerByKey: new Map(),
  orderByKey: new Map(),
  reader: { path: '', offset: 0, rows: [] },
  isReading: false,
  isReadAgain: false,
  drawn: new Map(),
  screen: new Map(),
  seen: new Map(),
  top: undefined,
  bottom: undefined,
  height: 0,
  reading: undefined,
  seeking: undefined,
  jumps: 0,
  drawnLook: '',
  isRedrawPending: false,
  viewAgent: undefined,
  isRunning: false,
  reported: new Map(),
})

function rebuild(rail: Rail) {
  rail.list = [...rail.index.prompts, ...rail.extras]
  rail.byKey = new Map(rail.list.map((entry, i) => [rowKey(entry.id), i]))
  rail.ownerByKey = new Map([...rail.index.owners].map(([id, i]) => [rowKey(id), i]))
  rail.orderByKey = new Map([...rail.index.order].map(([id, i]) => [rowKey(id), i]))
}

export function applyIndex(rail: Rail, index: TranscriptIndex) {
  rail.index = index
  const known = new Set([...index.order.keys()].map(rowKey))
  // 保存された行は索引から載せる。同じ文面が最近保存されていれば、それも同じプロンプトとみなす
  const recent = new Set(index.prompts.slice(-(rail.extras.length + 2)).map(prompt => prompt.text))
  rail.extras = rail.extras.filter(entry => !known.has(rowKey(entry.id)) && !recent.has(entry.text))
  rebuild(rail)
}

// 描かれたプロンプト行を記録する。まだ一覧に無ければ載せる
export function noteDrawn(rail: Rail, id: string, text: string) {
  const key = rowKey(id)
  rail.drawn.set(key, id)
  if (rail.byKey.has(key) || rail.orderByKey.has(key)) return
  rail.extras = [...rail.extras, { id, text }]
  rebuild(rail)
}

// まとめて畳まれたツール群は、最初の呼び出しの位置にある。呼び出しの無い思考だけの群は
// `collapsed-<最初の行の uuid>` の行にある
export const groupKey = (calls: ReadonlyArray<{ tool_use_id?: string }>, requestId: string) =>
  rowKey(calls.find(call => call.tool_use_id)?.tool_use_id ?? requestId.replace(/^collapsed-/, ''))

const indexOfKey = (rail: Rail, key: string) => rail.byKey.get(key) ?? rail.ownerByKey.get(key)

// 画面での上下を比べる値。トランスクリプトの順番、同じ行から描かれたものはコンポーネント、
// トランスクリプトにまだ無い行は描かれた順。ロゴの下の InfoNotice はどの行よりも上
function place(rail: Rail, name: string, key: string): [number, number, number] {
  const component = name.slice(0, name.indexOf('\u0000'))
  const order = component === 'InfoNotice' ? -1 : (rail.orderByKey.get(key) ?? Number.MAX_SAFE_INTEGER)
  return [order, COMPONENT_RANK[component] ?? 4, rail.seen.get(name) ?? 0]
}

const before = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

// 見えている行を上から順に並べる
export function screenOrder(rail: Rail) {
  return [...rail.screen].map(([name, seen]) => ({ name, seen, at: place(rail, name, seen.key) })).sort((a, b) => before(a.at, b.at))
}

// 見えている行から、列を描く行と transcript の viewport の行数を求める
export function measure(rail: Rail) {
  const rows = screenOrder(rail)
  const first = rows[0]
  rail.top = first?.name
  rail.bottom = rows.at(-1)?.name
  if (!first) return
  const last = rows.at(-1)!
  rail.height =
    rows.length === 1
      ? first.seen.last - first.seen.first + 1
      : first.seen.of - first.seen.first + rows.slice(1, -1).reduce((sum, row) => sum + row.seen.of, 0) + last.seen.last + 1
}

// 読んでいる位置: 画面にプロンプトの行が見えていれば、そのうち一番古いもの。
// 見えていなければ、見えている応答やツールの行のうち一番古いプロンプトに属するもの
export function currentIndex(rail: Rail) {
  let prompt = -1
  let any = -1
  for (const [name, { key }] of rail.screen) {
    const i = indexOfKey(rail, key)
    if (i === undefined) continue
    if (any < 0 || i < any) any = i
    if (name.startsWith('UserMessage\u0000') && rail.byKey.has(key) && (prompt < 0 || i < prompt)) prompt = i
  }
  const best = prompt >= 0 ? prompt : any
  if (best >= 0) rail.reading = rowKey(rail.list[best]!.id)
  const i = rail.reading === undefined ? -1 : (rail.byKey.get(rail.reading) ?? -1)
  return i >= 0 ? i : rail.list.length - 1
}

// 見えている範囲: 見えている行が属するプロンプトの、最初から最後まで
export function visibleRange(rail: Rail) {
  const found = [...rail.screen.values()].map(({ key }) => indexOfKey(rail, key)).filter((i): i is number => i !== undefined)
  return found.length === 0 ? undefined : { from: Math.min(...found), to: Math.max(...found) }
}

function turnOf(rail: Rail, i: number) {
  const entry = rail.list[i]
  if (!entry) return ''
  const isRunning = rail.isRunning && i === rail.list.length - 1
  const ms = rail.reported.get(rowKey(entry.id))
  if (ms === undefined || entry.turn?.durationMs !== undefined) return turnLine(entry.turn, isRunning)
  return turnLine({ tools: 0, files: [], ...entry.turn, durationMs: ms }, isRunning)
}

// 列の見た目を決める値。前に描いたものと違えば描き直させる
function look(rail: Rail) {
  const range = visibleRange(rail)
  return [rail.bottom, rail.height, rail.list.length, currentIndex(rail), range?.from, range?.to, rail.seeking?.key, rail.isRunning].join('|')
}

// 描画フックの中では描き直しを頼めないので、そのディスパッチが終わってから頼む
function redrawIfChanged($: EngineInterface, rail: Rail) {
  if (rail.isRedrawPending || look(rail) === rail.drawnLook) return
  rail.isRedrawPending = true
  $.clock.after(0, () => {
    rail.isRedrawPending = false
    if (look(rail) !== rail.drawnLook) redraw($, rail)
  })
}

function redraw($: EngineInterface, rail: Rail) {
  rail.drawnLook = look(rail)
  $.ui.invalidate('ui.render')
}

// 前回読んだ位置から先だけを読む。$.fs.read は 4 MiB までなので、長いセッションは tail で流し読む
async function readFrom($: EngineInterface, reader: Rail['reader']) {
  const child = $.process.spawn({ argv: ['tail', '-c', `+${reader.offset + 1}`, reader.path] })
  let carry = ''
  for await (const piece of child) {
    if (piece.stream !== 'stdout') continue
    const lines = (carry + piece.text).split('\n')
    // 改行で終わっていない最後の行は書き込み途中かもしれないので、次回に読む
    carry = lines.pop() ?? ''
    for (const line of lines) {
      reader.offset += encoder.encode(line).length + 1
      const row = line.trim() ? parseLine(line) : undefined
      if (row) reader.rows.push(row)
    }
  }
  const { code } = await child.result
  if (code !== 0) throw new Error(`tail exited with ${code}`)
}

// tail の無い環境(素の Windows)向け。全体を読み直す
async function readWhole($: EngineInterface, reader: Rail['reader']) {
  const text = await $.fs.read(reader.path)
  const end = text.lastIndexOf('\n') + 1
  reader.rows = text.slice(0, end).split('\n').flatMap(line => (line.trim() ? (parseLine(line) ?? []) : []))
  reader.offset = encoder.encode(text.slice(0, end)).length
}

async function readTranscript($: EngineInterface, rail: Rail, path: string) {
  if (rail.isReading) {
    rail.isReadAgain = true
    return
  }
  rail.isReading = true
  try {
    do {
      rail.isReadAgain = false
      const { size } = await $.fs.stat(path)
      const reader = rail.reader
      if (path !== reader.path || size < reader.offset) Object.assign(reader, { path, offset: 0, rows: [] })
      if (size === reader.offset) continue
      try {
        await readFrom($, reader)
      } catch {
        await readWhole($, reader)
      }
      applyIndex(rail, indexRows(reader.rows))
      measure(rail)
      redraw($, rail)
    } while (rail.isReadAgain)
  } catch {
    // セッション開始直後でファイルがまだ無いなど。次のイベントで読み直す
  } finally {
    rail.isReading = false
  }
}

// 行の画面上の位置の報告を記録する。onScreen が undefined の描画は位置を持たない
export function report(rail: Rail, name: string, key: string, onScreen: { first: number; last: number; of: number } | null | undefined) {
  if (!rail.seen.has(name)) rail.seen.set(name, rail.seen.size)
  if (onScreen === undefined) return
  if (onScreen === null) rail.screen.delete(name)
  else rail.screen.set(name, { key, first: onScreen.first, last: onScreen.last, of: onScreen.of })
  measure(rail)
}

// ジャンプで画面外に出た行は、出たと報告しないことがある。着地した行より上の行は消す
export function landOn(rail: Rail, requestId: string) {
  const name = `UserMessage\u0000${requestId}`
  const target = place(rail, name, rowKey(requestId))
  for (const [other, seen] of rail.screen) if (before(place(rail, other, seen.key), target) < 0) rail.screen.delete(other)
  const kept = rail.screen.get(name)
  rail.screen.set(name, { key: rowKey(requestId), first: 0, last: kept?.last ?? 0, of: kept?.of ?? 1 })
  rail.reading = rowKey(requestId)
  rail.top = name
}

// 押した行のプロンプトのうち、上端にあるものの次。上端に無ければ行の最初のプロンプト
export function nextTarget(rail: Rail, prompts: readonly number[]) {
  const top = rail.top === undefined ? undefined : rail.screen.get(rail.top)?.key
  const keys = prompts.map(i => rowKey(rail.list[i]!.id))
  const at = keys.findIndex(key => key === top)
  return prompts[(at + 1) % prompts.length]!
}

// 描かれた行のうち、トランスクリプトで一番前のもの
function oldestDrawn(rail: Rail) {
  let best: { id: string; order: number } | undefined
  for (const [key, id] of rail.drawn) {
    const order = rail.orderByKey.get(key)
    if (order !== undefined && (!best || order < best.order)) best = { id, order }
  }
  return best?.id
}

function wait($: EngineInterface, ms: number) {
  return new Promise<void>(resolve => void $.clock.after(ms, () => resolve()))
}

async function seek($: EngineInterface, rail: Rail, key: string, seq: number) {
  for (let hop = 0; hop < MAX_HOPS && rail.seeking?.seq === seq; hop++) {
    const drawn = rail.drawn.get(key)
    if (drawn) {
      const result = await $.ui.scroll({ to: { requestId: drawn }, block: 'start' })
      return { ...result, requestId: drawn }
    }
    const oldest = oldestDrawn(rail)
    if (!oldest) break
    const count = rail.drawn.size
    const result = await $.ui.scroll({ to: { requestId: oldest }, block: 'start' })
    if (result.deny) return result
    // 上の行が描かれるまで待つ
    for (let ms = 0; rail.drawn.size === count && ms < HOP_WAIT_MS; ms += POLL_MS) await wait($, POLL_MS)
  }
  return { deny: rail.seeking?.seq === seq ? 'too far' : undefined, requestId: undefined }
}

async function press($: EngineInterface, rail: Rail, prompts: readonly number[]) {
  if (rail.viewAgent !== undefined) {
    $.ui.toast('jumps move through the main conversation; switch back to it first')
    return
  }
  const i = nextTarget(rail, prompts)
  const key = rowKey(rail.list[i]!.id)
  const seq = ++rail.jumps
  rail.seeking = { key, seq }
  redraw($, rail)
  let result: { deny?: string; requestId?: string }
  try {
    result = await seek($, rail, key, seq)
  } catch (err) {
    result = { deny: (err as Error).message }
  }
  // 別の tick が押された
  if (rail.seeking?.seq !== seq) return
  rail.seeking = undefined
  // 人が scroll した。その操作を優先し、伝えない
  if (result.deny && !/moved meanwhile/.test(result.deny)) $.ui.toast(`${i + 1} へジャンプできません: ${result.deny}`)
  if (!result.deny && result.requestId) landOn(rail, result.requestId)
  redraw($, rail)
}

// 見えている行のうち一番下の行だけが、自分の描画に右端の列を重ねる
function drawColumn($: EngineInterface, rail: Rail, e: RenderInput, own: RenderElement): RenderElement {
  const name = `${e.component}\u0000${e.requestId}`
  const seen = rail.screen.get(name)
  if (e.surface !== 'terminal' || !e.viewport || e.viewport.isFullscreen !== true || rail.viewAgent !== undefined) return own
  if (name !== rail.bottom || !seen || rail.list.length === 0) return own
  const { Box, Text, Button } = $.ui.resolve(e)
  const columns = e.viewport.columns
  // viewport が画面全体より高いことはない。報告が古いときの上限
  const height = Math.min(rail.height, e.viewport.rows)
  // 最後の行は、上へスクロールしている間エンジンの「Jump to bottom」が pointer を取るので空ける
  const rows = Math.max(1, height - 1)
  const placed = tickRows(rail.list.length, rows)
  const reading = currentIndex(rail)
  const range = visibleRange(rail)
  const cw = cardWidth(columns)
  // この行の last 行目が viewport の下端で、上端はそこから height - 1 行上。sticky header が
  // 覆う行は onScreen が見えている行に数えないので、上端は header のすぐ下になる
  const base = seen.last - (height - 1)

  type Seg = { text: string; dim?: boolean; bold?: boolean; color?: string; bg?: string }
  const drawLine = (segs: Seg[]) => (
    <Box height={1} flexDirection="row">
      {segs.map(seg => (
        <Text dimColor={seg.dim} weight={seg.bold ? 'semibold' : undefined} color={seg.color} backgroundColor={seg.bg} wrap="truncate-end">
          {seg.text}
        </Text>
      ))}
    </Box>
  )
  const pill = (i: number): Seg[] => [
    { text: ICON.pillStart, color: 'suggestion' },
    { text: ` ${i + 1} `, color: 'inverseText', bg: 'suggestion', bold: true },
    { text: ICON.pillEnd, color: 'suggestion' },
  ]
  const pillWidth = (i: number) => cellWidth(` ${i + 1} `) + 2
  // カード: 控えめな枠の中に、番号のピルと本文、ターンの要約。transcript の上に重ねるので、幅いっぱいを塗る
  const cardLines = (prompts: readonly number[]): Seg[][] => {
    const inner = cw - 4
    const side = (segs: Seg[]): Seg[] => [{ text: '│ ', dim: true }, ...segs, { text: ' │', dim: true }]
    const body: Seg[][] = []
    if (prompts.length === 1) {
      const i = prompts[0]!
      const indent = pillWidth(i) + 1
      wrap(rail.list[i]!.text, inner - indent, CARD_TEXT_LINES).forEach((line, k) =>
        body.push(k === 0 ? [...pill(i), { text: ' ' }, { text: line, bold: true }] : [{ text: ' '.repeat(indent) }, { text: line }]),
      )
      body.push([{ text: ' '.repeat(indent) }, { text: fit(turnOf(rail, i), inner - indent), dim: true }])
    } else {
      for (const i of prompts.slice(0, CARD_LIST_MAX)) body.push([...pill(i), { text: ' ' }, { text: fit(rail.list[i]!.text, inner - pillWidth(i) - 1) }])
      const rest = prompts.length - CARD_LIST_MAX
      if (rest > 0) body.push([{ text: fit(`+${rest}`, inner), dim: true }])
    }
    return [[{ text: `╭${'─'.repeat(cw - 2)}╮`, dim: true }], ...body.map(side), [{ text: `╰${'─'.repeat(cw - 2)}╯`, dim: true }]]
  }

  const ticks = placed.flatMap((prompts, row) => {
    if (prompts.length === 0) return []
    const scope = `prompt-rail-${row}`
    const isSeeking = rail.seeking !== undefined && prompts.some(i => rowKey(rail.list[i]!.id) === rail.seeking!.key)
    const isReading = prompts.includes(reading)
    const isInRange = range !== undefined && prompts.some(i => i >= range.from && i <= range.to)
    // subtle は背景に溶けるので、見えていない tick も inactive で描く
    const color = isSeeking ? 'warning' : isReading ? 'text' : isInRange ? 'claude' : 'inactive'
    const lines = cardLines(prompts)
    return [
      // Button の label の Text は group を heat できないので、外側の Box で heat する
      <Box key={scope} position="absolute" top={base + row} left={columns - 1} hover={{ scope }}>
        <Button key={`jump-${row}`} plain onPress={() => void press($, rail, prompts)}>
          <Text color={color} weight={isSeeking || isReading ? 'semibold' : undefined} hover={{ scope, color: 'suggestion', bold: true }}>
            {prompts.length > 1 ? '≡' : '━'}
          </Text>
        </Button>
        <Box
          position="absolute"
          top={cardTop(row, lines.length, rows) - row}
          left={-(cw + 1)}
          flexDirection="column"
          display="none"
          hover={{ scope, display: 'flex' }}
        >
          {lines.map(drawLine)}
        </Box>
      </Box>,
    ]
  })
  return (
    <Box key="prompt-rail-column" flexDirection="column">
      {own}
      {ticks}
    </Box>
  )
}

// transcript の行を描くたびに、位置を記録し、一番上の行なら列を重ねる
type OnScreen = { first: number; last: number; of: number } | null | undefined

async function onRow($: EngineInterface, rail: Rail, e: RenderInput, key: string, onScreen: OnScreen, next: () => Promise<RenderElement>) {
  if (rail.viewAgent === undefined) {
    rail.drawn.set(key, e.requestId)
    report(rail, `${e.component}\u0000${e.requestId}`, key, onScreen)
    redrawIfChanged($, rail)
  }
  return drawColumn($, rail, e, await next())
}

export const register: Register = on => {
  const rail = newRail()

  on('session.start', async ($, e, next) => {
    // hot reload 後は一覧が空から始まるので、このセッションのトランスクリプトから作り直す
    const { value } = await $.state.get(TRANSCRIPT)
    if (typeof value === 'string') await readTranscript($, rail, value)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    // 一覧が作れなくても、セッションの開始は止めない
    if (e.source === 'clear') {
      Object.assign(rail, newRail())
      redraw($, rail)
    } else {
      await readTranscript($, rail, e.transcript_path).catch(() => {})
    }
    await $.state.set(TRANSCRIPT, e.transcript_path).catch(() => {})
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    await readTranscript($, rail, e.transcript_path).catch(() => {})
    return next(e)
  })

  // メインのターンが始まった(サブエージェントでは起きない)。それまでのターンは保存済み
  on('turn.start', async ($, e, next) => {
    rail.isRunning = true
    if (rail.reader.path) await readTranscript($, rail, rail.reader.path)
    // rewind や compact で消えた行は、新しいターンの行と見分けがつかないので外す
    for (const [name, { key }] of rail.screen) if (!rail.orderByKey.has(key) && !rail.byKey.has(key)) rail.screen.delete(name)
    measure(rail)
    redraw($, rail)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      rail.isRunning = false
      const newest = rail.list.at(-1)
      if (newest) rail.reported.set(rowKey(newest.id), (rail.reported.get(rowKey(newest.id)) ?? 0) + e.durationMs)
      redraw($, rail)
    }
    return result
  })

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const text = cleanText(e.props.text)
    if (PROMPT_KINDS.has(e.props.origin.kind) && isPromptText(text) && e.requestId !== PROVISIONAL_ID && rail.viewAgent === undefined) {
      noteDrawn(rail, e.requestId, text)
    }
    return onRow($, rail, e, rowKey(e.requestId), e.props.onScreen, () => next(e))
  })
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => onRow($, rail, e, rowKey(e.requestId), e.props.onScreen, () => next(e)))
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => onRow($, rail, e, rowKey(e.requestId), e.props.onScreen, () => next(e)))
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => onRow($, rail, e, rowKey(e.requestId), e.props.onScreen, () => next(e)))
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    return onRow($, rail, e, groupKey(e.props.calls, e.requestId), e.props.onScreen, () => next(e))
  })
  on('ui.render', { component: 'CommandOutput' }, ($, e, next) => onRow($, rail, e, rowKey(e.requestId), e.props.onScreen, () => next(e)))
  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => onRow($, rail, e, rowKey(e.requestId), e.props.onScreen, () => next(e)))
  on('ui.render', { component: 'InfoNotice' }, ($, e, next) => onRow($, rail, e, rowKey(e.requestId), e.props.onScreen, () => next(e)))

  // 帯には何も描かない。表示中の会話がサブエージェントかどうかだけを見る
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.view.agentId !== rail.viewAgent) {
      rail.viewAgent = e.props.view.agentId
      rail.screen.clear()
      rail.top = undefined
      $.clock.after(0, () => redraw($, rail))
    }
    return next(e)
  })
}
