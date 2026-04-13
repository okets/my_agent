## WhatsApp Bleed Fix (Issue #4) — and the end of the bleed-fix series

### Problem

A user-triggered WhatsApp research request (April 13, job `594f1962`, "Chiang Mai houses") completed successfully, the result was written into the conversation transcript, but **the completion message never reached the user's WhatsApp**. The user only learned the work was done by opening the dashboard.

This was the third recurrence in two months of the same class of bug: outbound escalations from working-agent jobs landing on the wrong channel.

### Root Cause

The Issue #3 fix introduced source tagging — `automation-server.ts:fire_automation` stamped `sourceChannel: "dashboard"` onto every job context, and `ConversationInitiator.alert()` carved out a "dashboard-sourced → force web" branch.

The premise was wrong. **The brain's MCP tools always run in a dashboard SDK session, even when the inbound user message arrived over WhatsApp.** "Dashboard-sourced" became a synonym for "the brain fired this", not "the user is on the dashboard." Once the carve-out was wired, *every* automation completion was forced to web — regardless of where the user actually was.

The deeper architectural error: **conflating channel with identity.** The fix-tagging approach treated each channel as a separate user. The reality is one user reachable through multiple transports.

### Fix

Replaced the entire `sourceChannel` abstraction with one rule, applied at delivery time only:

> Last user turn (any channel) within 15 min → that turn's channel.
> Otherwise → preferred outbound channel.
> No exceptions. No source-channel input.

### Changes

| File | Change |
|------|--------|
| `conversation-initiator.ts` | Rewrote `alert()`. Removed `sourceChannel` option, `isDashboardSourced` carve-out, `getLastWebMessageAge`. Inlined the presence rule. |
| `conversations/transcript.ts` | Added `getLastUserTurn()` — tail-scan for the most recent user turn, returning `{ channel, timestamp }`. |
| `conversations/manager.ts` | Async wrapper for the above. |
| `notifications/persistent-queue.ts` | Removed `source_channel` from the `PersistentNotification` type. Stale on-disk records still parse cleanly (unknown JSON fields are ignored on read). |
| `mcp/automation-server.ts` | Deleted the `sourceChannel: "dashboard"` injection from `fire_automation` and the `create_automation` auto-fire path. |
| `automations/heartbeat-service.ts` | Stopped reading `job.context.sourceChannel` on stale-job interrupt. `alert()` no longer receives `sourceChannel`. |
| `automations/automation-processor.ts` | Stopped writing `source_channel` on the queued notification. |
| `automations/automation-scheduler.ts` | Updated the comment at the failure-notify path to reflect the new rule. |
| `app.ts` | Removed three `source_channel` reads in restart-recovery enqueue sites. Removed `sourceChannel: "dashboard"` from the `mount_failure` `alert()` call. |
| `routes/automations.ts` | Removed `source_channel: "dashboard"` from the stop-job notification. |
| `server.ts` | Updated the Fastify decorator interface for `conversationInitiator.alert()`. |
| `tests/integration/routing-presence.test.ts` | New — six end-to-end scenarios through queue → heartbeat → initiator → mock transport. |
| `tests/conversations/get-last-user-turn.test.ts` | New unit tests for the helper. |
| `tests/conversation-initiator.test.ts` | Rewrote two tests that exercised the dashboard-sourced carve-out. |
| `tests/unit/notifications/source-channel.test.ts` | Deleted. |

### Pattern

Issues #2 and #3 chased the bug with **defensive tagging**: each call site stamps a flag, the receiver checks it. Three iterations of this approach all leaked, because the flags multiplied faster than the call sites could be audited.

M10-S0 inverts: **no input flags**. The routing decision is a pure function of conversation state and operator preference, computed once at delivery. Adding a new transport (M10-S1+: email, Discord) doesn't require new tagging — the rule applies uniformly.

### Why this is M10-S0

M10 introduces multiple new transports. The bleed-fix series was already failing at one transport (WA). Multiplying transports onto the same model would have been irresponsible. The presence rule is the foundation M10 builds on.

### Production verification

After merge, a `job_completed` notification for `594f1962` will be re-enqueued (no `sourceChannel`). The heartbeat picks it up and routes via the presence rule. If the user's last turn was on WhatsApp, the message lands on WhatsApp — proving the fix works end-to-end on the live system, not only in tests.
