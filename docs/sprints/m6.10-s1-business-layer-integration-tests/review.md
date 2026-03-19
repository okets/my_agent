# M6.10-S1 Sprint Review

**Sprint:** M6.10-S1 Business Layer Integration Tests
**Reviewer:** External (Opus)
**Date:** 2026-03-19

## Verdict: PASS

All spec requirements met. 33 new integration tests pass alongside 575 existing tests.

## Spec Coverage

- [x] `tests/integration/` directory created
- [x] Thin `AppHarness` instantiates services without Fastify
- [x] Conversation lifecycle tests (create, turns, status transitions, inactive callback)
- [x] Task lifecycle tests (CRUD, status transitions, notification, conversation linking)
- [x] Channel message flow tests (handler instantiation, external message routing)
- [x] Memory sync tests (write file, index, FTS search, deletion, exclusion)
- [x] State publishing tests (debounced broadcasts, notification wiring)
- [x] Live update audit (documents all mutation paths and broadcast coverage)
- [x] All new integration tests pass
- [x] Existing 575 tests still pass

## Code Quality

**AppHarness (app-harness.ts):**
- Correctly mirrors `index.ts` service wiring: ConversationManager, TaskManager, TaskLogStorage, NotificationService, ConnectionRegistry, StatePublisher
- Own ConnectionRegistry instance (not module singleton) prevents cross-test contamination
- Broadcast interception captures all `broadcastToAll()` calls for assertion
- Clean lifecycle: `create()` factory with temp dirs, `shutdown()` with cleanup
- Memory subsystem opt-in via `{ withMemory: true }` — good for test isolation

**Integration tests:**
- Tests are genuinely cross-service (not unit tests): conversation lifecycle tests verify status transitions trigger callbacks, task tests verify junction table linking, state publishing tests verify mutation → broadcast pipeline
- Assertions are meaningful: verify data shapes, status transitions, array contents
- Live update audit documents all mutation paths from the spec's audit table with current coverage status

## Issues

None blocking.

## Recommendations (non-blocking)

1. **Channel message flow tests are thin** (2 tests) — the full owner message flow requires Agent SDK streaming. Could add owner routing tests in S2 once the App class provides mockable chat entry points.
2. **State publishing debounce tests use timing** (150-200ms waits) — acceptable but could be fragile under heavy CI load. Consider exposing a `flush()` method on StatePublisher in S2.
3. **Live update audit could annotate S2 expectations** — explicitly mark which "manual" paths will become "structural" after App extraction, making the test file serve as the S2 migration checklist.
