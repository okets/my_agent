# M6.9-S5 Tool Separation -- External Review

**Reviewer:** Claude Opus 4.6 (external review agent)
**Branch:** `sprint/m6.9-s5-tool-separation`
**Spec:** `docs/superpowers/specs/2026-03-15-conversation-tool-separation-design.md`
**Date:** 2026-03-15
**Diff:** 22 files changed, +1629 / -194

---

## 1. Spec Coverage

| Spec Section | Status | Evidence |
|---|---|---|
| S3: Conversation Nina's new tool set | PASS | `session-manager.ts:321` sets `tools: ["WebSearch", "WebFetch"]`. MCP tools (memory, knowledge, create_task, revise_task, update_property, search_tasks, debrief) remain via MCP servers. Playwright kept in shared servers (Decision D1). |
| S4: create_task MCP tool | PASS | `task-tools-server.ts:77-157` implements full schema (title, instructions, work, type, conversationId, scheduledFor, notifyOnCompletion, model). Handler creates task, links to conversation, triggers processor for immediate tasks. 6 unit tests. |
| S5: update_property MCP tool | PASS | `task-tools-server.ts:159-202` implements full schema (key, value, confidence, source). Delegates to existing `updateProperty()`. 4 unit tests. |
| S6: search_tasks MCP tool | PASS | `task-tools-server.ts:204-269` implements full schema (query, status filter, limit). Delegates to TaskSearchService. Handles unavailable service, empty results, and errors. 5 unit tests. |
| S6.1: Hybrid FTS5+vector search with RRF | PASS | `task-search-service.ts` implements FTS5 keyword search, vector search via sqlite-vec, RRF merge (K=60). Graceful fallback to FTS5-only. 9 unit tests. |
| S6.3: DB tables (tasks_fts, tasks_vec, task_embedding_map) | PASS | `db.ts` creates `tasks_fts` (FTS5) and `task_embedding_map` in migrations. `tasks_vec` created dynamically by TaskSearchService when dimensions are known. |
| S6.2: Fire-and-forget indexing | PASS | `task-manager.ts` has `onTaskCreated` callback. `index.ts` wires `taskSearchService.indexTask()` with `.catch(() => {})` for fire-and-forget. |
| S7: WebUI task context | PASS | `protocol.ts:74` adds `"task"` to ViewContext type, `taskId` field at line 79. `chat-handler.ts:831-834` calls `sessionManager.setTaskContext()`. `system-prompt-builder.ts:124-128` injects `[Active Task View]` block. `app.js` passes `taskId: tab.data?.task?.id`. |
| S8: Post-response hook -> missed task detector | PASS | `post-response-hooks.ts` fully rewritten. Detection-only: calls `extractTaskFromMessage()`, checks for recent linked tasks (5min window), logs `[MissedTaskDetector]` warning. No task creation. Deps simplified (Decision D3). 6 unit tests. |
| S9: Tool restriction implementation | PASS | `session-manager.ts:321` sets `tools: ["WebSearch", "WebFetch"]`. Working Nina unchanged (TaskExecutor already has explicit tool list). |
| S10: Standing orders update | PASS | `.my_agent/notebook/reference/standing-orders.md` contains "Task Delegation" section (verified via grep). Private file, not committed. |
| S11: Files changed | PASS | All files listed in spec Section 11 were modified. Exact match. |
| S12: Edge cases | PARTIAL | Most edge cases handled structurally (simple questions via WebSearch, research via create_task, search for past tasks, viewing task context). "Embeddings unavailable" fallback is implemented (FTS5-only). No explicit test for "multiple tasks in one message" or "user uploads file" flows, but these are behavioral (prompt-driven), not code-enforced. |
| S13: Conversation ID routing | PASS | `conversationId` is an explicit parameter on `create_task`. Passed from session context in system prompt. Error handling returns error to conversation Nina (not silent). |
| S14: Test strategy | PARTIAL | See Gaps section. Unit tests for create_task, update_property, search_tasks, missed task detector, and TaskSearchService are all present. Integration and E2E tests are not in the codebase (expected -- these are manual verification). |

---

## 2. Gaps

### Important (should fix)

**G1: FTS5 query injection risk (low severity)**
In `task-search-service.ts:175`, the raw `query` string is passed directly to `tasks_fts MATCH ?` via parameterized binding. This is safe from SQL injection, but FTS5 MATCH syntax can cause errors on certain input characters (e.g., unbalanced quotes, special FTS5 operators like `OR`, `AND`, `*`). The `ConversationSearchService` likely has the same pattern, so this is a pre-existing design choice, but a `try/catch` around FTS5 queries would prevent user-facing errors. The outer `try/catch` at line 208 does catch this, so impact is limited to an empty result set rather than a crash.

