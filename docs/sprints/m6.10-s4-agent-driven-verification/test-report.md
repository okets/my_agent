# Test Report — M6.10-S4 Agent-Driven Verification

**Date:** 2026-03-20
**Runner:** External Opus (independent)
**Command:** `cd packages/dashboard && npx vitest run`

---

## Summary

| Metric | Count |
|--------|-------|
| Test files | 72 |
| Tests passed | 682 |
| Tests skipped | 2 |
| Tests failed | 0 |
| TypeScript (`tsc --noEmit`) | Clean (0 errors) |

**Baseline:** 640 tests, 69 files, 2 skipped (from plan.md)
**Delta:** +42 tests, +3 files, 0 new skips, 0 regressions

---

## New Test Files (S4)

### agent-debug-scenario.test.ts (29 tests)

Tests debug query pure functions and the `AppDebugService` wrapper against a real temporary agent directory.

| Test | Status |
|------|--------|
| getBrainStatus() -- returns expected shape | PASS |
| getBrainStatus() -- reports not hatched for fresh agentDir | PASS |
| getBrainStatus() -- returns a model string | PASS |
| getBrainStatus() -- brainDir matches agentDir passed in | PASS |
| getBrainStatus() -- returns none auth when no credentials configured | PASS |
| getBrainFiles() -- returns root and files array | PASS |
| getBrainFiles() -- root is the brain subdirectory | PASS |
| getBrainFiles() -- lists AGENTS.md created by AppHarness | PASS |
| getBrainFiles() -- file entries have path, size, modified fields | PASS |
| getBrainFiles() -- files are sorted by path | PASS |
| getBrainFiles() -- returns empty files list if brain directory has no files | PASS |
| getSystemPrompt() -- returns systemPrompt, components, and totalChars | PASS |
| getSystemPrompt() -- systemPrompt is a string | PASS |
| getSystemPrompt() -- totalChars matches systemPrompt length | PASS |
| getSystemPrompt() -- components has expected keys | PASS |
| getSystemPrompt() -- personality component found when AGENTS.md exists | PASS |
| getSystemPrompt() -- identity/contacts/preferences are null when files missing | PASS |
| getSystemPrompt() -- notebooks has the expected notebook names | PASS |
| getSystemPrompt() -- skills has framework and user counts | PASS |
| getSystemPrompt() -- assembles a prompt that includes AGENTS.md content | PASS |
| app.debug -- brainStatus() returns same data as standalone function | PASS |
| app.debug -- brainFiles() lists files | PASS |
| app.debug -- systemPrompt() returns prompt with components | PASS |
| Full debug inspection -- agent can verify brain is not hatched in test env | PASS |
| Full debug inspection -- agent can inspect system prompt components | PASS |
| Full debug inspection -- agent can list all brain files | PASS |
| getSkills() -- returns framework and user arrays | PASS |
| getSkills() -- user skills empty when .claude/skills not present | PASS |
| getSkills() -- accepts custom frameworkSkillsDir | PASS |

### agent-qa-scenario.test.ts (9 tests)

Tests headless chat flow using mock SDK sessions -- no real LLM calls.

| Test | Status |
|------|--------|
| sends a message and collects streaming response | PASS |
| streams text_delta events with response content | PASS |
| persists user message and response in transcript | PASS |
| auto-creates conversation when conversationId is null | PASS |
| rejects messages exceeding max length | PASS |
| emits chat:done event on completion | PASS |
| handles mock error responses | PASS |
| supports multi-turn conversation headlessly | PASS |
| chat:done event includes conversation ID | PASS |

### agent-task-scenario.test.ts (4 tests)

Tests headless task lifecycle through the AppTaskService and event system.

| Test | Status |
|------|--------|
| creates task and receives events headlessly | PASS |
| updates task status and receives event | PASS |
| deletes task and receives event | PASS |
| task lifecycle: create -> run -> complete (full scenario) | PASS |

---

## Browser Verification

N/A -- no UI changes in this sprint. No files in `public/` were modified.

---

## Regression Check

All 640 pre-existing tests continue to pass. The refactoring of `routes/debug.ts` to delegate to `debug-queries.ts` did not break any existing debug route tests.
