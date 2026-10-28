import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'sitrep',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

const ANSWER = 'include 方式に切り替え、マシン固有の設定は ~/.gitconfig.local に分けました。'.repeat(3)

// plugin の下で engine の代わりをする。ツールはすべて応答し、検証コマンドは `fail` を含むと失敗し、
// fork は `report` を返す。`stall` を渡すと、読み込み直しで途切れた fork のように1回目がその時計で1分待つ
function engine(on: On, report: object | null = null, stall?: MockClock) {
  let forks = 0
  on('tool.call', (_, e) =>
    String((e as { command?: unknown }).command ?? '').includes('fail')
      ? { isError: true, result: 'exit 1', text: 'exit 1' }
      : { result: {} },
  )
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.list', () => ({ value: [] }))
  on('prompt.suggest', () => ({ isShown: true }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.fork', async () => {
    forks += 1
    if (stall !== undefined && forks === 1) await stall.sleep(60_000)
    return {
      value:
        report === null
          ? { isAnswered: false, reason: 'empty-reply', usage: USAGE }
          : { isAnswered: true, text: JSON.stringify(report), usage: USAGE },
    }
  })
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

const edit = (path: string) => ({ tool: 'Edit' as const, file_path: path, old_string: 'a', new_string: 'b' })

test('検証が通ると未検証の変更を消し、コマンドは検証の語だけを出す', async ($, on) => {
  engine(on)
  await $.tool.call(edit('/repo/git/config'))
  await $.tool.call({ tool: 'Bash', command: 'API_TOKEN=dummy-value-not-shown npm test -- --watch=false' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /ON TRACK/ }))?.text).toContain('ON TRACK')
    expect((await ui.find({ type: 'Text', text: /✓/ }))?.text).toBe('✓ npm test')
    expect(await ui.find({ type: 'Text', text: /dummy-value-not-shown/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('最後に通った検証より後の編集は要確認にし、検証が失敗したら赤にする', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call(edit('/repo/a.ts'))

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /REVIEW/ }))?.text).toContain('REVIEW')
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'npm test fail' })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /FAILED/ }))?.text).toContain('FAILED')
  expect((await ui.find({ type: 'Text', text: /✗/ }))?.text).toBe('✗ npm test')
  await ui.unmount()
})

test('サブエージェントの編集はレポートに数えない', async ($, on) => {
  engine(on)
  await $.tool.call({ ...edit('/repo/a.ts'), agentId: 'a1' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /sitrep/ })).toBeUndefined()
  await ui.unmount()
})

test('判断待ちがあればカードを赤にし、選択肢を押すと入力欄に書き込む', async ($, on) => {
  const clock = mock.clock(on)
  const filled = engine(on, {
    now: 'gitconfig を include 方式に分割済み',
    open: ['macOS では未確認'],
    decision: {
      question: '既存の symlink をどうするか',
      options: [
        { label: 'include で進める', prompt: 'include 方式で進めて' },
        { label: 'symlink に戻す', prompt: 'symlink 方式に戻して' },
      ],
    },
    next: [{ label: 'commit する', prompt: 'commit して' }],
  })
  await $.tool.call(edit('/repo/a.ts'))
  await $.turn.start({ text: 'split it', turnId: 't1' })
  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /● DECIDE/ }))?.text).toBe(' ● DECIDE ')
    expect((await ui.find({ type: 'Text', text: /symlink をどうするか/ }))?.text).toBe('既存の symlink をどうするか')
    expect((await ui.find({ type: 'Text', text: /未検証の変更/ }))?.text).toContain('a.ts')
    await ui.press({ key: 'c3' })
    await ui.unmount()
  }
  expect(filled).toEqual(['commit して', 'commit して'])
})

test('セッションに無いコマンドを指す候補と、隠し文字を含む項目は捨てる', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, {
    now: 'done',
    open: ['ok\u{E0041}hidden'],
    decision: null,
    next: [
      { label: 'ghost', prompt: '/no-such-command go' },
      { label: 'commit', prompt: 'commit して' },
    ],
  })
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /ON TRACK/ }))?.text).toContain('ON TRACK')
  expect(await ui.find({ key: 'c2' })).toBeUndefined()
  expect(await ui.find({ key: 'c1' })).toBeDefined()
  await ui.unmount()
})

test('読み込み直しで途切れたレポートは、session.start で問い合わせ直す', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { now: 'done', open: [], decision: null, next: [] }, clock)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' })
  await clock.settle()

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /UPDATING/ }))?.text).toBe(' ◌ UPDATING ')
  await ui.unmount()

  // 読み込み直すと session.start がまた走る。1回目の fork は戻ってこない
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /ON TRACK/ }))?.text).toBe(' ● ON TRACK ')
  await ui.unmount()
})
