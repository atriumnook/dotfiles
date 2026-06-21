---
name: html-artifact
description: 端末では描画できない視覚的・対話的な出力が必要な時に使用。フロー/状態遷移/アーキ図、3案以上のグリッド比較、デザイン mockup、スライダー/ドラッグ/トグル等の操作UI、端末1画面に収まらない報告書。ASCII 図や mermaid/SVG を端末に流そうとしている、説明が長く読みにくい、が合図。短い回答・概念A/B/C選択・トレードオフ表・コミット説明などテキストで足りる出力には使わない。
---

# HTML 成果物の生成

端末は図・SVG・操作要素を描画できない(ASCII 図は読みにくく mermaid はソースのまま出る)。視覚・対話が要る出力は端末に流さず、単一の自己完結 HTML にして生成しブラウザで開く。一時的に見せて捨てるのが目的。

## 発火トリガー(該当したら使う)
- フロー / 状態遷移 / アーキテクチャ図
- 3案以上のグリッド比較
- UI mockup・デザイン案
- スライダー / ドラッグ / トグル等の操作要素が要る説明
- 端末1画面に収まらない長い報告書・学習資料

合図: ASCII 図を描こうとしている / mermaid・SVG を端末に出そうとしている。
使わない: 短い回答、概念A/B/C選択、トレードオフ表、コミット説明、テキストで足りるもの。

## 出力するもの
- 1ファイル完結の HTML。CSS/JS はインライン、外部依存は CDN のみ(ビルド不要)
- 用途に応じ mermaid(CDN)/ SVG / 表 / 操作要素(スライダー・ドラッグ・トグル)を使う
- 実データを使う。プレースホルダー・ダミーデータで埋めない
- 端末には「生成した旨とパス」を1〜2行返すだけ。図を ASCII で再掲しない

## 保存先(OS の一時ディレクトリ)
一時的に見せるのが目的のため一時dirに置く。ファイル名は英数字とハイフンのみ(日本語・空白は WSL のパス変換に失敗するため使わない)。
- POSIX: `${TMPDIR:-/tmp}/claude-artifacts/<slug>.html`
- Windows PowerShell: `$env:TEMP\claude-artifacts\<slug>.html`

## ブラウザで開く(OS 非依存・実行時判定)
```sh
open_in_browser() {
  f="$1"
  case "$(uname -s)" in
    Darwin) open "$f" ;;
    Linux)
      if command -v wslview >/dev/null 2>&1; then wslview "$f"
      elif grep -qi microsoft /proc/version 2>/dev/null; then explorer.exe "$(wslpath -w "$f")"
      else xdg-open "$f"; fi ;;
    MINGW*|MSYS*|CYGWIN*) start "" "$f" ;;
    *) echo "手動で開いてください: $f" ;;
  esac
}
```
ネイティブ Windows の PowerShell からは `Invoke-Item <path>` または `start <path>`。

## 起動
- 「HTMLで」等の明示依頼 / `/html-artifact`: 即生成
- description のトリガーに自動該当: 生成前に1行で可否確認(ファイル生成・ブラウザ起動という副作用を伴うため)

## スコープ外(v1)
- 段階ごとの複数ファイル・index.html による資産ライブラリ運用
- 永続ディレクトリへの長期保管・後続セッションからの参照
- コードレビュー専用テンプレート

これらが要る用途では揮発・見せ捨ての前提が崩れるため、別途相談する。
