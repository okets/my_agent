# M9.4-S2.5 Decisions

## D1: conversation_ready removal — no auto-switch for channel messages

**Context:** `conversation_ready` forced the dashboard to switch to the channel conversation and reload all turns. With streaming via App events, the dashboard receives `conversation_created` (sidebar update) and `chat:text_delta` (streaming) through the broadcast system.

**Decision:** Remove `conversation_ready` without adding auto-switch logic to `conversation_created`. Channel conversations appear in the sidebar; the user clicks to view them.

**Rationale:** The old forced switch was disruptive — if the user was composing a message on the dashboard, a WhatsApp message would hijack their view. The new behavior is less intrusive. The streaming events flow to anyone viewing the conversation.

**Risk:** Users who relied on the auto-switch will need to click the sidebar. This is a UX improvement, not a regression.

## D2: conversation_created broadcast — StatePublisher vs direct

**Context:** message-handler's `/new` command creates a conversation via `app.conversations.create()` but doesn't call `sendMessage()`. The `chat:conversation_created` App event only fires from `sendMessage()`.

**Decision:** For `/new`, rely on `conversation:created` → StatePublisher → `state:conversations` (full list refresh, 100ms debounce). No direct `broadcastToAll({ type: "conversation_created" })`.

**Rationale:** `/new` is a rare command (channel-only). The 100ms delay for the sidebar update is imperceptible. Keeping one broadcast path (App events → StatePublisher) is simpler than maintaining two systems.
