import type { EngineInterface, Register, Timer } from 'claude-code'
import { cleanText, indexRows, isPromptText, parseLine, type Row, type TranscriptIndex, type Turn } from './transcript.ts'
import {
  ICON,
  RAIL_INSET,
  TICK_GAP,
  tickGlyph,
  cardLeft,
  cardWidth,
  cellWidth,
  chooseLayout,
  fit,
  headlineParts,
  railWindow,
  turnLine,
} from './layout.ts'

// 帯を描き直すためだけのカウンタ。描画中に読み、変化を書くと帯だけが描き直される
const MOVED = { plugin: 'prompt-rail', key: 'moved' } as const
// 本人が送った行(端末の入力欄・Remote Control・SDK)
const PROMPT_KINDS = new Set(['composer', 'bridge', 'sdk'])
// 保存前のプロンプト行が一時的に描かれる id
const PROVISIONAL_ID = 'placeholder'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// `transcript:<session id>` → トランスクリプトのパス。hot reload 後の session.start はパスを持たないため
const TRANSCRIPT_KEY = 'transcript:'
const KEPT_TRANSCRIPTS = 20
// 画面上の位置の報告が落ち着いてから描き直す。スクロール中も最長 SETTLE_MAX_MS で一度は描く
const SETTLE_MS = 40
const SETTLE_MAX_MS = 120

const encoder = new TextEncoder()

// 1つのメッセージが複数行に分かれて描かれると、保存時の uuid の最終グループを
// 行番号に置き換えた id になる。uuid は先頭4グループで突き合わせる
export const rowKey = (id: string) => (UUID.test(id) ? id.slice(0, 24) : id)

type Entry = { id: string; text: string; turn?: Turn }

// セッション中に保つ状態。module を読み込み直すと作り直される
type Rail = {
  index: TranscriptIndex
  // 描かれたが、トランスクリプトにはまだ無いプロンプト行(送った直後など)
  extras: Entry[]
  list: Entry[]
  byKey: Map<string, number>
  ownerByKey: Map<string, number>
  knownKeys: Set<string>
  reader: { path: string; offset: number; rows: Row[] }
  isReading: boolean
  isReadAgain: boolean
  // プロンプト行が最後に描かれた id(ジャンプ先)
  drawn: Map<string, string>
  // 画面に見えている行(コンポーネントと id)→ 行のキー。見えなくなった行は報告で消える
  screen: Map<string, string>
  // 読んでいるプロンプトのキー。見えている行が無い間は保つ
  reading: string | undefined
  drawnCurrent: number
  settle: { quiet?: Timer; latest?: Timer }
  // 表示中のトランスクリプトがサブエージェントのものなら、その id
  viewAgent: string | undefined
  isRunning: boolean
  // turn_duration 行が書かれる前に、エンジンが報告したターンの所要時間
  reported: Map<string, number>
  // 行が描かれていないため移動できなかったプロンプトのキー。その行が描かれたら外す
  unreachable: Set<string>
}

const emptyIndex = (): TranscriptIndex => ({ prompts: [], owners: new Map(), known: new Set() })

export const newRail = (): Rail => ({
  index: emptyIndex(),
  extras: [],
  list: [],
  byKey: new Map(),
  ownerByKey: new Map(),
  knownKeys: new Set(),
  reader: { path: '', offset: 0, rows: [] },
  isReading: false,
  isReadAgain: false,
  drawn: new Map(),
  screen: new Map(),
  reading: undefined,
  drawnCurrent: -1,
  settle: {},
  viewAgent: undefined,
  isRunning: false,
  reported: new Map(),
  unreachable: new Set(),
})

function rebuild(rail: Rail) {
  rail.list = [...rail.index.prompts, ...rail.extras]
  rail.byKey = new Map(rail.list.map((entry, i) => [rowKey(entry.id), i]))
  rail.ownerByKey = new Map([...rail.index.owners].map(([id, i]) => [rowKey(id), i]))
  rail.knownKeys = new Set([...rail.index.known].map(rowKey))
}

