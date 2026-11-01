declare module 'claude-code' {
  interface PluginState {
    // このセッションのトランスクリプトのパス。hot reload 後の session.start はパスを持たないため
    'prompt-rail': { transcript: string }
  }
}
