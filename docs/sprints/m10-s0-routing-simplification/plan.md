# M10-S0: Routing Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the `sourceChannel` abstraction and all per-call-site routing hardcodes. Replace with one presence rule, applied at delivery time.

**Why this is M10-S0:** M10 (Channel SDK) introduces more transports (email, Discord). Before we multiply channels, the routing logic must be correct and uniform. This sprint is the foundation.

**Blocker class:** WhatsApp bleed, Issues #2 / #3 / #4. Each prior fix added a new tagging layer; none fixed the underlying model.

---

## The Rule (source of truth)

Two categories of outbound assistant message:

1. **Conversation reply** — a Conversation Nina turn generated in direct response to a user turn. Goes to the channel the inbound message came from. No routing decision. Already works today. **Not touched by this sprint.**

2. **Working Nina escalation / alert** — job completion, job failure, interrupted job, mount failure, cron failure, channel-triggered completion, stop-job confirmation, infra alert. One rule:
   - If the user's most recent user turn (any channel) was within the last 15 minutes → deliver to that turn's channel.
   - Otherwise → deliver to the preferred channel.
   - No exceptions. No infra carve-out.

**Principle:** Channel is transport, not identity. Conversation Nina speaks to one user; she reaches him where he is.

---

## What gets deleted

| Surface | Today | After |
|---|---|---|
| `PersistentNotification.source_channel` field | used | removed |
| `alert(prompt, { sourceChannel })` option | threads through logic | removed |
| `alert()` `isDashboardSourced` branch | forces web | removed |
| `alert()` `getLastWebMessageAge` + `useWeb` | recency proxy | removed |
| `alert()` `getOutboundChannel()` same-channel comparison | exists | simplified |
| `automation-server.ts` `fire_automation` hardcode (`:234`) | `sourceChannel: "dashboard"` | gone |
| `automation-server.ts` `create_automation` auto-fire hardcode (`:160`) | `sourceChannel: "dashboard"` | gone |
| `app.ts` mount_failure hardcode (`:1621`) | `sourceChannel: "dashboard"` | gone |
| `routes/automations.ts` stop-job hardcode (`:297`) | `source_channel: "dashboard"` | gone |
| Tests asserting `sourceChannel="dashboard"` semantics | many | rewritten |

## What gets added

| New | Where | Purpose |
|---|---|---|
| `ConversationManager.getLastUserTurn(convId)` | `conversations/manager.ts` | Returns `{ channel, timestamp }` of the most recent user turn across the transcript, any channel. |
| Presence check in `alert()` | `conversation-initiator.ts` | One pure function of (conversation, preferredChannel, now). |
| Integration test: WA inbound → automation → WA outbound | `tests/integration/` | Locks in Issue #4 fix. |
| Integration test: dashboard-only → automation → dashboard | `tests/integration/` | Locks in Issue #3 is not re-opened. |
| Integration test: WA inbound → automation → user switches to dashboard within 15 min → completion delivered to dashboard | `tests/integration/` | Locks in presence rule dynamic behavior. |

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `packages/dashboard/src/agent/conversation-initiator.ts` | Rewrite `alert()` to use presence rule; remove `getLastWebMessageAge`; remove `sourceChannel` param. |
| Modify | `packages/dashboard/src/conversations/manager.ts` | Add `getLastUserTurn(convId)` helper. |
| Modify | `packages/dashboard/src/conversations/transcript.ts` | (If needed) expose helper to read last user turn efficiently. |
| Modify | `packages/dashboard/src/notifications/persistent-queue.ts` | Remove `source_channel` from `PersistentNotification` type. Deserialization must tolerate stale field on-disk (read-ignore). |
| Modify | `packages/dashboard/src/automations/heartbeat-service.ts` | Stop threading `source_channel` → `sourceChannel`. `alert(prompt)` only. |
| Modify | `packages/dashboard/src/automations/automation-processor.ts` | Stop reading `job.context.sourceChannel`. Stop writing `source_channel` on enqueue. |
| Modify | `packages/dashboard/src/mcp/automation-server.ts` | Delete `sourceChannel: "dashboard"` from `fire_automation` and `create_automation` auto-fire. Pass raw `args.context` (or nothing) to `processor.fire`. |
| Modify | `packages/dashboard/src/app.ts` | Delete hardcode in `mount_failure` handler. Delete `source_channel` reads in three notification enqueue sites. |
| Modify | `packages/dashboard/src/routes/automations.ts` | Delete `source_channel: "dashboard"` in stop-job handler. |
| Modify | `packages/dashboard/src/automations/automation-scheduler.ts` | No functional change; update the comment at `:292` to reflect new rule. |
| Modify | `packages/dashboard/tests/conversation-initiator.test.ts` | Rewrite tests for presence rule. Delete tests that exercise dashboard-sourced forcing. |
| Modify | `packages/dashboard/tests/unit/notifications/source-channel.test.ts` | Delete file (obsolete) or repurpose to test presence routing in heartbeat. |
| Create | `packages/dashboard/tests/integration/routing-presence.test.ts` | New integration tests (see above). |

