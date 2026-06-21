# ast-grep 実践ルール例

言語別の実践的なルール YAML 例。各例の教育的なポイント(no-as-any 等の fix なし理由)は SKILL.md 参照。

## TypeScript

### deprecated API の書き換え

```yaml
id: migrate-old-api
language: TypeScript
severity: error
rule:
  pattern: oldClient.fetch($URL, $OPTS)
fix: newClient.request($URL, $OPTS)
message: oldClient.fetch は廃止。newClient.request に移行する。
```

### 特定 import の禁止

```yaml
id: no-lodash-import
language: TypeScript
severity: warning
rule:
  pattern: import $_ from 'lodash'
message: lodash の全体 import を禁止。lodash/xxx を使う。
fix: import $_ from 'lodash/xxx' // TODO: 正しいパスに修正
```

### React コンポーネント内の直接 fetch 禁止

```yaml
id: no-fetch-in-component
language: TypeScript
severity: warning
rule:
  pattern: fetch($$$ARGS)
  inside:
    any:
      - kind: function_declaration
        has:
          field: return_type
          pattern: JSX.Element
      - kind: arrow_function
        inside:
          kind: variable_declarator
          regex: '^[A-Z]'
    stopBy: end
message: コンポーネント内で直接 fetch しない。hooks か server action を使う。
```

## Rust

### unwrap() の禁止

```yaml
id: no-unwrap
language: Rust
severity: warning
rule:
  pattern: $EXPR.unwrap()
  not:
    inside:
      kind: function_item
      regex: '#\[test\]'
      stopBy: end
message: テスト以外で unwrap() を使わない。? か expect() を使う。
note: unwrap() は panic するため、本番コードでは避ける。
```

### unsafe ブロックの検出

```yaml
id: flag-unsafe-block
language: Rust
severity: warning
rule:
  kind: unsafe_block
message: unsafe ブロック。安全性の根拠をコメントで示す。
```

### println! を log マクロに移行

```yaml
id: no-println-in-lib
language: Rust
severity: warning
rule:
  pattern: println!($$$ARGS)
  not:
    inside:
      kind: function_item
      regex: 'fn main'
      stopBy: end
message: ライブラリコードで println! を使わない。log::info! 等を使う。
fix: log::info!($$$ARGS)
files:
  - "src/lib.rs"
  - "src/**/mod.rs"
  - "src/**/*.rs"
ignores:
  - "src/main.rs"
  - "src/bin/**"
```

## Go

### エラー無視の検出

```yaml
id: no-ignored-error
language: Go
severity: error
rule:
  kind: short_var_declaration
  has:
    kind: identifier
    regex: '^_$'
    field: left
  has:
    kind: call_expression
    field: right
    stopBy: end
message: エラーを _ で無視しない。適切にハンドリングする。
```

### defer で Close する忘れ防止

```yaml
id: defer-close-after-open
language: Go
severity: warning
rule:
  kind: short_var_declaration
  has:
    pattern: os.Open($PATH)
    field: right
    stopBy: end
  not:
    precedes:
      pattern: defer $_.Close()
      stopBy:
        kind: return_statement
message: os.Open の直後に defer Close() を入れる。
```

## Python

### bare except の禁止

```yaml
id: no-bare-except
language: Python
severity: warning
rule:
  kind: except_clause
  not:
    has:
      kind: identifier
      stopBy: neighbor
message: bare except を使わない。具体的な例外型を指定する。
```

### print() をロガーに移行

```yaml
id: no-print-in-src
language: Python
severity: warning
rule:
  pattern: print($$$ARGS)
  not:
    inside:
      kind: function_definition
      regex: 'def main'
      stopBy: end
message: print() ではなく logger を使う。
fix: logger.info($$$ARGS)
files:
  - "src/**"
```
