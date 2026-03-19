# M6.10-S1 Test Report

**Date:** 2026-03-19
**Branch:** `sprint/m6.10-s1-integration-tests`

## Integration Tests (new)

```
 ✓ tests/integration/task-lifecycle.test.ts (7 tests) 110ms
 ✓ tests/integration/conversation-lifecycle.test.ts (7 tests) 140ms
 ✓ tests/integration/channel-message-flow.test.ts (2 tests) 29ms
 ✓ tests/integration/state-publishing.test.ts (4 tests) 604ms
 ✓ tests/integration/live-update-audit.test.ts (8 tests) 989ms
 ✓ tests/integration/memory-sync.test.ts (5 tests) 129ms

 Test Files  6 passed (6)
      Tests  33 passed (33)
   Duration  4.62s
```

## Full Suite

```
 Test Files  67 passed (67)
      Tests  608 passed | 2 skipped (610)
   Duration  95.58s
```

## Test Breakdown by Suite

| Suite | Tests | Time | Coverage |
|---|---|---|---|
| Conversation Lifecycle | 7 | 140ms | Create, turns, status transitions, inactive callback, list order, delete |
| Task Lifecycle | 7 | 110ms | Create (immediate + scheduled), status transitions, soft-delete, callback, notification, conversation linking |
| Memory Sync | 5 | 129ms | Init, file indexing, FTS search, deletion, exclusion patterns |
| State Publishing | 4 | 604ms | Task broadcast, conversation broadcast, debounce batching, notification wiring |
| Channel Message Flow | 2 | 29ms | Handler instantiation, external sender rejection |
| Live Update Audit | 8 | 989ms | Task mutations (3), conversation mutations (2), notifications (1), memory (1), audit summary (1) |

## Baseline

- **Before sprint:** 61 test files, 575 tests (2 skipped)
- **After sprint:** 67 test files, 608 tests (2 skipped)
- **Net new:** 6 test files, 33 tests
- **Regressions:** 0
