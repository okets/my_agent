## WhatsApp Bleed Fix (Issue #3)

### Problem

Job completion notifications from `AutomationProcessor.handleNotification()` leaked to WhatsApp. When a user triggered an automation from the dashboard, the completion alert was sent to WhatsApp because `ConversationInitiator.alert()` inferred the outbound channel from recent conversation history — picking the last WhatsApp user turn.

### Root Cause

Same pattern as Issue #2: **channel inference from conversation history rather than from the current action's origin.**

`alert()` searched the last 20 turns for a user turn with a `channel` property and used it as the outbound channel. If the user had any recent WhatsApp activity, notifications for dashboard-triggered automations went to WhatsApp.

The automation/job chain had no source tracking:
- `fire_automation` MCP tool (brain-triggered) had no source tag
- `Job.context` didn't carry `sourceChannel`
- `handleNotification()` didn't pass source to `alert()`

### Fix

Applied the Issue #2 pattern: **tag the source at entry, check it at every exit point.**

| File | Change |
|------|--------|
| `conversation-initiator.ts` | `alert()` accepts `options?: { sourceChannel?: string }`. When `sourceChannel === 'dashboard'`, skips channel inference and `trySendViaChannel()`. |
| `automation-processor.ts` | `handleNotification()` reads `job.context?.sourceChannel` and passes it to all `ci.alert()` call sites (success, failure, needs_review). |
| `automation-server.ts` | `fire_automation` tool injects `sourceChannel: 'dashboard'` into trigger context. Brain MCP tools always run in dashboard sessions. |
| `automation-scheduler.ts` | `notifyFailure()` passes no source (undefined) — cron-triggered jobs use existing turn-inference behavior. |
| `app.ts` | `mount_failure` handler passes `'dashboard'` — system events never leak to WhatsApp. |
| `server.ts` | Updated Fastify decorator interface type. |

### Pattern

Same as Issue #2: source tagging at entry, checked at every exit point that touches an external channel. For automations specifically: tag at `fire_automation`, store in `job.context`, thread to `alert()`.

---

### Update — 2026-04-13 (M10-S0)

**This fix has been reverted.** The `sourceChannel: "dashboard"` carve-out introduced here re-opened the same class of bug as Issue #4: because *every* brain MCP call runs in a dashboard SDK session, the tag overrode the user's actual presence and forced WhatsApp inbound automations to deliver completions on web.

The fix-by-tagging pattern is no longer used. M10-S0 replaces it with a pure presence rule (last user turn within 15 min → that channel; else preferred). No source-channel input. See `whatsapp-bleed-issue-4.md`.
