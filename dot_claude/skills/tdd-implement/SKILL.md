---
name: tdd-implement
description: Implement Vitest test code from an existing test outline. Delegates to test-implementer subagent for isolated context execution.
disable-model-invocation: true
allowed-tools: Bash(npm run test *) Bash(docker compose *)
argument-hint: [test file path or outline file path]
context: fork
agent: test-implementer
---

# TDD: Test Implementation

## Instructions

Implement executable test code from the test outline at $ARGUMENTS.

### Step 1: Read the outline

Read the file at $ARGUMENTS. Identify:
- Existing describe/it.todo structure
- Which tests require DB setup, Prism setup, or both

### Step 2: Check existing utilities

Read `src/test-utils/` to understand available helpers before implementing.

### Step 3: Implement each test case

Convert each it.todo to it with full implementation. Apply the core principles from your system prompt throughout.

Preserve the outline's describe structure and it.todo names verbatim—they are documentation.

### Step 4: Run and verify

Execute: `npm run test <test file>`

For failures:
- Distinguish test code errors from implementation/specification errors
- Fix the former, skip+report the latter

## Output

Return to the main conversation:
- Path to implemented test file
- Number of tests implemented
- Number of tests skipped with reasons
- Test run result summary
