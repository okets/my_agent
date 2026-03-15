# M6.9-S5 Tool Separation -- Test Report

**Date:** 2026-03-15
**Branch:** `sprint/m6.9-s5-tool-separation`
**Runner:** vitest (Node.js)

---

## Test Results

### Dashboard Package

```
Test Files:  48 passed (48)
Tests:       464 passed | 2 skipped (466)
Duration:    53.75s
```

All 48 test files pass. The 2 skipped tests are pre-existing (unrelated to S5).

### Core Package

```
Test Files:  10 passed (10)
Tests:       129 passed (129)
Duration:    1.51s
```

All 10 test files pass. No core changes in this sprint -- confirms no regressions.

### Combined

| Metric | Count |
|---|---|
| Total test files | 58 |
| Total tests passed | 593 |
| Total tests skipped | 2 |
| Total tests failed | 0 |

---

## New Tests Added (S5)

### MCP Tool Tests

| File | Tests | What's Covered |
|---|---|---|
| `tests/mcp/create-task.test.ts` | 6 | Creates immediate task + triggers processor; creates scheduled task without trigger; passes work items with pending status; passes notifyOnCompletion and model; defaults notifyOnCompletion to immediate; returns error on create failure |
| `tests/mcp/update-property.test.ts` | 4 | Updates location; updates timezone; updates availability with medium confidence; returns error on write failure |
| `tests/mcp/search-tasks.test.ts` | 5 | Returns formatted results with IDs; handles empty results; passes status and limit options; returns error when service unavailable; returns error on search failure |

### Existing Test Updates

| File | Tests | Changes |
|---|---|---|
| `tests/mcp/task-tools-server.test.ts` | 6 | Renamed from task-revision-server.test.ts; updated imports and server name assertions; test logic unchanged |
| `tests/tasks/task-extractor-notify.test.ts` | 12 | Updated to remove PostResponseHooks dependency; tests normalization logic directly |

### Infrastructure Tests

| File | Tests | What's Covered |
|---|---|---|
| `tests/conversations/missed-task-detector.test.ts` | 6 | Logs warning on missed task; skips when Nina already created task (within 5 min); skips when no task needed; verifies detection-only (no create call); detects stale linked tasks (>5 min); handles extraction errors gracefully |
| `tests/tasks/task-search-service.test.ts` | 9 | FTS5 indexing; re-index replaces entry; keyword search returns ranked results; status filtering (completed vs all); excludes deleted tasks; empty results on no match; respects limit parameter; isSemanticAvailable returns false without plugin; isSemanticAvailable returns false without vector table |

---

## Coverage Assessment

### Well Covered

- **create_task tool:** All code paths tested (immediate, scheduled, work items, options, errors)
- **update_property tool:** All three property types + error path
- **search_tasks tool:** Results, empty, options, unavailable, failure
- **Missed task detector:** Detection, skip conditions, error resilience
- **TaskSearchService (FTS5):** Indexing, search, filtering, limits, deletion

### Not Covered (by design)

- **Vector search path in TaskSearchService:** Requires live sqlite-vec + embeddings plugin. Consistent with ConversationSearchService test pattern which also only tests FTS5.
- **Integration tests:** create_task -> TaskProcessor -> TaskExecutor flow not tested end-to-end in automated tests. This is a manual E2E verification.
- **Frontend task context:** `app.js` change is a single line (`taskId: tab.data?.task?.id`). No automated frontend tests exist in this project.
- **System prompt injection:** The `[Active Task View]` block in system-prompt-builder is structural (string concatenation), not independently testable without mocking the full prompt builder.

### Pre-existing Issues

- `tests/knowledge-extractor.test.ts` has a flaky test in full-suite runs (documented in DECISIONS.md D2). Not related to S5.

---

## Conclusion

All 593 tests pass. 30 new tests were added covering all new MCP tools, the missed task detector, and the TaskSearchService. Test quality is consistent with existing project patterns. No regressions introduced.
