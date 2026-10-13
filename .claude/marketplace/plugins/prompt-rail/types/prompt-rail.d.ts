declare module 'claude-code' {
  interface PluginState {
    // 読んでいる位置や一覧が変わると増やす。帯が描画中に読むので、増やすと帯だけ描き直される
    'prompt-rail': { moved: number }
  }
}
