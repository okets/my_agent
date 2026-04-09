# M9.4-S1 Decisions Log

## D1: Channel-switch detection uses `externalParty` instead of `conversation.channel`

**Context:** The spec's pseudocode used `current.channel` to detect whether a channel switch is needed (web→WhatsApp). However, the `channel` column on the conversations table is vestigial — it's not consistently populated and doesn't represent the conversation's active channel.

**Decision:** Use `current.externalParty` as the channel proxy. Conversations without an `externalParty` are web-only; those with one are already bound to an external channel (e.g., WhatsApp JID). This is the reliable field that gets set during `initiate()` when a conversation is created with `ownerJid`.

**Impact:** None — the behavior is equivalent. A conversation with `externalParty === null` is web-only, which is the same as `channel === "web"` in the spec.

**Category:** Minor (implementation detail)