---

## Tasks

### Task 1: Add `getLastUserTurn()` helper

**Files:** `packages/dashboard/src/conversations/manager.ts`, `packages/dashboard/src/conversations/transcript.ts`

- [ ] Step 1: Add a method to `TranscriptManager` that scans from the tail and returns the most recent user turn as `{ channel: string | undefined, timestamp: string }` or `null`.
- [ ] Step 2: Add a `ConversationManager.getLastUserTurn(id)` wrapper.
- [ ] Step 3: Unit tests: empty transcript → null; most-recent-is-assistant → finds earlier user turn; multi-channel history → returns the literal latest.

### Task 2: Rewrite `alert()` with the presence rule

**File:** `packages/dashboard/src/agent/conversation-initiator.ts`

- [ ] Step 1: Delete the `sourceChannel` option from the `alert()` signature. Delete `isDashboardSourced`, `getLastWebMessageAge`, `useWeb`.
- [ ] Step 2: Inline the rule:
  ```ts
  const last = await conversationManager.getLastUserTurn(current.id);
  const within = last && (Date.now() - new Date(last.timestamp).getTime()) < FIFTEEN_MIN_MS;
  const targetChannel = within ? (last.channel ?? "web") : preferredOutboundChannel();
  ```
- [ ] Step 3: Branch on `targetChannel`:
  - `"web"` or empty → deliver via `chatService.sendSystemMessage(convId, prompt, turn, { triggerJobId })` — no channel on turn, no forward.
  - Any other → same `sendSystemMessage` with `channel: targetChannel` option, then `forwardToChannel(response, targetChannel)`.
- [ ] Step 4: Keep the channel-switch logic: if `current.externalParty` doesn't match target channel's ownerJid, call `initiate()` instead (new conversation on the target channel).
- [ ] Step 5: Remove the `sourceChannel` param from `ConversationInitiatorOptions` and `alert()` signature everywhere it's called (callers listed in file map).
- [ ] Step 6: Unit tests in `tests/conversation-initiator.test.ts`:
  - Last user turn on web, within 15 min → delivers to web.
  - Last user turn on WhatsApp, within 15 min → forwards to WhatsApp.
  - Last user turn > 15 min ago → delivers to preferred channel.
  - No user turns → delivers to preferred channel.
  - Channel switch (last on web, preferred is WhatsApp, stale) → starts new conversation.

### Task 3: Delete `sourceChannel` plumbing

**Files:** as listed in File Map.

- [ ] Step 1: Remove `source_channel` field from `PersistentNotification` (the TypeScript type). Make the JSON deserializer ignore stray fields on read so pre-existing on-disk notifications don't throw.
- [ ] Step 2: Delete hardcodes at:
  - `automation-server.ts:160` (`create_automation` auto-fire)
  - `automation-server.ts:234` (`fire_automation`)
  - `app.ts:1621` (mount_failure)
  - `routes/automations.ts:297` (stop-job)
- [ ] Step 3: Delete `source_channel: (job.context as ...).sourceChannel` reads in:
  - `automation-processor.ts:268`
  - `heartbeat-service.ts:131`
  - `app.ts:1453`, `:1484`, `:1509`
- [ ] Step 4: In `heartbeat-service.ts:182`, change `alert(prompt, { sourceChannel: ..., triggerJobId })` to `alert(prompt, { triggerJobId })`.
- [ ] Step 5: Update `automation-scheduler.ts:292` comment to reflect the new rule (delete stale "scheduled jobs are not dashboard-originated" justification).

### Task 4: Delete obsolete tests; rewrite salvageable ones

