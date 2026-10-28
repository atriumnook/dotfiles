// sitrep: 入力欄の上に作業の状況を4行(NOW / OPEN / DECIDE / NEXT)で出す。
// 枠とピルの色は andon に倣い、本人が要らないうちは緑、未確認があれば黄、
// 判断待ちか検証の失敗があれば赤にする
//
// 情報源は2つに分ける。ツールの記録(メインループのみ)から、モデルを使わずに
// 編集したファイル・最後に通った検証より後に編集したファイル・その検証を拾う。
// ターンの終わりにセッションを fork して(prompt cache を共有する)、作業の現在地・
// 仮定とリスク・判断・次の一手を書かせる。色はモデルに聞かず両方から決める。
// 押すと入力欄に下書きを書くだけで、送信は本人がする

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Card, Choice, Facts, Phase } from '../types/sitrep.d.ts'

const card = atom({ plugin: 'sitrep', key: 'card' } as const, null, { shape: 'card-1' })
const facts = atom(
  { plugin: 'sitrep', key: 'facts' } as const,
  { edited: [], unverified: [], lastCheck: null },
  { shape: 'facts-1' },
)
const phase = atom({ plugin: 'sitrep', key: 'phase' } as const, { kind: 'idle' }, { shape: 'phase-1' })
const isHidden = atom({ plugin: 'sitrep', key: 'isHidden' } as const, false)

const MIN_ANSWER_CHARS = 80
const MAX_OPEN = 3
const MAX_OPTIONS = 3
const MAX_NEXT = 2
const NOW_MAX = 80
const ITEM_MAX = 60
const LABEL_MAX = 40
const PROMPT_MAX = 600
const LABEL_COLUMNS = 8

const EDIT_PATH_ARGS: Readonly<Record<string, string>> = {
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
}

// 作業を検証するコマンド。一致した語だけを残して表示するので、
// コマンドの他の部分にあるトークンやパスは画面に出ない
const CHECK_COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|typecheck|build)|pytest|vitest|jest|tsc|mypy|ruff|shellcheck|bats|cargo\s+(?:test|check|clippy)|go\s+(?:test|vet)|make\s+(?:test|check)|claude\s+plugin\s+(?:test|validate))\b/

// モデルの出力は画面と入力欄に届き、モデルは信頼できない文字列も読んでいる。
// next-steps と同じく人に見える文字だけを残す: エスケープシーケンスと、制御・書式・
// 未割り当て・私用・サロゲートの文字を落とし、空白を畳み、結合文字の連なりと長さを抑える。
// Unicode のタグ文字を含む文字列は丸ごと捨てる
const ESCAPE_SEQUENCES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
const TAG_CHARACTERS = /[\u{E0000}-\u{E007F}]/u
const UNSEEN_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}\p{Variation_Selector}\u{115f}\u{1160}\u{3164}\u{ffa0}]/gu
const COMBINING_RUN = /(\p{M}{3})\p{M}+/gu

function clean(text: unknown, max: number): string {
  if (typeof text !== 'string' || TAG_CHARACTERS.test(text)) return ''
  const safe = text
    .replace(ESCAPE_SEQUENCES, '')
    .replace(/\s+/g, ' ')
    .replace(UNSEEN_CHARACTERS, '')
    .replace(COMBINING_RUN, '$1')
    .replace(/ {2,}/g, ' ')
    .trim()
  const points = [...safe]
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : safe
}

