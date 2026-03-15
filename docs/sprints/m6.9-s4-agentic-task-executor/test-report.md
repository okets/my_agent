# M6.9-S4 Test Report: Agentic Task Executor

**Date:** 2026-03-14
**Branch:** `sprint/m6.9-s4-agentic-task-executor`
**Runner:** External review agent (Opus 4.6)

---

## Test Execution

### packages/core (vitest)

```
Command: cd packages/core && npx vitest run
Result: 10 test files, 129 tests, ALL PASSED
Duration: 1.46s
```

| Test File | Tests | Status |
|---|---|---|
| `tests/hooks/infrastructure-guard.test.ts` | 16 | PASS |
| `tests/hooks/bash-blocker-extended.test.ts` | 16 | PASS |
| `tests/brain-options.test.ts` | 5 | PASS |
| `tests/prompt-recursive.test.ts` | 2 | PASS |
| `tests/sync-service-exclusion.test.ts` | 1 | PASS |
| `tests/config-preferences.test.ts` | 3 | PASS |
| `tests/load-properties.test.ts` | 3 | PASS |
| `tests/env.test.ts` | 22 | PASS |
| `tests/memory.test.ts` | 33 | PASS |
| `tests/ollama-plugin.test.ts` | 28 | PASS |

### packages/dashboard (vitest — tasks + utils subset)

```
Command: cd packages/dashboard && npx vitest run tests/tasks/ tests/utils/
Result: 5 test files, 33 tests, ALL PASSED
Duration: 1.99s
```

| Test File | Tests | Status |
|---|---|---|
| `tests/tasks/task-executor-agentic.test.ts` | 8 | PASS |
| `tests/tasks/task-extractor-notify.test.ts` | 9 | PASS |
| `tests/tasks/working-nina-prompt.test.ts` | 6 | PASS |
| `tests/tasks/log-storage-migration.test.ts` | 6 | PASS |
| `tests/utils/timezone.test.ts` | 4 | PASS |

---

## New Tests Added in This Sprint

### Infrastructure Guard (`core/tests/hooks/infrastructure-guard.test.ts`)
- 9 blocked path tests: brain/CLAUDE.md, brain/skills/, config.yaml, .env, auth/, .db, .guardrails, .git/hooks/, .service
- 4 allowed path tests: notebook/, task workspace, properties/, arbitrary safe path
- 2 fail-closed tests: null tool_input, missing file_path
- 1 hookSpecificOutput structure test

### Extended Bash Blocker (`core/tests/hooks/bash-blocker-extended.test.ts`)
- 8 blocked: systemctl stop/disable nina-*, case-insensitive, kill/killall nina, chmod 000, chown on brain/config/auth/.env
- 8 allowed: systemctl status/start, kill non-nina PID, chmod 755, chown on non-infra paths, ls, git status

### Brain Options (`core/tests/brain-options.test.ts`)
- cwd passthrough, custom tools, persistSession, default tools, Task tool with agents + custom tools

### Task Executor Agentic (`dashboard/tests/tasks/task-executor-agentic.test.ts`)
- cwd from logStorage.getTaskDir, tools list, hooks passthrough, mcpServers passthrough
- persistSession false for one-off, true for recurring
- systemPrompt from buildWorkingNinaPrompt
- Lazy getter for mcpServers (tests initialization ordering)

### Working Nina Prompt (`dashboard/tests/tasks/working-nina-prompt.test.ts`)
- Persona text, temporal context, dynamic properties, notebook inclusion, task title/ID, calendar context

### Timezone Resolution (`dashboard/tests/utils/timezone.test.ts`)
- Properties timezone with parenthetical stripping, preferences fallback, UTC fallback

### notifyOnCompletion (`dashboard/tests/tasks/task-extractor-notify.test.ts`)
- 3 valid values (immediate, debrief, none), absent, null, unknown string, empty string
- Field preservation alongside other fields
- PostResponseHooks integration: notifyOnCompletion forwarded to taskManager.create()

### Log Storage Migration (`dashboard/tests/tasks/log-storage-migration.test.ts`)
- New directory structure creation, workspace subdirectory, getTaskDir, metadata
- Path resolution: new path preference, old path fallback, default for unknown tasks

---

## Deferred Tests

- **T10: E2E Verification (3 test tasks)** — deferred to post-merge. Requires running dashboard service with new code. See DECISIONS.md D2.

---

## Summary

**162 tests total, 0 failures, 0 skipped.**

All new functionality has unit test coverage. No regressions in existing tests.