export function applyIndex(rail: Rail, index: TranscriptIndex) {
  rail.index = index
  const known = new Set([...index.known].map(rowKey))
  // 保存された行は索引から載せる。同じ文面が最近保存されていれば、それも同じプロンプトとみなす
  const recent = new Set(index.prompts.slice(-(rail.extras.length + 2)).map(prompt => prompt.text))
  rail.extras = rail.extras.filter(entry => !known.has(rowKey(entry.id)) && !recent.has(entry.text))
  rebuild(rail)
}

// 描かれたプロンプト行を記録する。まだ一覧に無ければ載せ、変わったら true
export function noteDrawn(rail: Rail, id: string, text: string) {
  const key = rowKey(id)
  rail.drawn.set(key, id)
  const wasUnreachable = rail.unreachable.delete(key)
  if (rail.byKey.has(key) || rail.knownKeys.has(key)) return wasUnreachable
  rail.extras = [...rail.extras, { id, text }]
  rebuild(rail)
  return true
}

function resetRail(rail: Rail) {
  Object.assign(rail, newRail())
}

const indexOfKey = (rail: Rail, key: string) => rail.byKey.get(key) ?? rail.ownerByKey.get(key) ?? rail.list.length - 1

// 読んでいる位置: 画面にプロンプトの行が見えていれば、そのうち一番古いもの。
// 見えていなければ、見えている応答やツールの行のうち一番古いプロンプトに属するもの
export function currentIndex(rail: Rail) {
  let prompt = -1
  let any = -1
  for (const [name, key] of rail.screen) {
    const i = indexOfKey(rail, key)
    if (i < 0) continue
    if (any < 0 || i < any) any = i
    if (name.startsWith('UserMessage\u0000') && (prompt < 0 || i < prompt)) prompt = i
  }
  const best = prompt >= 0 ? prompt : any
  if (best >= 0) rail.reading = rowKey(rail.list[best]!.id)
  const i = rail.reading === undefined ? -1 : (rail.byKey.get(rail.reading) ?? -1)
  return i >= 0 ? i : rail.list.length - 1
}

function turnOf(rail: Rail, i: number) {
  const entry = rail.list[i]
  if (!entry) return ''
  const isRunning = rail.isRunning && i === rail.list.length - 1
  const ms = rail.reported.get(rowKey(entry.id))
  if (ms === undefined || entry.turn?.durationMs !== undefined) return turnLine(entry.turn, isRunning)
  return turnLine({ tools: 0, files: [], ...entry.turn, durationMs: ms }, isRunning)
}

async function redraw($: EngineInterface) {
  const { value = 0 } = await $.state.get(MOVED)
  await $.state.set(MOVED, value + 1)
}

// 描画フックの中では state を書けないので、そのディスパッチが終わってから描き直す
function redrawLater($: EngineInterface) {
  $.clock.after(0, () => void redraw($))
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
      await redraw($)
    } while (rail.isReadAgain)
  } catch {
    // セッション開始直後でファイルがまだ無いなど。次のイベントで読み直す
  } finally {
    rail.isReading = false
  }
}

async function rememberTranscript($: EngineInterface, sessionId: string, path: string) {
  await $.store.set(`${TRANSCRIPT_KEY}${sessionId}`, { path, at: Date.now() })
  const keys = (await $.store.keys()).filter(key => key.startsWith(TRANSCRIPT_KEY))
  if (keys.length <= KEPT_TRANSCRIPTS) return
  const dated = await Promise.all(
    keys.map(async key => {
      const value = (await $.store.get(key)) as { at?: unknown } | undefined
      return { key, at: typeof value?.at === 'number' ? value.at : 0 }
    }),
  )
  dated.sort((a, b) => b.at - a.at)
  await Promise.all(dated.slice(KEPT_TRANSCRIPTS).map(({ key }) => $.store.delete(key)))
}

