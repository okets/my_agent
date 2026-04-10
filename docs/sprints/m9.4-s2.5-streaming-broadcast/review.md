# M9.4-S2.5: Streaming Broadcast — External Review

> **Reviewer:** External reviewer (independent, zero shared context)
> **Date:** 2026-04-10
> **Verdict:** PASS WITH CONCERNS

---

## Spec Coverage

### S2.5 Addendum Requirements (Section 9 of design spec)

| Requirement | Status | Notes |
|-------------|--------|-------|
| 1. `ChatService.sendMessage()` emits `chat:*` App events | PARTIAL | `chat:text_delta`, `chat:thinking_delta`, `chat:thinking_end`, `chat:error`, `chat:done` all emit. **BUT `chat:start` is NOT emitted for message 1** — only for the split-path message 2. See I1. |
| 2. WS adapter subscribes to `chat:*` events and broadcasts | PASS | `index.ts` subscribes to all 8 chat events, broadcasts via `connectionRegistry` |
| 3. Chat-handler stops sending streaming events directly | PASS | `chatEventToServerMessage` removed, no direct `send()` for streaming events |
| 4. `conversation_ready` removed | PASS | Removed from protocol.ts, message-handler.ts, and app.js |
| `sendSystemMessage()` emits streaming events | PASS | `chat:start` and `chat:text_delta` added |
| `chat:user_turn` + `chat:conversation_created` new events | PASS | Defined in `app-events.ts`, emitted from `chat-service.ts`, subscribed in `index.ts` |
| `conversation_created` double-broadcast removed | PASS | Two `broadcastToAll` blocks removed from message-handler.ts |
| `unpin()` routed through App | PASS | Two locations changed from direct `conversationManager.unpin()` to `app.conversations.unpin()` |
| `setModel()` routed through App | PASS | message-handler calls `app.chat.setModel()`, which now emits `conversation:updated` |
| AbbreviationQueue uses App events | PASS (pragmatic) | App event added via existing `onRenamed` callback instead of refactoring `abbreviation.ts`. Achieves the goal. |
| `job:started` event emission | PASS | Added to both `executeAndDeliver()` and `resume()` in automation-processor.ts. StatePublisher subscribes. |
| `external_message:created` event | PASS | Emitted from message-handler.ts after storing. No subscriber yet (as designed). |
| Split-path `chat:start` for message 2 | PASS | Emitted at line 770 in chat-service.ts |

### Plan vs Implementation Deviations

| Plan | Implementation | Risk |
|------|----------------|------|
| Modify `external-store.ts` directly | Emit from `message-handler.ts` instead | None — same result |
| Modify `app.ts` for setModel wrapper | Added emit in `chat-service.ts` directly | None — cleaner |
| Modify `abbreviation.ts` constructor | Added App event in existing `onRenamed` callback | None — pragmatic |
| Fix 6 broken tests | Already fixed in prior commit `f965646` | None — already resolved |

---

## Issues Found

### I1 (Medium): Missing `chat:start` emission for message 1 in `sendMessage()`

**Location:** `packages/dashboard/src/chat/chat-service.ts:648-655`

**Problem:** The plan (Task 1, Step 1) explicitly says to emit `this.app.emit("chat:start", convId)` after the initial `yield { type: "start" }`. This was NOT implemented. Only the split-path message 2 `chat:start` (Step 8, line 770) was added.

**Impact:** The `start` event triggers `isResponding = true` on the frontend (typing indicator). For the originating WS client this may not matter (they know they sent a message), but:
- **Second tab viewing the same conversation:** Would never receive `start`, so no typing indicator appears
- **Channel-triggered messages:** Dashboard clients viewing the conversation would not see the typing indicator
- **`sendSystemMessage()` correctly emits `chat:start`**, so alert/heartbeat paths work

**Severity:** Medium. Functional regression for multi-client scenarios. The streaming text itself still arrives (`text_delta` events fire), but the "Nina is typing..." indicator is missing until the first `text_delta`.

**Fix:** Add `this.app.emit("chat:start", convId);` after line 655 (after the `yield { type: "start" }` block).

---

## Double-Delivery Analysis

**Question:** Can a WS client receive the same streaming event twice?

**Flow for originating client (dashboard tab that sent the message):**

