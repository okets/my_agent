# Architect Fix Instructions: Heartbeat WhatsApp Bleed

> **Date:** 2026-04-06
> **Issue:** `docs/sprints/m9.1-s8-real-test/ISSUE-whatsapp-bleed-heartbeat.md`
> **Priority:** Medium — user-facing, fix before next deployment

---

## Fix Direction: Option 3 (scoped to alert path)

Remove the `getOutboundChannel()` fallback from the `alert()` path in `conversation-initiator.ts`. Keep it for `initiate()`.

### Rationale

- `alert()` injects into an **existing** conversation. The response should stay in that conversation's channel. If the conversation is browser-only (no channel in user turns), there is no external channel to send to. Falling back to global config is wrong.
- `initiate()` starts a **new** proactive conversation when no session exists. It SHOULD use the global channel — that's how Nina reaches the user when they're not on the dashboard.
- This fixes all current and future callers of `alert()` (heartbeat, processor, anything new) without needing `sourceChannel` fields or `noChannelForward` flags on every call site.

### What to change

**File:** `packages/dashboard/src/agent/conversation-initiator.ts`

In the `alert()` method's response forwarding logic (~line 143-154):

- When inferring the outbound channel from recent turns and finding nothing (browser turns have `channel: null`) → **do not forward externally**. Return the response to the conversation only.
- Remove or skip the `getOutboundChannel()` fallback in this code path.
- The `initiate()` method should keep its existing fallback behavior unchanged.

### What NOT to change

- Do not add `sourceChannel` to `PersistentNotification` — unnecessary if the alert path doesn't forward.
- Do not add `noChannelForward` option — unnecessary if the fallback is removed from alert.
- Do not change `initiate()` behavior — proactive outreach should still use global channel.

### Test

1. Start dashboard, open browser conversation
2. Fire an automation with `notify: immediate`
3. Wait for heartbeat to deliver notification via `ci.alert()`
4. Verify: Nina responds in the browser conversation
5. Verify: NO message sent to WhatsApp

### Also note

The D7 fix (conversation-role.md + tool description) was committed by the architect directly in `2ac16e6`. Developer should review that commit and adjust if needed. Going forward, architects write instructions only — developers write code.
