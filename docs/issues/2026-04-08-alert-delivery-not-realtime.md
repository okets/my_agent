# Issue: alert() Delivers to Conversation but Not Streamed to WebSocket Clients

**Severity:** High — breaks the delegation UX loop
**Discovered:** M9.3-S3.5 CTO testing (2026-04-08)
**Status:** Open

---

## Summary

When a worker completes and the heartbeat delivers results via `ci.alert()`, the brain receives the notification, generates a response, and the turn is saved to the conversation database. But the response is NOT streamed to connected WebSocket clients in real-time. The user sees nothing until they refresh the page.

This breaks the delegation UX: the user asks Nina to research something → Nina delegates → worker completes → silence. The user stares at the chat waiting for results that are already in the database.

---

## Reproduction

1. Open the dashboard in a browser (WebSocket connected)
2. Ask Nina a research question (e.g., "Search American movies playing in Bangkok near the Amari hotel")
3. Nina delegates via `create_automation` (auto-fire, `sourceChannel: "dashboard"`)
4. Worker runs, completes all todos
5. Heartbeat picks up the completion notification, calls `ci.alert(prompt)`
6. `alert()` succeeds — the brain processes the prompt and generates a response
7. The response turn is saved to the conversation database
8. **The user sees nothing in the chat** — no new message appears
9. After refreshing the page, the response appears

---

## Root Cause

`ConversationInitiator.alert()` calls `sessionFactory.injectSystemTurn()` which streams the brain's response through the SDK session. The response is collected and saved as a transcript turn via `conversationManager.appendTurn()`. But unlike `chat.sendMessage()` (which broadcasts `text_delta`, `done`, etc. via WebSocket), `injectSystemTurn()` does not broadcast events to connected WebSocket clients.

The two paths:

| Path | Triggered by | Streams to WebSocket? |
|------|-------------|----------------------|
| `chat.sendMessage()` | User types a message | Yes — `text_delta`, `done`, `conversation_updated` |
| `ci.alert()` → `injectSystemTurn()` | Heartbeat notification | **No** — saves to DB only |

The response exists in the database but the browser has no way to know about it without polling or refreshing.

---

## Impact

With M9.3's delegation compliance working (research prompts trigger `create_automation`), this is now the primary bottleneck in the user experience. The full chain works:

1. Brain delegates ✓
2. Auto-fire starts worker immediately ✓
3. Worker completes with paper trail ✓
4. Heartbeat delivers notification ✓
5. Brain generates results response ✓
6. **Response not visible to user** ✗

The user asked a question, got "research worker is on it", then silence. The answer is sitting in the database but the chat looks frozen.

---

## Possible Fixes

**Option A: Broadcast from injectSystemTurn**
After `injectSystemTurn()` saves the response turn, emit a `conversation_updated` WebSocket event with the new turn. This is how `appendTurn` works in the chat handler — the same broadcast mechanism should work here.

**Option B: Push via state publisher**
After `alert()` succeeds, trigger a `state:conversations` push so the browser knows the conversation has new content. The Alpine store would detect the change and reload turns.

**Option C: Client-side polling**
After a delegation message, the browser polls for new turns every 5-10 seconds until results arrive. Least invasive but adds latency.

**Recommendation:** Option A is the cleanest — it makes `alert()` a first-class real-time delivery mechanism, not just a database write.

---

## Related

- M9.3-S2.5: Auto-fire and progress bar (works up to worker completion)
- M9.3-S3.5: Heartbeat routing (delivers correctly, just not in real-time)
- `packages/dashboard/src/agent/conversation-initiator.ts:98-150` — the `alert()` method
- `packages/dashboard/src/agent/session-manager.ts` — `injectSystemTurn()` implementation
