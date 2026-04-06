# Issue: Heartbeat notification delivery bleeds to WhatsApp

**Reported:** 2026-04-06
**Discovered during:** M9.1-S8 live testing
**Severity:** Medium — user-facing confusion, not data loss
**Related to M9.1:** Yes — introduced by M9.1-S3 (Heartbeat Service)

---

## Symptom

User received a WhatsApp message from Nina that started with "The morning brief just finished running **too**..." — the word "too" reveals Nina is responding to multiple system injections combined into one conversation, and the response was forwarded to WhatsApp despite the user interacting only via the browser dashboard.

## Root Cause

Two issues combine to produce this behavior:

### Issue A: Heartbeat `ci.alert()` has no source channel context

The heartbeat service delivers notifications by calling `ci.alert(prompt)` with **no `sourceChannel` option**. The `alert()` method then:

1. Finds the active conversation (the browser conversation)
2. Injects a system turn, gets Nina's response
3. Tries to infer the outbound channel from recent user turns
4. Browser turns have `channel: null` — no channel to infer
5. Falls back to `getOutboundChannel()` → reads `config.yaml` → `ninas_dedicated_whatsapp`
6. Forwards the response to WhatsApp

**Code path:** `heartbeat-service.ts:129` → `conversation-initiator.ts:98` → `trySendViaChannel(response, undefined)` → `getOutboundChannel()` → WhatsApp

The existing WhatsApp bleed fix from M9-S6 (commit `fcf4fdc`) only covered the `fire_automation → handleNotification → alert(prompt, { sourceChannel })` path. The heartbeat delivery path was **not covered** because:
- Heartbeat was built in M9.1-S3, after the bleed fix
- Heartbeat doesn't know which channel the original event came from
- Notifications in the persistent queue have no `sourceChannel` field

### Issue B: Multiple `ci.alert()` injections produce "too" responses

When the heartbeat delivers a notification via `alert()` into a conversation that already has an active response, Nina combines the new injection with her earlier context. The word "too" in "The morning brief just finished running **too**" shows she's treating this as a continuation of her earlier message about the interrupted job.

This is a consequence of the SDK session maintaining context — the second `alert()` injection appears as a second system turn in the same session, so Nina naturally references what she said earlier.

## Timeline (2026-04-06)

| Time | Event |
|------|-------|
| 10:39:52 | Dashboard restarts (Test 6). Recovery marks 1 interrupted job. |
| 10:40:33 | User sends "Hey, anything I should know about?" in browser. |
| 10:40:40 | Nina responds about interrupted job (from `[Pending Briefing]`). |
| 10:40:52 | Cron catch-up fires debrief-reporter (`notify: immediate`). |
| 10:41:24 | Debrief Reporter completes. Notification enqueued to persistent queue. |
| ~10:42:00 | Heartbeat tick delivers debrief notification via `ci.alert()`. |
| 10:42:02 | Nina responds: "The morning brief just finished running **too**..." Response forwarded to WhatsApp via fallback channel. |

## Relationship to M9.1

**M9.1-S3 introduced the heartbeat service**, which is a new high-frequency caller of `ci.alert()`. Before M9.1, `ci.alert()` was rarely called (only by the old scheduler for failed jobs). After M9.1, the heartbeat calls `ci.alert()` every 30 seconds for every pending notification.

The channel inference bug in `ci.alert()` pre-dates M9.1, but M9.1 **dramatically amplified its frequency**. The existing WhatsApp bleed fix (M9-S6, commit `fcf4fdc`) covered `fire_automation` notifications but not heartbeat notifications — because the heartbeat didn't exist yet.

**The persistent notification queue (M9.1-S3) has no `sourceChannel` field.** This is the architectural gap — the queue stores `job_id`, `automation_id`, `type`, `summary`, etc. but not where the triggering event originated. The heartbeat can't pass `sourceChannel` because it doesn't have it.

## Affected Code

| File | Line | Issue |
|------|------|-------|
| `packages/dashboard/src/automations/heartbeat-service.ts` | 129 | Calls `ci.alert(prompt)` with no `sourceChannel` |
| `packages/dashboard/src/agent/conversation-initiator.ts` | 143-154 | Channel inference falls back to global `getOutboundChannel()` when browser turns have no channel |
| `packages/dashboard/src/notifications/persistent-queue.ts` | — | `PersistentNotification` type has no `sourceChannel` field |

## Suggested Fix Direction

The simplest fix: heartbeat should never forward to external channels. Its job is push delivery for immediacy; the `[Pending Briefing]` system prompt section is the reliability guarantee. If `alert()` succeeds (injected into active conversation), the response should stay in that conversation's channel — not bleed to WhatsApp.

Options:
1. **Heartbeat passes `sourceChannel: "dashboard"` to `ci.alert()`** — this uses the existing bleed prevention. Pragmatic but slightly dishonest (the heartbeat isn't "from" the dashboard).
2. **New option: `ci.alert(prompt, { noChannelForward: true })`** — explicit opt-out of channel forwarding. Cleaner semantics.
3. **Fix the channel inference fallback** — when no channel is found in recent turns, don't fall back to `getOutboundChannel()`. Use `undefined` (no external send). This fixes all callers at once but changes existing behavior.

## Config/UI Mismatch (Secondary)

`config.yaml` has `outboundChannel: ninas_dedicated_whatsapp` but the dashboard settings dropdown showed "Web Interface" during testing. This may be a stale UI state or a separate bug where the dropdown doesn't sync with the config file on page load. Not investigated further — the primary issue is the heartbeat channel bleed regardless of what the preferred channel is set to.