function report($: EngineInterface, rail: Rail, component: string, id: string, onScreen: unknown) {
  if (onScreen === undefined || rail.viewAgent !== undefined) return
  const name = `${component}\u0000${id}`
  if (onScreen === null) rail.screen.delete(name)
  else rail.screen.set(name, rowKey(id))
  const fire = () => {
    rail.settle.quiet?.cancel()
    rail.settle.latest?.cancel()
    rail.settle = {}
    if (currentIndex(rail) !== rail.drawnCurrent) void redraw($)
  }
  rail.settle.quiet?.cancel()
  rail.settle.quiet = $.clock.after(SETTLE_MS, fire)
  rail.settle.latest ??= $.clock.after(SETTLE_MAX_MS, fire)
}

// ジャンプで画面外に出た行は、出たと報告しないことがある。着地した行だけが見えているとみなす
export function landOn(rail: Rail, target: string) {
  rail.screen.clear()
  rail.screen.set(`UserMessage\u0000${target}`, rowKey(target))
  rail.reading = rowKey(target)
}

// 移動を断られたときに伝える文。行が描かれていない断りなら、その tick に目印を付ける
const NOT_DRAWN = /nothing drawn/
export function refusalNotice(rail: Rail, key: string, deny: string) {
  if (!NOT_DRAWN.test(deny)) return deny
  rail.unreachable.add(key)
  return 'このプロンプトの行はまだ画面に描かれていないため、移動できません'
}

async function jump($: EngineInterface, rail: Rail, i: number) {
  const entry = rail.list[i]
  if (!entry) return
  if (rail.viewAgent !== undefined) {
    $.ui.toast('jumps move through the main conversation; switch back to it first')
    return
  }
  const key = rowKey(entry.id)
  const target = rail.drawn.get(key) ?? entry.id
  try {
    const result = await $.ui.scroll({ to: { requestId: target }, block: 'start' })
    if (result.deny) {
      $.ui.toast(refusalNotice(rail, key, result.deny))
      await redraw($)
      return
    }
  } catch (err) {
    $.ui.toast((err as Error).message)
    return
  }
  landOn(rail, target)
  await redraw($)
}

