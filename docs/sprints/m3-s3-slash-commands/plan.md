# M3-S3: Slash Commands

> **Status:** Complete
> **Date:** 2026-02-17
> **Depends on:** M3-S2 (WhatsApp Plugin)

---

## Objectives

Add slash commands that work across both web and WhatsApp channels:

1. `/new` — Start fresh conversation without losing history
2. `/model` — Switch AI model mid-conversation

---

## Design Summary

### /new Command

**Behavior:**
- Unpins current conversation (moves to regular list)
- Creates new pinned conversation for channel
- Unpinned conversations remain accessible via web dashboard
- Works identically on web and WhatsApp

**Database changes:**
- Add `is_pinned` column to conversations table
- Add `unpinConversation()` method
- Update `getByExternalParty()` to filter by pinned status

### /model Command

**Behavior:**
- `/model` alone shows current model and options
- `/model haiku|sonnet|opus` switches to that model
- Model persists per conversation
- Session invalidation ensures model change takes effect immediately

---

## Tasks

### T1: Database Schema Update

**File:** `packages/dashboard/src/conversations/db.ts`

- Add `is_pinned` column to conversations table
- Add `unpinConversation()` method
- Update `getByExternalParty()` to filter by pinned status

### T2: Conversation Types

**File:** `packages/dashboard/src/conversations/types.ts`

- Add `isPinned` field to conversation type

### T3: Web Slash Command Handler

**File:** `packages/dashboard/src/ws/chat-handler.ts`

- Detect `/new` and `/model` commands in web messages
- Handle `/new`: unpin current, create new pinned conversation
- Handle `/model`: validate model, update conversation, invalidate session
- Send appropriate WS events for UI updates

### T4: WhatsApp Slash Command Handler

**File:** `packages/dashboard/src/channels/message-handler.ts`

- Detect `/new` and `/model` commands in WhatsApp messages
- Reuse same logic as web handler
- Send confirmation messages back via WhatsApp

### T5: Frontend Updates

**Files:**
- `packages/dashboard/public/index.html`
- `packages/dashboard/public/js/app.js`

- Handle `conversation_unpinned` event
- Handle `conversation_model_changed` event
- Show read-only state for unpinned conversations
- Update model dropdown in real-time

### T6: Protocol Updates

**File:** `packages/dashboard/src/ws/protocol.ts`

- Add `conversation_unpinned` message type
- Add `conversation_model_changed` message type

### T7: Model Tracing

**Files:**
- `packages/core/src/brain.ts`
- `packages/dashboard/src/agent/session-manager.ts`
- `packages/dashboard/src/agent/stream-processor.ts`

- Add debug logging through chat-handler → session-manager → brain
- Add modelUsage logging to verify actual API model used

---

## Files Modified

| File | Changes |
|------|---------|
| `packages/dashboard/src/conversations/db.ts` | is_pinned column, unpinConversation() |
| `packages/dashboard/src/conversations/types.ts` | isPinned field |
| `packages/dashboard/src/conversations/manager.ts` | Updated queries |
| `packages/dashboard/src/ws/chat-handler.ts` | Web slash command handling |
| `packages/dashboard/src/ws/protocol.ts` | New event types |
| `packages/dashboard/src/channels/message-handler.ts` | WhatsApp slash command handling |
| `packages/dashboard/public/index.html` | UI updates |
| `packages/dashboard/public/js/app.js` | Event handlers |
| `packages/core/src/brain.ts` | Model logging |
| `packages/dashboard/src/agent/session-manager.ts` | Model tracing |
| `packages/dashboard/src/agent/stream-processor.ts` | Model usage logging |
| `docs/design/conversation-system.md` | Design updates |
| `docs/ROADMAP.md` | Status update |

---

## Verification

1. Web: `/new` unpins current conversation, creates new pinned one
2. Web: `/model` shows current model and options
3. Web: `/model sonnet` switches model, next message uses new model
4. WhatsApp: `/new` creates fresh conversation, old one accessible in web
5. WhatsApp: `/model haiku` switches model for that conversation
6. Unpinned conversations show as read-only in web dashboard
7. Model dropdown updates when changed via WhatsApp

---

## Design References

- [conversation-system.md](../../design/conversation-system.md) — Pinning model, slash commands

---

*Note: This plan was created retroactively to document work completed in commit 1933509.*