1. User sends message via WS
2. `chat-handler.ts` calls `app.chat.sendMessage()`
3. Before the first yield, `sendMessage()` emits `chat:user_turn` and `chat:conversation_created` as App events
4. The generator yields `start` with `_effects` — chat-handler calls `connectionRegistry.switchConversation(socket, conversationId)` to subscribe the socket
5. Generator yields streaming events (`text_delta`, etc.) — chat-handler does NOT `send()` them
6. Each yield is followed by `app.emit("chat:text_delta", ...)` which triggers `connectionRegistry.broadcastToConversation()` in `index.ts`
7. The originating socket IS in the conversation's viewer set (registered at step 4), so it receives the broadcast

**Verdict: No double-delivery.** The old direct `send()` path was removed. The only source of streaming events for any client is now the App event broadcast. The originating client is subscribed to the conversation and receives events through the same broadcast as all other clients.

**Edge case — `switchConversation` timing:** The socket is subscribed at step 4 (on `start` event), which happens BEFORE `text_delta` events. This ordering is correct because the generator yields `start` first, the chat-handler processes it synchronously (subscribes), then the generator continues to stream. There is no race condition because the `for await` loop processes events sequentially.

**Edge case — `chat:user_turn` timing:** The App event for user turn is emitted at line 658, AFTER the `start` yield at line 648. Since the chat-handler processes the `start` event first (subscribing the socket), the socket is registered by the time `broadcastToConversation` fires for `chat:user_turn`. However — this depends on the `for await` loop reaching the `start` event before the App event broadcast executes. Since both happen in the same tick (emit is synchronous, but the generator may resume before listeners fire), this is safe: the emit at line 658 runs after `yield` returns control to the chat-handler, which subscribes the socket, then control returns to the generator which calls emit. **No double-delivery, no missed events.**

**Edge case — `chat:conversation_created`:** This uses `broadcastToAll`, not `broadcastToConversation`, so it reaches all clients regardless of subscription. The old code sent `conversation_created` to the originating client via `send()` AND to others via `broadcastToAll(socket)` (excluding originator). The new code sends to ALL clients via one `broadcastToAll`. This is correct — no duplicate.

---

## Regression Risk Assessment

| Path | Risk | Reason |
|------|------|--------|
| Dashboard chat (happy path) | Low | Generator yields + App events + broadcast. Tests pass. |
| Channel message streaming | Low | `conversation_ready` removed, but channel messages now flow through `sendMessage()` which emits chat events. Dashboard clients viewing the conversation see streaming. |
| `sendSystemMessage()` (alert/heartbeat) | Low | `chat:start` + `chat:text_delta` + `chat:done` all emitted. Previously only `chat:done` was emitted. |
| Multi-tab streaming | **Medium** | Missing `chat:start` for message 1 (I1). Typing indicator absent. Text still streams correctly. |
| `/new` command (channel) | Low | Removed direct `conversation_created` broadcast. Relies on `conversation:created` -> StatePublisher. 100ms debounce delay acceptable per DECISIONS.md D2. |
| Job progress card | Low | `job:started` now emits. StatePublisher subscribes. |
| Voice transcript update | **Medium** | The old code had `send(userTurnUpdate)` specifically noted as "needed for voice transcript updates" (client sent "[Voice message]", server has transcribed text). This is now handled by `chat:user_turn` -> `broadcastToConversation`. The originating client receives this. Should work, but the comment about voice transcripts suggests this was a specific fix — worth HITL verification. |
| Error handling | Low | `chat:error` emitted in catch block. Broadcast to conversation viewers. |

---

## Summary

The implementation correctly moves streaming broadcasts from the WS adapter to the App event layer. The core architecture change is sound — emit from ChatService, subscribe in index.ts, broadcast via connectionRegistry. Double-delivery is properly avoided by removing direct sends from the chat-handler.

**One concrete issue (I1):** Missing `chat:start` emission for the first message in `sendMessage()`. This means the typing indicator won't appear for non-originating clients. The fix is a single line addition.

**One HITL verification recommended:** Voice transcript updates (originating client previously received a dedicated `send()` for the transcribed user turn — now receives it via broadcast). Functionally equivalent but worth confirming.

**Verdict: PASS WITH CONCERNS** — merge after fixing I1 (missing `chat:start` for message 1).
