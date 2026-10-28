// キー1つで入力欄に取り込めるプロンプト
export type Choice = { label: string; prompt: string }

// 本人にしか決められない1つの判断。選択肢は推奨を先頭に置く
export type Decision = { question: string; options: Choice[] }

// ターンの終わりに fork が書くレポート
export type Card = { now: string; open: string[]; decision: Decision | null; next: Choice[] }

// セッションで走った検証コマンド(テスト・型検査・lint など)
export type Check = { label: string; isPassed: boolean }

// ツールの記録からモデルを使わずに拾う事実: 編集したファイル、最後に通った検証より後に
// 編集したファイル、その検証
export type Facts = { edited: string[]; unverified: string[]; lastCheck: Check | null }

export type Phase = { kind: 'idle' } | { kind: 'working' } | { kind: 'loading'; turnId: string }

declare module 'claude-code' {
  interface PluginState {
    sitrep: {
      card: Shaped<Card | null>
      facts: Shaped<Facts>
      phase: Shaped<Phase>
      isHidden: boolean
    }
  }
}