export const register: Register = on => {
  const rail = newRail()

  on('session.start', async ($, e, next) => {
    // hot reload 後は一覧が空から始まるので、このセッションのトランスクリプトから作り直す
    const kept = (await $.store.get(`${TRANSCRIPT_KEY}${await $.session.id()}`)) as { path?: unknown } | undefined
    if (typeof kept?.path === 'string') await readTranscript($, rail, kept.path)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    // 一覧が作れなくても、セッションの開始は止めない
    if (e.source === 'clear') {
      resetRail(rail)
      await redraw($).catch(() => {})
    } else {
      await readTranscript($, rail, e.transcript_path).catch(() => {})
    }
    await rememberTranscript($, e.session_id, e.transcript_path).catch(() => {})
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
    for (const [name, key] of rail.screen) if (!rail.knownKeys.has(key) && !rail.byKey.has(key)) rail.screen.delete(name)
    await redraw($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      rail.isRunning = false
      const newest = rail.list.at(-1)
      if (newest) rail.reported.set(rowKey(newest.id), (rail.reported.get(rowKey(newest.id)) ?? 0) + e.durationMs)
      await redraw($)
    }
    return result
  })

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const text = cleanText(e.props.text)
    if (PROMPT_KINDS.has(e.props.origin.kind) && isPromptText(text) && e.requestId !== PROVISIONAL_ID) {
      if (noteDrawn(rail, e.requestId, text)) redrawLater($)
      report($, rail, e.component, e.requestId, e.props.onScreen)
    }
    return next(e)
  })

  // 応答とツールの行は、それが答えているプロンプトの位置を示す
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    report($, rail, e.component, e.requestId, e.props.onScreen)
    return next(e)
  })
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    report($, rail, e.component, e.requestId, e.props.onScreen)
    return next(e)
  })
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    report($, rail, e.component, e.requestId, e.props.onScreen)
    return next(e)
  })
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    // まとめて畳まれたツール群は、最初の呼び出しとして数える
    const id = e.props.calls.find(call => call.tool_use_id)?.tool_use_id
    if (id) report($, rail, e.component, id, e.props.onScreen)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await $.state.get(MOVED)
    if (e.surface !== 'terminal') return next(e)
    if (e.props.view.agentId !== rail.viewAgent) rail.screen.clear()
    rail.viewAgent = e.props.view.agentId
    if (e.props.hasSurvey || rail.viewAgent !== undefined || rail.list.length === 0) return next(e)
    // 帯は他の mod と分け合う。下にある mod とエンジンの描画を捨てずに、レールの上に残す
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)

    const list = rail.list
    const width = Math.max(12, e.props.bodyColumns)
    const layout = chooseLayout(e.props.maxRows)
    const current = currentIndex(rail)
    rail.drawnCurrent = current
    // inline のときは、tick に使う幅を半分までにしてカードの場所を残す
    const win = railWindow(list.length, current, layout.card === 'inline' ? Math.floor(width / 2) : width)
    const shown = Array.from({ length: win.size }, (_, k) => win.first + k)
    const lead = RAIL_INSET + (win.isClipped ? TICK_GAP : 0)
    const tickX = (i: number) => lead + (i - win.first) * TICK_GAP
    const scope = (i: number) => `prompt-rail-${i}`

    // ---- カード ----
    // beUI のカード: 控えめな枠、太字のタイトル、薄い説明。番号は角丸のピルにし、
    // ホバー中はアクセント色にする。色はテーマのキーで指定し、テーマに追従させる
    type Seg = { text: string; dim?: boolean; bold?: boolean; color?: string; bg?: string }
    const room = width - RAIL_INSET * 2
    // inline のカードは、tick 列(と › の印)の右に2セル空けて置き、右端に RAIL_INSET 残す
    const railEnd = lead + win.size * TICK_GAP + (win.isClipped ? 1 : 0)
    const cw = layout.card === 'line' ? room : layout.card === 'inline' ? width - railEnd - 2 - RAIL_INSET : cardWidth(room)
    const xOf = (i: number) => RAIL_INSET + (layout.card === 'line' || layout.card === 'inline' ? 0 : cardLeft(tickX(i) - RAIL_INSET, room))
    const pill = (i: number, isHovered: boolean): Seg[] => {
      const tone = isHovered ? 'suggestion' : 'subtle'
      return [
        { text: ICON.pillStart, color: tone },
        { text: ` ${i + 1} `, color: isHovered ? 'inverseText' : 'text', bg: tone, bold: isHovered },
        { text: ICON.pillEnd, color: tone },
      ]
    }
    const pillWidth = (i: number) => cellWidth(` ${i + 1} `) + 2
    // ピルと本文、続けて要約(幅の半分まで)を、1行 w セルに収める
    const headline = (i: number, w: number, isHovered: boolean, withDetail: boolean): Seg[] => {
      const parts = headlineParts(list[i]!.text, withDetail ? turnOf(rail, i) : '', w - pillWidth(i) - 1)
      return [
        ...pill(i, isHovered),
        { text: ' ' },
        { text: parts.title, bold: isHovered, dim: !isHovered },
        { text: parts.detail, dim: true },
        { text: parts.pad },
      ]
    }
    const detailLine = (i: number, w: number): Seg[] => {
      const indent = pillWidth(i) + 1
      return [{ text: ' '.repeat(indent) }, { text: fit(turnOf(rail, i), w - indent), dim: true }]
    }
    const cardLines = (i: number, isHovered: boolean): Seg[][] => {
      if (layout.card === 'line' || layout.card === 'inline') return [headline(i, cw, isHovered, true)]
      if (layout.card === 'plain') return [headline(i, cw, isHovered, false), detailLine(i, cw)]
      const inner = cw - 4
      const side = (segs: Seg[]): Seg[] => [{ text: '│ ', dim: true }, ...segs, { text: ' │', dim: true }]
      return [
        [{ text: `╭${'─'.repeat(cw - 2)}╮`, dim: true }],
        side(headline(i, inner, isHovered, false)),
        side(detailLine(i, inner)),
        [{ text: `╰${'─'.repeat(cw - 2)}╯`, dim: true }],
      ]
    }
    const drawLine = (segs: Seg[]) => (
      <Box height={1} flexDirection="row">
        {segs.map(seg => (
          <Text dimColor={seg.dim} bold={seg.bold} color={seg.color} backgroundColor={seg.bg} wrap="truncate-end">
            {seg.text}
          </Text>
        ))}
      </Box>
    )

    // 休止時は読んでいるプロンプトのカードを控えめに出す。ホバーしたカードは、その分の
    // 幅を空白で塗りつぶして重ねる(端末ではホバーで要素を隠せないため、上から覆う)
    const restX = xOf(current)
    // カードが十分な幅を取れないときは、カードを出さず tick だけにする
    const hasCard = cw >= 16
    const inlineCard =
      layout.card !== 'inline' || !hasCard ? null : (
        <Box height={1} width={cw + 2} flexDirection="column">
          {drawLine([{ text: '  ' }, ...cardLines(current, false)[0]!])}
          {shown.map(i => (
            <Box position="absolute" top={0} left={0} flexDirection="column" display="none" hover={{ scope: scope(i), display: 'flex' }}>
              {drawLine([{ text: '  ' }, ...cardLines(i, true)[0]!])}
            </Box>
          ))}
        </Box>
      )
    const cards =
      layout.card === 'inline' || !hasCard ? null : (
        <Box flexDirection="column" height={layout.cardRows} width={width}>
          {cardLines(current, false).map(segs => drawLine([{ text: ' '.repeat(restX) }, ...segs]))}
          {shown.map(i => {
            const x = xOf(i)
            const from = Math.min(x, restX)
            const to = Math.max(x, restX) + cw
            return (
              <Box position="absolute" top={0} left={from} flexDirection="column" display="none" hover={{ scope: scope(i), display: 'flex' }}>
                {cardLines(i, true).map(segs => drawLine([{ text: ' '.repeat(x - from) }, ...segs, { text: ' '.repeat(to - x - cw) }]))}
              </Box>
            )
          })}
        </Box>
      )

    // ---- tick ----
    // 1行の点字。読んでいる位置だけ高く明るくし、ホバーした tick も明るくする
    const gap = ' '.repeat(TICK_GAP - 1)
    const rail1 = (
      <Box height={1} flexDirection="row" width={width}>
        <Text>{' '.repeat(RAIL_INSET)}</Text>
        {win.isClipped ? <Text dimColor>{win.first > 0 ? '‹ ' : '  '}</Text> : null}
        {/* Fragment は Box になり、高さ1行の中で縦に積まれて空白が消えるので、配列で平らに並べる */}
        {shown.flatMap(i => [
          <Button
            key={`jump-${i}`}
            plain
            label={tickGlyph(i === current, rail.unreachable.has(rowKey(list[i]!.id)))}
            dimColor={i !== current}
            hover={{ scope: scope(i), dimColor: false, bold: true }}
            onPress={() => {}}
          />,
          <Text>{gap}</Text>,
        ])}
        {win.isClipped && win.first + win.size < list.length ? <Text dimColor>›</Text> : null}
        {inlineCard}
      </Box>
    )
    // 余白は marginTop ではなく空行として描く(帯の高さの計算に確実に入れるため)
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column">
          {layout.margin > 0 ? (
            <Box height={1}>
              <Text> </Text>
            </Box>
          ) : null}
          {cards}
          {rail1}
        </Box>
      </Box>
    )
  })

  on('ui.press', { plugin: 'prompt-rail' }, async ($, e, next) => {
    const i = Number(/^jump-(\d+)$/.exec(e.element)?.[1])
    if (Number.isInteger(i)) await jump($, rail, i)
    return next(e)
  })
}
