// トランスクリプト(JSONL)から、本人が送ったプロンプトと各ターンの要約を取り出す。
// 外部 I/O を持たない純粋関数だけを置く。

export type Turn = {
  // turn_duration 行が記録した所要時間。無いターンは spanMs(プロンプトから最後の応答まで)
  durationMs?: number
  spanMs?: number
  tools: number
  // Edit / Write で書き換えたファイルのパス(重複なし)
  files: string[]
  outcome?: 'interrupted' | 'error'
}

export type Prompt = { id: string; text: string; turn: Turn }

export type TranscriptIndex = {
  prompts: Prompt[]
  // 応答行の uuid と tool_use id → それが属するプロンプトの位置
  owners: Map<string, number>
  // ファイルにある全行の uuid(rewind で外れた枝も含む)
  known: Set<string>
}

// 1行を、索引づけに要る情報だけに縮めたもの。長いセッションでも保持量を抑える
export type Row = {
  uuid: string
  parent?: string
  isSidechain: boolean
  at: number
} & (
  | { kind: 'prompt' | 'queued'; text: string }
  | { kind: 'reply'; tools: { id: string; name: string; file?: string }[]; isError: boolean }
  | { kind: 'duration'; ms: number }
  | { kind: 'interrupt' }
  | { kind: 'other' }
)

// エンジンが本人の行として書く、プロンプトではない行(slash コマンド・bash モード・通知など)
const WRAPPER = /^<(command-|local-command-|bash-|system-reminder|task-notification|user-prompt-submit-hook)/
// artifact を開いたまま送ったとき、エンジンがプロンプトの前に付ける閲覧状態
const VIEW_CONTEXT = /^\s*<artifact-view-context artifact="[^"]*">\n\{"context":[\s\S]*?\n<\/artifact-view-context>/
const INTERRUPTED = /^\[Request interrupted by user/
const EDITING_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

export const cleanText = (text: string) => text.replace(VIEW_CONTEXT, '').trim()
export const isPromptText = (text: string) => text !== '' && !WRAPPER.test(text) && !text.startsWith('/')

const textOf = (content: unknown) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text)
    .join('\n')
}

export function parseLine(line: string): Row | undefined {
  let raw: any
  try {
    raw = JSON.parse(line)
  } catch {
    return undefined // 書き込み途中の最終行など
  }
  if (typeof raw?.uuid !== 'string') return undefined
  const parent = raw.parentUuid ?? raw.logicalParentUuid
  const base = {
    uuid: raw.uuid,
    parent: typeof parent === 'string' ? parent : undefined,
    isSidechain: raw.isSidechain === true,
    at: Date.parse(raw.timestamp),
  }
  if (raw.type === 'system' && raw.subtype === 'turn_duration' && typeof raw.durationMs === 'number') {
    return { ...base, kind: 'duration', ms: raw.durationMs }
  }
  if (raw.type === 'assistant') {
    const content = Array.isArray(raw.message?.content) ? raw.message.content : []
    const tools = content
      .filter((block: any) => block?.type === 'tool_use' && typeof block.id === 'string')
      .map((block: any) => {
        const file = block.input?.file_path ?? block.input?.notebook_path
        return { id: block.id, name: String(block.name), ...(typeof file === 'string' ? { file } : {}) }
      })
    return { ...base, kind: 'reply', tools, isError: raw.isApiErrorMessage === true }
  }
  // 実行中のターンに差し込まれたプロンプトは、独立した user 行ではなく添付として残る
  if (raw.type === 'attachment' && raw.attachment?.type === 'queued_command') {
    const text = typeof raw.attachment.prompt === 'string' ? cleanText(raw.attachment.prompt) : ''
    return isPromptText(text) ? { ...base, kind: 'queued', text } : { ...base, kind: 'other' }
  }
  if (raw.type !== 'user' || raw.isMeta || raw.isCompactSummary || raw.message?.role !== 'user') {
    return { ...base, kind: 'other' }
  }
  const content = raw.message.content
  const text = cleanText(textOf(content))
  // ツール実行中の中断通知は tool_result と同じ行に乗るので、tool_result の判定より先に見る
  if (INTERRUPTED.test(text)) return { ...base, kind: 'interrupt' }
  if (Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result')) return { ...base, kind: 'other' }
  return isPromptText(text) ? { ...base, kind: 'prompt', text } : { ...base, kind: 'other' }
}

// 生きている枝の uuid: 最後の行から親をたどった鎖。rewind で捨てた枝はファイルに残るが含まない
function liveBranch(rows: readonly Row[]) {
  const byId = new Map(rows.map(row => [row.uuid, row]))
  const live = new Set<string>()
  let row = rows.findLast(candidate => !candidate.isSidechain)
  while (row && !live.has(row.uuid)) {
    live.add(row.uuid)
    row = row.parent === undefined ? undefined : byId.get(row.parent)
  }
  return live
}

export function indexRows(rows: readonly Row[]): TranscriptIndex {
  const live = liveBranch(rows)
  const prompts: Prompt[] = []
  const owners = new Map<string, number>()
  // ターンを始めたプロンプト。差し込まれたプロンプトは一覧に載るが、ターンの要約は始めた側に残す
  let starter = -1
  const times: { start: number; last: number }[] = []
  for (const row of rows) {
    if (row.isSidechain || !live.has(row.uuid)) continue
    const turn = prompts[starter]?.turn
    switch (row.kind) {
      case 'prompt':
        prompts.push({ id: row.uuid, text: row.text, turn: { tools: 0, files: [] } })
        starter = prompts.length - 1
        times[starter] = { start: row.at, last: row.at }
        break
      case 'queued':
        prompts.push({ id: row.uuid, text: row.text, turn: { tools: 0, files: [] } })
        break
      case 'reply': {
        if (!turn) break
        // 応答は、届いたかどうかに関係なく最新のプロンプトの下に並ぶ
        const owner = prompts.length - 1
        owners.set(row.uuid, owner)
        if (row.isError) turn.outcome = 'error'
        if (Number.isFinite(row.at)) times[starter]!.last = row.at
        for (const tool of row.tools) {
          owners.set(tool.id, owner)
          turn.tools++
          if (EDITING_TOOLS.has(tool.name) && tool.file !== undefined && !turn.files.includes(tool.file)) turn.files.push(tool.file)
        }
        break
      }
      case 'duration':
        if (turn) turn.durationMs = (turn.durationMs ?? 0) + row.ms
        break
      case 'interrupt':
        if (turn) turn.outcome = 'interrupted'
        break
    }
  }
  prompts.forEach((prompt, i) => {
    const time = times[i]
    if (time && Number.isFinite(time.start) && time.last > time.start) prompt.turn.spanMs = time.last - time.start
  })
  return { prompts, owners, known: new Set(rows.map(row => row.uuid)) }
}
