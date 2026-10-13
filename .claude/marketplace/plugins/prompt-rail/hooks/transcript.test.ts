import { describe, expect, test } from 'claude-code/testing'
import { indexRows, parseLine, type Row } from './transcript.ts'

let clock = Date.parse('2026-10-14T00:00:00Z')
const at = () => new Date((clock += 1000)).toISOString()

const user = (uuid: string, parentUuid: string | null, content: unknown, extra: object = {}) =>
  JSON.stringify({ type: 'user', uuid, parentUuid, timestamp: at(), message: { role: 'user', content }, ...extra })
const assistant = (uuid: string, parentUuid: string, tools: { id: string; name: string; file?: string }[] = [], extra: object = {}) =>
  JSON.stringify({
    type: 'assistant',
    uuid,
    parentUuid,
    timestamp: at(),
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }, ...tools.map(t => ({ type: 'tool_use', id: t.id, name: t.name, input: t.file ? { file_path: t.file } : {} }))],
    },
    ...extra,
  })
const duration = (uuid: string, parentUuid: string, durationMs: number) =>
  JSON.stringify({ type: 'system', subtype: 'turn_duration', uuid, parentUuid, timestamp: at(), durationMs })

const rows = (...lines: string[]) => lines.map(line => parseLine(line)).filter((row): row is Row => row !== undefined)

describe('indexRows', () => {
  test('本人のプロンプトだけを順に並べ、ターンの要約を付ける', () => {
    const index = indexRows(
      rows(
        user('u1', null, '最初の依頼'),
        assistant('a1', 'u1', [{ id: 't1', name: 'Edit', file: '/repo/src/app.ts' }, { id: 't2', name: 'Bash' }]),
        user('r1', 'a1', [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }]),
        duration('d1', 'r1', 5000),
        user('m1', 'd1', 'メタ行', { isMeta: true }),
        user('c1', 'm1', '<command-name>/model</command-name>'),
        user('s1', 'c1', '/clear'),
        user('u2', 's1', [{ type: 'text', text: '二つ目' }]),
        assistant('a2', 'u2', [{ id: 't3', name: 'Write', file: '/repo/README.md' }]),
      ),
    )
    expect(index.prompts.map(p => p.text)).toEqual(['最初の依頼', '二つ目'])
    expect(index.prompts[0]!.turn).toMatchObject({ durationMs: 5000, tools: 2, files: ['/repo/src/app.ts'] })
    expect(index.prompts[1]!.turn).toMatchObject({ tools: 1, files: ['/repo/README.md'] })
    expect(index.owners.get('a1')).toBe(0)
    expect(index.owners.get('t3')).toBe(1)
  })

  test('rewind で捨てた枝のプロンプトは載せない', () => {
    const index = indexRows(
      rows(
        user('u1', null, '残る'),
        assistant('a1', 'u1'),
        user('u2', 'a1', '捨てた枝'),
        assistant('a2', 'u2'),
        user('u3', 'a1', '巻き戻して送り直した'),
        assistant('a3', 'u3'),
      ),
    )
    expect(index.prompts.map(p => p.text)).toEqual(['残る', '巻き戻して送り直した'])
    expect(index.known.has('u2')).toBe(true)
  })

  test('実行中に差し込んだプロンプトも載るが、ターンの要約は始めた側に残る', () => {
    const queued = JSON.stringify({
      type: 'attachment',
      uuid: 'q1',
      parentUuid: 'a1',
      timestamp: at(),
      attachment: { type: 'queued_command', prompt: 'ついでにこれも' },
    })
    const index = indexRows(rows(user('u1', null, '始めた'), assistant('a1', 'u1'), queued, assistant('a2', 'q1', [{ id: 't1', name: 'Bash' }])))
    expect(index.prompts.map(p => p.text)).toEqual(['始めた', 'ついでにこれも'])
    expect(index.prompts[0]!.turn.tools).toBe(1)
    expect(index.prompts[1]!.turn.tools).toBe(0)
  })

  test('中断と API エラーをターンの結果として残す', () => {
    const index = indexRows(
      rows(
        user('u1', null, '止めた'),
        assistant('a1', 'u1'),
        user('i1', 'a1', [{ type: 'text', text: '[Request interrupted by user]' }]),
        user('u2', 'i1', '失敗した'),
        assistant('a2', 'u2', [], { isApiErrorMessage: true }),
      ),
    )
    expect(index.prompts.map(p => p.turn.outcome)).toEqual(['interrupted', 'error'])
  })

  test('artifact の閲覧状態を外し、打った文面だけを残す', () => {
    const text = '<artifact-view-context artifact="abc">\n{"context":{"x":1}}\n</artifact-view-context>\n本文'
    expect(indexRows(rows(user('u1', null, text))).prompts.map(p => p.text)).toEqual(['本文'])
  })

  test('書き込み途中の行や uuid の無い行は読み飛ばす', () => {
    expect(parseLine('{"type":"user","uuid":"u1"')).toBeUndefined()
    expect(parseLine('{"type":"summary"}')).toBeUndefined()
  })
})
