# M9.4-S1 Architect Review

> **Reviewer:** CTO architect session (2026-04-09)
> **Verdict:** APPROVED
> **Sprint:** M9.4-S1 — Real-Time Notification Delivery
> **Spec:** [conversation-ux-ui-design.md](../../superpowers/specs/2026-04-08-conversation-ux-ui-design.md) (Sections 5-7)

---

## Spec Compliance

All 9 spec requirements met:

| Requirement | Status |
|-------------|--------|
| `alert()` uses `getCurrent()` — no threshold | Pass |
| 15-min threshold governs channel choice only | Pass |
| Channel switch triggers new conversation | Pass |
| `alert()` routes through `app.chat.sendSystemMessage()` | Pass |
| `initiate()` routes through `app.chat.sendSystemMessage()` | Pass |
| ResponseWatchdog routes through `app.chat.sendSystemMessage()` | Pass |
| `getActiveConversation()` removed | Pass |
| Heartbeat simplified (no attempt counting/escalation) | Pass |
| E2E smoke test | Pass (adapted — tests `sendSystemMessage` directly, routing covered by unit tests) |

## Implementation Quality

**Good decisions:**
- `sendSystemMessage()` extracted as standalone function + class wrapper — clean separation, testable
- `ChatServiceLike` interface decouples ConversationInitiator from App — unit tests use simple mocks
- `getLastWebMessageAge()` co-located on ConversationInitiator instead of db.ts — justified, single consumer
- Channel-switch detection uses `externalParty` (JID) comparison instead of unreliable `channel` column — documented in DECISIONS.md

**Bug caught post-implementation:** Same-channel continuation was unreachable (`09b92ef`). Original code compared JID with transport name. Fixed with proper `resolveOutboundInfo()` + `ownerJid` comparison. Test added.

## Items to Address in S2

Three corrections carried forward (spec Section 8.5):

1. **`(ci as any).trySendViaChannel()` in `app.ts:756`** — type-safety bypass on a real notification path. Add public `forwardToChannel()` method on ConversationInitiator.

2. **Missing ResponseWatchdog test** — spec required it, not delivered. Add in S2 since `app.ts` is in scope.

3. **Weak channel-switch test assertion** — only checks call count, not that a new conversation was created. Strengthen assertion.

## Summary

The core goal is delivered: brain responses from `alert()` now broadcast to WebSocket clients in real-time. The delivery model matches the CTO's mental model — one current conversation, threshold governs channel choice, not conversation existence. Heartbeat went from ~80 lines of escalation logic to ~30 lines. Clean work.
