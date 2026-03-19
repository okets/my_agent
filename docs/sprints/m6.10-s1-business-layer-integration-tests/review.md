# M6.10-S1 Sprint Review

**Sprint:** M6.10-S1 Business Layer Integration Tests
**Reviewer:** External (Opus)
**Date:** 2026-03-19

## Verdict: PASS

All spec requirements are met. 33 integration tests pass. 608 full suite tests pass (0 failures). Code quality is good with minor suggestions below.

---

## Spec Coverage

- [x] Create `tests/integration/` directory
- [x] Thin `AppHarness` that instantiates services without Fastify
- [x] Conversation lifecycle tests (7 tests: create, turns, demotion, inactive callback, ordering, deletion)
- [x] Task lifecycle tests (7 tests: create, scheduled, status transitions, soft-delete, callback, notification, junction linking)
- [x] Channel message flow tests (2 tests: handler instantiation, unknown sender rejection)
- [x] Memory sync tests (5 tests: init, indexing, FTS search, deletion tracking, exclusion patterns)
- [x] State publishing tests (4 tests: task publish, conversation publish, debounce, notification broadcast)
- [x] Live update audit tests (8 tests: task CRUD broadcasts, conversation CRUD broadcasts, notification wiring, sync events, audit summary documentation)
- [x] All integration tests pass
- [x] Existing tests still pass (608 total, 0 failures)

---

## Code Quality

### What was done well

1. **AppHarness mirrors index.ts correctly.** The initialization sequence matches: ConversationManager first, then TaskManager from the shared DB via `getDb()`, then NotificationService, then ConnectionRegistry (own instance, not the module singleton from `chat-handler.ts`), then StatePublisher. Constructor parameter shapes are verified against the actual service constructors.

2. **Broadcast capture is the right design.** Intercepting `broadcastToAll` at the ConnectionRegistry level tests the actual publish path end-to-end rather than mocking StatePublisher internals. This means the tests will catch regressions in both StatePublisher logic and ConnectionRegistry wiring.

3. **Tests are genuine integration tests.** The conversation-lifecycle tests exercise ConversationManager + SQLite DB + transcript storage. State-publishing tests exercise TaskManager + StatePublisher + ConnectionRegistry in a single flow. Memory tests wire SyncService + MemoryDb + SearchService. These are not disguised unit tests.

4. **Assertions are substantive.** Tests verify specific IDs, status values, timestamps, array lengths, and content matches. The debounce test checks both that batching occurred (fewer broadcasts than mutations) and that the final snapshot contains all entities -- both conditions matter.

5. **API surfaces match actual code.** `ChannelBinding` shape (`id`, `transport`, `ownerIdentity`, `ownerJid`), `SearchService.recall()` return type (`RecallResult` with `notebook`/`daily` arrays), task input shapes, and `TranscriptTurn` type all match the real codebase. The implementation agent correctly adapted where the plan's samples diverged from actual APIs.

6. **Clean lifecycle.** Each harness creates an isolated temp directory and removes it on shutdown, preventing cross-test contamination. The `withMemory` option keeps memory subsystem initialization opt-in for tests that do not need it.

### Deviations from plan (all justified)

1. **`SearchService.search()` became `SearchService.recall()`** -- actual API uses `recall()` returning `RecallResult`. Correctly adapted.

2. **`ChannelBinding` shape adapted** -- plan used `{ transportId, identity, role }`, actual type uses `{ id, transport, ownerIdentity, ownerJid }`. Correctly adapted.

3. **`TaskProcessor` not wired in harness** -- requires TaskExecutor which needs Agent SDK. The plan acknowledged this limitation.

4. **Memory sync uses `beforeAll`/`afterAll`** -- avoids recreating MemoryDb per test. Appropriate since the tests build on shared state intentionally.

5. **Notification `importance` values** -- plan used `"low"`, implementation uses `"info"`. Matches actual `NotificationService` API.

---

## Issues

### None (Critical or Important)

No blocking issues found.

---

## Recommendations (non-blocking)

1. **Channel message flow coverage is thin (2 tests).** The plan acknowledged this. Consider adding an owner-identity routing test in S2 once the App class provides mockable chat entry points, even without streaming a response.

2. **Skills entity type lacks a behavioral test in the audit.** The audit summary documents hatching has "no broadcast" and MCP skill tools are "partial," but no behavioral test demonstrates this. Understandable since skill mutations flow through MCP servers requiring Agent SDK. Worth noting for S2 planning.

3. **State publishing debounce tests use real timers.** The 150ms waits (vs 100ms debounce) have sufficient margin and pass reliably. For future-proofing, consider `vi.useFakeTimers()` with `vi.advanceTimersByTime(100)` or exposing a `flush()` method on StatePublisher in S2.

4. **Module-scope `harness` variables in some test files.** In `task-lifecycle.test.ts`, `state-publishing.test.ts`, and `live-update-audit.test.ts`, `harness` is declared at module scope rather than inside a `describe` block. Works correctly (Vitest isolates files), but wrapping in `describe` is more conventional. Minor style point.

5. **For S2 planning:** The live update audit tests are the key deliverable. The audit summary explicitly documents which paths are "manual" vs "structural." After S2, update these tests to assert that `app.emit()` fires for every mutation -- converting the "manual" entries to "structural" with behavioral proof.