**Verdict:** Already handled by the existing try/catch. No fix required.

### Suggestions (nice to have)

**G2: No vector search integration tests**
The `TaskSearchService` tests only cover FTS5-only mode. Vector search (with mock embeddings) is not tested because the test doesn't initialize the vector table. This mirrors the ConversationSearchService test pattern, so it is consistent. A future sprint could add vector integration tests.

**G3: `task_embedding_map` schema deviation from spec**
The spec (Section 6.3) defines `vec_rowid INTEGER PRIMARY KEY` while the implementation uses `vec_rowid INTEGER PRIMARY KEY AUTOINCREMENT` with `task_id TEXT NOT NULL UNIQUE`. The implementation is actually better -- AUTOINCREMENT ensures monotonically increasing rowids (important for vec0), and `UNIQUE` on `task_id` enables the `ON CONFLICT` upsert pattern in `indexTask()`. This is a beneficial deviation.

**G4: Frontend task context only reads `tab.data?.task?.id`**
The `app.js` change adds `taskId: tab.data?.task?.id` to the chatContext. This depends on task data being populated in `tab.data.task` when viewing a task. If the frontend rendering path does not set `tab.data.task`, the taskId will be undefined and the task context injection will silently not fire. This should be verified manually.

---

## 3. Unspecified Additions

None. The implementation follows the spec closely. All decisions about deviations are documented in `DECISIONS.md`.

---

## 4. Code Quality Assessment

### Strengths

- **Consistent patterns:** TaskSearchService mirrors ConversationSearchService exactly (RRF K=60, overfetch 3x, fallback to FTS5-only). This makes the codebase predictable.
- **Error handling:** Every MCP tool handler has try/catch with `isError: true` responses. The search service logs warnings but never blocks task creation.
- **Clean separation:** The deps interface pattern (`TaskToolsServerDeps`) keeps dependencies explicit and testable.
- **Fire-and-forget safety:** `indexTask()` errors are caught and warned, never propagated. `onTaskCreated` callback in index.ts uses `.catch(() => {})`.
- **PostResponseHooks simplification:** Removing unused deps (broadcastToConversation, publishTasks, taskProcessor) is clean and reduces coupling.

### Type Safety

- All MCP tool schemas use Zod with descriptive `.describe()` strings.
- The `TaskSearchResult` interface is well-defined with proper optional fields.
- `BuildContext` interface properly extended with `activeTaskContext`.
- `ViewContext` type union properly extended with `"task"`.

### Potential Issues

- **None critical.** The implementation is solid.

### Style and Conventions

- Code follows existing project patterns (mock SDK in tests, deps interfaces, fire-and-forget async).
- Comments reference spec sections (`M6.9-S5`).
- No unused imports or dead code detected.

---

## 5. Test Summary

| Suite | Tests | Status |
|---|---|---|
| Dashboard (all 48 files) | 464 passed, 2 skipped | PASS |
| Core (all 10 files) | 129 passed | PASS |
| **Total** | **593 passed** | **PASS** |

### New Tests Added (S5)

| Test File | Tests | Coverage |
|---|---|---|
| `tests/mcp/create-task.test.ts` | 6 | Immediate task, scheduled task, work items, notify/model passthrough, error handling |
| `tests/mcp/update-property.test.ts` | 4 | Location, timezone, availability updates, error handling |
| `tests/mcp/search-tasks.test.ts` | 5 | Results formatting, empty results, options passthrough, unavailable service, search failure |
| `tests/mcp/task-tools-server.test.ts` | 6 (updated) | Server creation, revise_task (5 cases) -- existing tests adapted to new name |
| `tests/conversations/missed-task-detector.test.ts` | 6 | Missed detection, already-handled skip, no-task-needed skip, detection-only verification, stale task handling, error resilience |
| `tests/tasks/task-search-service.test.ts` | 9 | FTS5 indexing, re-indexing, keyword search, status filtering, deleted task exclusion, empty results, limit enforcement, semantic availability checks |

**New test count: 30 tests added/modified for S5 features.**

---

## 6. Verdict

**PASS**

The implementation is a faithful execution of the spec with no missing functionality and no critical issues. All 7 commits map cleanly to the plan's 9 tasks (T1 through T9, with T2+T3 and T7+T8 merged into single commits). Tests are comprehensive for the unit level. Decisions are documented. The code follows existing patterns and integrates cleanly with the existing architecture.

The only suggestion is to verify the frontend task context path (G4) manually during E2E testing to ensure `tab.data.task` is populated when viewing task tabs/popovers.