function stringArg(e: object, name: string): string | null {
  const value = (e as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : null
}

function withPath(paths: readonly string[], path: string): string[] {
  return paths.includes(path) ? [...paths] : [...paths, path]
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function factsLine(current: Facts): string {
  const check =
    current.lastCheck === null
      ? 'no check run yet'
      : `last check \`${current.lastCheck.label}\` ${current.lastCheck.isPassed ? 'passed' : 'failed'}`
  const unverified =
    current.unverified.length === 0 ? 'none' : current.unverified.map(baseName).join(', ')
  return `${current.edited.length} files edited; edited since the last passing check: ${unverified}; ${check}`
}

function forkPrompt(current: Facts): string {
  return (
    'Do not continue the task. Write a situation report of this session for the user, who glances at ' +
    'it to decide whether they need to step in. Write every text in the language the user writes in.\n\n' +
    `- now: one line, at most ${NOW_MAX} characters: where the work stands, the outcome first.\n` +
    `- open: up to ${MAX_OPEN} short items the user should know are not confirmed: assumptions you made, ` +
    'what you could not check, risks left. Do not list edited files or check runs: the report already ' +
    `shows them from the tool log (${factsLine(current)}).\n` +
    '- decision: the one question only the user can answer that blocks or changes the work, with up to ' +
    `${MAX_OPTIONS} options, the one you recommend first; each option is the prompt the user would send ` +
    'to choose it. null when nothing waits on the user.\n' +
    `- next: up to ${MAX_NEXT} prompts in the user's voice for the obvious next action (run the tests, ` +
    'commit, fix the thing you flagged), specific to this conversation. A skill or slash command may ' +
    'lead a prompt ("/name args") when it is listed in this conversation, spelled exactly.\n\n' +
    'Leave a field empty rather than filling it with something generic. Answer with ONLY a JSON object, ' +
    'no prose, no code fence: {"now": "...", "open": ["..."], "decision": {"question": "...", ' +
    `"options": [{"label": "<≤${LABEL_MAX} chars>", "prompt": "..."}]} | null, "next": [{"label": "...", ` +
    '"prompt": "..."}]}'
  )
}

// スラッシュで始まるプロンプトはコマンドを実行するので、
// セッションに無いコマンドを指すものは出さずに捨てる
function namesKnownCommand(prompt: string, known: ReadonlySet<string> | null): boolean {
  if (!prompt.startsWith('/') || known === null) return true
  return known.has(prompt.slice(1).split(' ', 1)[0] ?? '')
}

function choices(value: unknown, max: number, known: ReadonlySet<string> | null): Choice[] {
  if (!Array.isArray(value)) return []
  const items: Choice[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const prompt = clean((entry as { prompt?: unknown }).prompt, PROMPT_MAX)
    if (prompt === '' || !namesKnownCommand(prompt, known)) continue
    const label = clean((entry as { label?: unknown }).label, LABEL_MAX)
    items.push({ label: label === '' ? clean(prompt, LABEL_MAX) : label, prompt })
    if (items.length === max) break
  }
  return items
}

function parseCard(reply: string, known: ReadonlySet<string> | null): Card | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const raw = parsed as { now?: unknown; open?: unknown; decision?: unknown; next?: unknown }
  const now = clean(raw.now, NOW_MAX)
  if (now === '') return null
  const open = Array.isArray(raw.open)
    ? raw.open.map(item => clean(item, ITEM_MAX)).filter(item => item !== '').slice(0, MAX_OPEN)
    : []
  let decision: Card['decision'] = null
  if (typeof raw.decision === 'object' && raw.decision !== null) {
    const question = clean((raw.decision as { question?: unknown }).question, ITEM_MAX)
    const options = choices((raw.decision as { options?: unknown }).options, MAX_OPTIONS, known)
    if (question !== '' && options.length > 0) decision = { question, options }
  }
  return { now, open, decision, next: choices(raw.next, MAX_NEXT, known) }
}

type Signal = { glyph: string; label: string; color: string }

function signalOf(current: Card | null, gathered: Facts, now: Phase): Signal {
  if (now.kind === 'working') return { glyph: '◆', label: 'WORKING', color: 'claude' }
  if (now.kind === 'loading') return { glyph: '◌', label: 'UPDATING', color: 'suggestion' }
  if (current?.decision) return { glyph: '●', label: 'DECIDE', color: 'error' }
  if (gathered.lastCheck?.isPassed === false) return { glyph: '●', label: 'FAILED', color: 'error' }
  if (gathered.unverified.length > 0 || (current?.open.length ?? 0) > 0) {
    return { glyph: '●', label: 'REVIEW', color: 'warning' }
  }
  return { glyph: '●', label: 'ON TRACK', color: 'success' }
}

function unverifiedItem(paths: readonly string[]): string | null {
  if (paths.length === 0) return null
  const shown = paths.slice(-2).map(baseName).join(', ')
  return paths.length > 2 ? `未検証の変更 ${shown} ほか${paths.length - 2}件` : `未検証の変更 ${shown}`
}

function fill($: EngineInterface, text: string): void {
  void $.prompt.fill({ text }).then(
    r => r.isFilled || $.ui.toast('入力欄に書き込めませんでした'),
    error => $.ui.toast(`入力欄に書き込めませんでした: ${String(error)}`),
  )
}

// turnId のターンのレポートを fork に頼む。ターンの終了を待たせないよう、呼び出し側は待たない
async function report($: EngineInterface, turnId: string): Promise<void> {
  let fresh: Card | null = null
  try {
    // 一覧が取れなければ、スラッシュで始まるプロンプトは確かめずに通す
    const commands = await $.command.list().catch(() => null)
    const known = commands === null ? null : new Set(commands.map(command => command.name))
    const reply = await $.model.fork({ prompt: forkPrompt(await read($, facts)) })
    if (reply.isAnswered) fresh = parseCard(reply.text, known)
    else $.ui.log(`fork answered nothing: ${reply.reason}`)
  } catch (error) {
    $.ui.log(`fork failed: ${String(error)}`)
  }
  // 待つ間に次のターンが始まったか、別の問い合わせが片付けたなら捨てる
  const current = await read($, phase)
  if (current.kind !== 'loading' || current.turnId !== turnId) return
  if (fresh !== null) {
    const answered = fresh
    await update($, card, () => answered)
    await update($, isHidden, () => false)
  }
  await update($, phase, () => ({ kind: 'idle' }))
  const top = fresh?.next[0] ?? fresh?.decision?.options[0]
  if (top !== undefined) void $.prompt.suggest({ text: top.prompt }).catch(() => undefined)
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined) return ran
    const pathArg = EDIT_PATH_ARGS[e.tool]
    if (pathArg !== undefined) {
      const path = stringArg(e, pathArg)
      if (path !== null && ran.isError !== true) {
        await update($, facts, f => ({
          ...f,
          edited: withPath(f.edited, path),
          unverified: withPath(f.unverified, path),
        }))
      }
    } else if (e.tool === 'Bash') {
      const label = stringArg(e, 'command')?.match(CHECK_COMMAND)?.[0].replace(/\s+/g, ' ')
      if (label !== undefined) {
        const isPassed = ran.isError !== true
        await update($, facts, f => ({
          ...f,
          unverified: isPassed ? [] : f.unverified,
          lastCheck: { label, isPassed },
        }))
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, phase, () => ({ kind: 'working' }))
      await update($, isHidden, () => false)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    if (e.reason !== 'answer' || e.answer.trim().length < MIN_ANSWER_CHARS) {
      await update($, phase, () => ({ kind: 'idle' }))
      return result
    }
    const turnId = e.turnId
    await update($, phase, (): Phase => ({ kind: 'loading', turnId }))
    void report($, turnId)
    return result
  })

  // 読み込み直すと古い module の fork は途中で消えるが、$.state の phase は loading のまま残る。
  // 読み込み直しでこの hook がまた走るので、そこで問い合わせ直す
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const current = await read($, phase)
    if (current.kind === 'loading') void report($, current.turnId)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return below
    const [current, gathered, now, hidden] = await Promise.all([
      read($, card),
      read($, facts),
      read($, phase),
      read($, isHidden),
    ])
    if (hidden || (current === null && gathered.edited.length === 0 && now.kind === 'idle')) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const signal = signalOf(current, gathered, now)
    const check = gathered.lastCheck

    const header = (
      <Box key="header" justifyContent="space-between">
        <Box gap={1}>
          <Text backgroundColor={signal.color} color="inverseText" bold>
            {` ${signal.glyph} ${signal.label} `}
          </Text>
          <Text dimColor>sitrep</Text>
        </Box>
        <Box gap={2}>
          {gathered.edited.length > 0 && <Text dimColor>{`✎ ${gathered.edited.length}`}</Text>}
          {check !== null && (
            <Text color={check.isPassed ? 'success' : 'error'}>
              {`${check.isPassed ? '✓' : '✗'} ${check.label}`}
            </Text>
          )}
          {now.kind === 'idle' && current !== null && (
            <Button
              key="dismiss"
              hotkey="0"
              plain
              dimColor
              role="dismiss"
              label="hide"
              onPress={() => update($, isHidden, () => true)}
            />
          )}
        </Box>
      </Box>
    )

    // ターンの最中と最初のレポートの前は、andon の灯にあたるヘッダーだけを出す
    if (now.kind !== 'idle' || current === null) {
      return (
        <Box flexDirection="column">
          {below}
          {header}
        </Box>
      )
    }

    const row = (name: string, body: RenderChildren) => (
      <Box key={name}>
        <Box width={LABEL_COLUMNS} flexShrink={0}>
          <Text dimColor>{name}</Text>
        </Box>
        <Box flexGrow={1} flexDirection="column">
          {body}
        </Box>
      </Box>
    )

    const open = [unverifiedItem(gathered.unverified), ...current.open].filter(
      (item): item is string => item !== null,
    )
    let hotkey = 0
    const button = (choice: Choice, tone?: 'primary') => {
      hotkey += 1
      return (
        <Button
          key={`c${hotkey}`}
          hotkey={String(hotkey)}
          plain
          label={choice.label}
          dimColor={tone !== 'primary'}
          onPress={() => fill($, choice.prompt)}
        />
      )
    }

    // 色は状態(ピルと薄い枠)と行頭の印だけに付け、本文はテーマの文字色で読ませる
    return (
      <Box flexDirection="column">
        {below}
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={signal.color}
          borderDimColor
          paddingX={1}
        >
          {header}
          {row('NOW', <Text wrap="truncate-end">{current.now}</Text>)}
          {open.length > 0 &&
            row(
              'OPEN',
              open.map(item => (
                <Text wrap="truncate-end">
                  <Text color="warning">{'· '}</Text>
                  {item}
                </Text>
              )),
            )}
          {current.decision !== null &&
            row(
              'DECIDE',
              <Box flexDirection="column">
                <Text bold wrap="truncate-end">
                  {current.decision.question}
                </Text>
                <Box columnGap={3} flexWrap="wrap">
                  {current.decision.options.map((option, index) =>
                    button(option, index === 0 ? 'primary' : undefined),
                  )}
                </Box>
              </Box>,
            )}
          {current.next.length > 0 &&
            row(
              'NEXT',
              <Box columnGap={3} flexWrap="wrap">
                {current.next.map((choice, index) =>
                  button(choice, index === 0 && current.decision === null ? 'primary' : undefined),
                )}
              </Box>,
            )}
        </Box>
      </Box>
    )
  })
}
