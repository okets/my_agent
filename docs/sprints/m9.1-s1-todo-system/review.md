# External Verification Report

**Sprint:** M9.1-S1 Todo System + MCP Server
**Reviewer:** External Opus (independent)
**Date:** 2026-04-05

## Spec Coverage

Checked against Design Spec "System 1: Universal Todo System" and Implementation Plan "Sprint 1 Validation" criteria.

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| TodoItem shape (id, text, status, mandatory, validation, validation_attempts, notes, created_by) | COVERED | `packages/core/src/spaces/todo-types.ts` matches spec exactly |
| TodoFile shape (items + last_activity) | COVERED | `packages/core/src/spaces/todo-types.ts:15-18` |
| TodoTemplate shape | COVERED | `packages/core/src/spaces/todo-types.ts:20-26` |
| ValidationResult shape | COVERED | `packages/core/src/spaces/todo-types.ts:28-31` |
| TodoStatus union (pending, in_progress, done, blocked) | COVERED | `packages/core/src/spaces/todo-types.ts:1` |
| TodoCreator union (agent, framework, delegator) | COVERED | `packages/core/src/spaces/todo-types.ts:2` |
| JSON storage with atomic writes (temp + rename) | COVERED | `packages/dashboard/src/automations/todo-file.ts:27-29`, tested in `todo-file.test.ts` |
| `readTodoFile` returns empty file for missing path | COVERED | `todo-file.ts:16-19`, tested |
| `createEmptyTodoFile` | COVERED | `todo-file.ts:5-11`, tested |
| `touchActivity` utility | COVERED | `todo-file.ts:32-36` |
| 4 MCP tools: todo_list, todo_add, todo_update, todo_remove | COVERED | `packages/dashboard/src/mcp/todo-server.ts`, all 4 implemented |
| `todo_add` creates agent items (mandatory=false) | COVERED | `todo-server.ts:58-76`, tested |
| `todo_update` changes status and notes | COVERED | `todo-server.ts:78-102`, tested |
| `todo_remove` rejects mandatory items with isError | COVERED | `todo-server.ts:105-134`, tested |
| `todo_remove` returns isError for not-found | COVERED | `todo-server.ts:108-114`, tested |
| `todo_update` returns isError for not-found | COVERED | `todo-server.ts:81-87`, tested |
| last_activity updated on every tool call | COVERED | `touch()` called in all 4 tools, tested in `todo-server.test.ts` |
| Per-job MCP server instance (new per job) | COVERED | `automation-executor.ts:198-203`, creates per job.run_dir |
| Per-conversation MCP server instance | COVERED | `session-manager.ts:450-458`, per conversationId |
| Conversation path: `.my_agent/conversations/{id}/todos.json` | COVERED | `session-manager.ts:452-456` |
| Working nina path: `.my_agent/automations/.runs/{auto}/{job}/todos.json` | COVERED | `automation-executor.ts:199`, path.join(job.run_dir, "todos.json") |
| `createSdkMcpServer` pattern (in-process) | COVERED | `todo-server.ts:142`, same pattern as automation-server |
| `interrupted` added to JobStatus type | COVERED | `automation-types.ts:60` |
| `interrupted` handled in automation-job-service (prune skip) | COVERED | `automation-job-service.ts:298-300` |
| `interrupted` handled in automation-server (check_job_status) | COVERED | `automation-server.ts:360-372` |
| `interrupted` handled in automation-processor (event name) | COVERED | `automation-processor.ts:22` |
| `interrupted` handled in app.ts (running tasks display) | COVERED | `app.ts:1352-1369` |
| `interrupted` handled in app-events.ts (event map) | COVERED | `app-events.ts:52` |
| `interrupted` in automation-scheduler (skip) | COVERED | Scheduler queries `{ status: "running" }` only, so interrupted jobs are naturally excluded |
| Types exported from core barrel | COVERED | `packages/core/src/spaces/index.ts` and `packages/core/src/lib.ts` |

### Plan Validation Criteria (Sprint 1)

| Criterion | Status | Evidence |
|-----------|--------|----------|
| 1. All new tests pass, no regressions | PASS | 31/31 tests pass across 4 test files |
| 2. Acceptance test proves todo tools work in real conversation flow | PASS | `todo-acceptance.test.ts` — 6 tests including executor fire + tool operation |
| 3. `todo_remove` on mandatory item returns error | PASS | Unit test + acceptance test both verify |
| 4. `interrupted` status accepted without type errors | PASS | TypeScript compiles clean (core + dashboard) |
| 5. `todos.json` created in conversation and job directories | PASS | Acceptance test verifies executor creates file in run_dir; session-manager wires conversation path |

## Test Results

- **Core TypeScript:** compiles clean (0 errors)
- **Dashboard TypeScript:** compiles clean (0 errors)
- **todo-file.test.ts:** 4 passed, 0 failed
- **todo-server.test.ts:** 10 passed, 0 failed
- **automation-types.test.ts:** 11 passed, 0 failed
- **todo-acceptance.test.ts:** 6 passed, 0 failed
- **Total:** 31 passed, 0 failed, 0 skipped

## Browser Verification

Skipped -- sprint is pure library/utility/MCP code with no UI or server route changes. No files in `public/` were modified, no routes added, no server startup changes.

## Gaps Found

### Minor (non-blocking)

1. **Redundant label in app.ts:1366-1368.** The interrupted job display produces `"interrupted (interrupted)"`. The status value is "interrupted" and the suffix is "(interrupted)", giving a double-label. Cosmetic only -- the system prompt checker that reads this is unaffected functionally.

2. **Conversation todo server created per query, not per session.** Documented in DECISIONS.md (D1). `createTodoServer()` is called on every `query()` invocation, not once per session. The decision log correctly notes this is acceptable since the factory is lightweight (no connections, no state beyond the file path closure). No functional issue.

### None (spec requirements fully met)

No spec requirements from System 1 relevant to S1 scope were missed. Templates (System 2), heartbeat (System 3), enforcement hooks (System 4), and status communication (System 5) are correctly scoped to later sprints.

## Code Quality Observations

- **Separation of concerns is clean:** `createTodoTools()` returns bare handlers for testing; `createTodoServer()` wraps them in MCP. This makes the unit tests independent of the SDK.
- **Atomic write pattern is correct:** temp file + rename on the same filesystem is the standard approach for crash-safe writes.
- **ID generation is stateless:** `nextId()` reads existing IDs from the file each time, avoiding stale state from a closure counter. Good for crash resilience.
- **Error responses use `isError: true`** consistently across all rejection paths, matching the spec's requirement that "Tool responses use `isError: true` for rejections."
- **No deviations logged** -- the implementation matched the plan closely, with two documented decisions (D1: wiring location, D2: event map addition).

## Verdict

**PASS**

All 5 Sprint 1 validation criteria are met. Types, file I/O, MCP server, wiring, and acceptance tests are implemented as specified. TypeScript compiles clean. 31/31 tests pass. The one cosmetic issue (redundant "interrupted (interrupted)" label) does not affect functionality.
