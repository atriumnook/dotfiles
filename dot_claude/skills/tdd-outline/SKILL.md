---
name: tdd-outline
description: Generate test case outlines (it.todo) based on requirements. Use when user says "generate test cases", "create test outline", "write test todos", or before implementing a new feature with TDD.
disable-model-invocation: true
argument-hint: [feature description or requirements]
---

# TDD: Test Outline Generation

## Instructions

Generate a comprehensive test outline for the feature described in $ARGUMENTS. Output only the test structure (describe/it.todo), not actual test logic or implementation code.

### Design principles

Test case names serve as living documentation. Write each `it.todo` name in Japanese using the pattern 「〜の時、〜であること」to make the expected behavior explicit.

Cover four dimensions:
- Happy path (normal cases)
- Edge cases (boundary values, empty inputs, max/min)
- Error cases (invalid inputs, failures)
- Invariants (state that must not change)

### Step 1: Analyze the requirements

Read $ARGUMENTS and identify:
- Core functionality to test
- Input constraints and boundaries
- Expected outputs and side effects
- Failure modes

If the specification or data flow is ambiguous, ask the user before proceeding. Do not guess.

### Step 2: Design test cases

For each dimension (happy path, edge cases, errors, invariants), list concrete scenarios that must be tested.

### Step 3: Create the test file

Generate the test file using Vitest's `describe` and `it.todo`. Structure:

```typescript
import { describe, it } from 'vitest';

describe('<feature name>', () => {
  describe('<scenario group>', () => {
    // Intent: why this group exists
    it.todo('<シナリオの時、期待される結果であること>');
  });
});
```

## Constraints

- Do NOT write actual test logic (no arrange, no mocks, no assertions)
- Do NOT write implementation code
- Do NOT create test cases that assume mock usage
- Each `it.todo` must be accompanied by a comment explaining intent
- Use Japanese for `it.todo` names in the format 「〜の時、〜であること」

## Examples

### Example 1: Ranking dashboard

User invokes: `/tdd-outline ランキング表示機能。デフォルト7日間、上位20件、期間はフロントで変更可能`

Expected output:

```typescript
import { describe, it } from 'vitest';

describe('ランキング表示', () => {
  describe('デフォルト集計', () => {
    // Intent: baseline behavior with no user input
    it.todo('デフォルト期間(7日間)で上位20件が返ること');
  });

  describe('期間変更', () => {
    // Intent: frontend-driven period override
    it.todo('フロントから期間を変更した時、指定期間のランキングが返ること');
  });

  describe('境界値', () => {
    // Intent: upper bound of result count
    it.todo('上位20件を超えるデータが存在する時、20件のみ返ること');
  });

  describe('エラーケース', () => {
    // Intent: guard against invalid period input
    it.todo('不正な期間が指定された時、エラーが返ること');
  });

  describe('不変条件', () => {
    // Intent: data integrity under all conditions
    it.todo('データが存在しない時、空配列が返りエラーにならないこと');
  });
});
```

## Troubleshooting

### Test cases feel too abstract

Cause: Requirements are stated at too high a level.
Solution: Ask the user for concrete input/output examples or boundary values before generating outlines.

### Difficult to name in Japanese naturally

Cause: The scenario is overly complex.
Solution: Split the scenario into multiple `it.todo` entries, each with a focused behavior.