- [ ] Step 1: Delete `packages/dashboard/tests/unit/notifications/source-channel.test.ts` (entire file is about a concept that no longer exists).
- [ ] Step 2: In `packages/dashboard/tests/conversation-initiator.test.ts`, delete tests that assert `sourceChannel="dashboard"` routing. Replace with the presence-rule tests from Task 2 Step 6.
- [ ] Step 3: Search remaining tests for `sourceChannel`, `source_channel`, `isDashboardSourced`, `dashboard-sourced` — update or delete.

### Task 5: Integration tests (the regression net)

**File:** `packages/dashboard/tests/integration/routing-presence.test.ts` (new)

Use `app-harness.ts` pattern (already exists). Mock transports, real conversation manager, real ConversationInitiator, real heartbeat wiring.

- [ ] Step 1: **WA-triggered automation lands on WA.** Simulate WA inbound → Nina fires `fire_automation` → worker completes (stubbed) → heartbeat drains → assert mock WA transport received the outbound message; assert no web-only delivery.
- [ ] Step 2: **Dashboard-triggered automation lands on dashboard.** Web inbound (no channel) → Nina fires → worker completes → assert web delivery (WS broadcast) and no WA outbound.
- [ ] Step 3: **Channel switch within 15 min.** WA inbound → fire → before completion, user sends a dashboard message (web turn appended) → completion delivered to dashboard, not WA.
- [ ] Step 4: **Stale conversation, cron completes.** Conversation idle > 15 min → scheduled job completes → assert delivery via preferred channel (WA in test config), continuing current conversation since externalParty matches.
- [ ] Step 5: **Mount failure, user idle.** Emit mount_failure when last user turn > 15 min ago → assert delivery via preferred channel. (Behavioral change codified.)

### Task 6: Deliver the lost research message

The April 13 research for Chiang Mai houses is persisted in the transcript but was never pushed to the user's WhatsApp. After Task 5 passes, re-deliver:

- [ ] Option A: Manually re-enqueue a `job_completed` notification for job `594f1962` with no sourceChannel — heartbeat picks it up, presence rule routes to WA. Uses real code path; proves the fix end-to-end in production. *(Preferred.)*
- [ ] Option B: Have Nina summarize from the transcript on her next user turn.

### Task 7: Roadmap + memory

- [ ] Step 1: Add M10-S0 row to `docs/ROADMAP.md` under M10 as S0 (insert before S1).
- [ ] Step 2: Write `docs/fixes/whatsapp-bleed-issue-4.md` documenting the root cause and the architectural fix (parallel to issues 2 and 3).
- [ ] Step 3: Archive `docs/fixes/whatsapp-bleed-issue-3.md` (or annotate it) noting the hardcode it introduced was reverted by M10-S0 and why the class of problem is now gone.

---

## Acceptance criteria

All must pass before closing this sprint:

1. Grep for `sourceChannel` in `packages/dashboard/src/` returns only within the five deleted-in-plan sites plus any in tests that exercise the new rule. No production code references it.
2. Grep for `source_channel` in `packages/dashboard/src/` returns zero matches.
3. All integration tests in `routing-presence.test.ts` pass.
4. Existing test suite passes after rewrites.
5. Manual verification: fire an automation via brain from a WhatsApp conversation on the live dashboard → completion notification arrives on WhatsApp within 30 s of completion (not just in the transcript).

---

## Out of scope

- Transport SDK refactor itself (M10-S1).
- Additional presence signals (browser visibility, typing indicators). If the 15-min rule proves insufficient, we'll revisit — but a simpler, working rule first.
- Handling of category-1 conversation replies (already correct).
- Per-urgency alert routing (all escalations follow the same rule per CTO).

---

## Red-team review (2026-04-13)

This plan is the second draft. The first proposed threading `session.channel` through per-session MCP factories. Red team identified that `SessionManager.channel` is sticky (`setChannel` never resets on web turns) and would have re-opened Issue #3 within two months. CTO called a policy reset: "channel is transport, not identity." This plan is the policy-aligned rewrite.

Red-team checklist for reviewers of THIS plan:
- Does the 15-min window desynchronize across timezones? No — all timestamps are ISO UTC; comparison is on elapsed millis.
- Can `getLastUserTurn` ever return an assistant turn? No — filter by `role === "user"`.
- What if the transcript file is missing? Return null → falls to preferred channel. Safe.
- What if `preferredOutboundChannel` is disconnected? `forwardToChannel` logs and returns. Follow-up: make delivery status observable (tracked as M10-S0.1 if needed).

---

*Created: 2026-04-13*
