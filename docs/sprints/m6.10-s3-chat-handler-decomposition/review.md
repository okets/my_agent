# M6.10-S3 External Review

**Reviewer:** Claude Opus (external reviewer agent)
**Date:** 2026-03-20
**Verdict:** PASS

## Spec Compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| ChatService extracted from chat-handler.ts | Met | `AppChatService` in `src/chat/chat-service.ts` (642 lines) contains all business logic |
| Conversation switching logic in ChatService | Met | `connect()`, `switchConversation()`, `newConversation()`, `newConversationWithWelcome()` |
| Skill command expansion extracted | Met | `src/chat/skill-expander.ts` — pure function `expandSkillCommand()` |
| Message validation and preprocessing | Met | `MAX_MESSAGE_LENGTH` check, attachment processing, content block construction |
| Streaming orchestration (start -> deltas -> done) | Met | `sendMessage()` returns `AsyncGenerator<ChatEvent>` with full lifecycle |
| Auth/hatching flow coordination | Met (via decision) | DEC-1: Kept in WS adapter — justified as transport-specific |
| WS adapter: parse JSON -> call app.chat.* -> subscribe to events -> send JSON | Met | `handleMessage()` delegates all operations to `app.chat.*` |
| ChatService emits events, WS adapter forwards them | Met | `chat:done` emitted on App; streaming events yielded via generator (DEC-3) |
| S1 integration tests pass | Met | All 640 tests pass (69 files) |
| Existing tests pass | Met | 640 passed, 2 skipped (same 2 as baseline) |
| chat-handler.ts < 200 lines | Not met (accepted deviation) | 523 lines (down from 1398 — 63% reduction). See DEV-1 |

## Code Quality

**Architecture:** Clean separation between stateless service (`AppChatService`) and stateful transport adapter (`chat-handler.ts`). The service takes explicit IDs and returns typed results or async generators — no knowledge of WebSocket. This matches the established service namespace pattern (`AppTaskService`, `AppConversationService`).

**Type safety:** Well-typed throughout. `ChatEvent` discriminated union, `StartEffects` interface for side-effect metadata, typed `ChatServiceDeps` for dependency injection. The `chatEventToServerMessage()` mapper in the adapter provides exhaustive switch coverage.

**Pattern consistency:** The `AsyncGenerator<ChatEvent>` pattern for streaming is consistent with the existing `SessionManager.streamMessage()` approach (DEC-3). The `_effects` mechanism on the start event (DEC-4) is pragmatic — avoids a separate return channel for side-effect data.

**Error handling:** Errors are yielded as `ChatEvent` items with `type: "error"`, keeping the generator contract clean. Post-stream processing (turn saving, search indexing, naming triggers) is properly wrapped with try/catch and fire-and-forget patterns.

**Dependency injection:** `ChatServiceDeps` allows the adapter to inject transport-specific services (attachment service, idle timer, search indexing, post-response hooks) without polluting the chat service constructor. The `setDeps()` call is idempotent.

**Module structure:** Clean barrel export in `src/chat/index.ts`. Skill expander is a pure function module — easily testable in isolation.

## Deviations Assessment

**DEV-1 (chat-handler.ts ~530 lines vs <200 target):** Justified. The 200-line target assumed auth/hatching would move to ChatService. The decision to keep auth/hatching in the adapter (DEC-1) is architecturally correct — these flows send WS controls, compose hints, and auth protocol messages. The remaining adapter code is structurally thin: message routing switch, auth gate, notification forwarding, socket lifecycle. All business logic is extracted. The spirit of the spec is met.

## Issues Found

**None at critical or major severity.**

- **Minor:** `connectionRegistry` is still a module-level singleton in `chat-handler.ts` (line 24) rather than being created in `index.ts` and passed in as the plan's Key Design Decisions section specifies. This works but creates implicit coupling. The plan says "moves from being a chat-handler.ts module singleton to being created in index.ts and passed to both the Fastify adapter and App.create()." This was partially done (App.create takes connectionRegistry) but the WS adapter still exports its own.

- **Info:** `chatEventToServerMessage()` maps `ChatEvent.text` to `ServerMessage.content` (e.g., `text_delta` event's `text` field becomes wire message's `content` field). This field name mismatch is intentional (matching existing wire protocol) but worth documenting.

- **Info:** The `sendMessage` generator yields `chat:done` on the App emitter (line 614) but not `chat:start`, `chat:text_delta`, `chat:thinking_delta`, or `chat:thinking_end`. These events are defined in `app-events.ts` but only `chat:done` is actually emitted. This is fine for S3 (the generator is the primary streaming channel) but may need attention if non-WS consumers want to subscribe to streaming events via the App emitter.

## Recommendations

1. **ConnectionRegistry wiring:** Consider moving the `connectionRegistry` creation from `chat-handler.ts` to `index.ts` (as the plan specifies) in a follow-up. This would complete the singleton elimination.

2. **App event coverage for streaming:** If S4 (agent-driven verification) needs to observe streaming events without a generator, consider emitting `chat:text_delta` etc. on the App emitter in addition to yielding them from the generator.

3. **sendMessage integration tests:** The current tests cover conversation CRUD operations thoroughly (21 tests) but don't test `sendMessage()` streaming — presumably because it requires a real SessionManager/SDK session. Consider adding a mock SessionManager path in a future sprint for isolated streaming tests.
