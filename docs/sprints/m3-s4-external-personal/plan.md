# M3-S4: External Communications & Personal Channels

> **Status:** Planned
> **Date:** 2026-02-17
> **Depends on:** M3-S3 (Slash Commands)

---

## Objectives

Complete the channel permission system with:

1. **External communications** — Ruleset-based handling of non-owner messages on dedicated channels
2. **Personal channel role** — Privacy-first monitoring with approval flow

---

## Design Summary

### External Communications (Dedicated Channels)

**Default behavior:** All non-owner messages → notify user, do not respond.

**Ruleset model:** Per-contact rules managed via conversation:

- "Always answer Sarah warmly" → auto-respond
- "Draft replies to Bob" → draft for approval
- "Never answer mother-in-law" → block

**Rule storage:**

- Global: `.my_agent/external-communications.md`
- Per-channel: `.my_agent/channels/{id}/external-communications.md`

**Dashboard:** Separate "External" tab showing non-owner messages with actions:

- Add Rule → opens prompt for user to define behavior
- Respond Once → send reply without creating rule
- Block → add "never respond" rule
- Ignore → mark as seen

### Personal Channels

**Setup:** Channel wizard asks "Dedicated number or your personal number?"

**Monitoring gate:** Per-conversation opt-in via `monitoring.json`

- `monitored: false` (default) → discarded at source, never reaches LLM
- `monitored: true` → flows to agent

**Approval flow:** All responses require user approval (draft → edit → send)

---

## Tasks

### T1: External Store Enhancement

**File:** `packages/dashboard/src/channels/external-store.ts`

**Depends on:** None (foundation task)

Enhance existing store:

- Add `status` field: pending, responded, blocked, ignored
- Add methods: `markResponded()`, `markBlocked()`, `markIgnored()`
- Add `getByChannel()` for listing all external messages from a channel

### T2: Rules Loader

**File:** `packages/dashboard/src/channels/rules-loader.ts` (NEW)

**Depends on:** None

- Load global `.my_agent/external-communications.md`
- Load channel-specific override `.my_agent/channels/{id}/external-communications.md`
- Parse contact rules into structured format
- Provide `getRuleForContact(channelId, identity)` method
- Provide `appendRule(channelId, identity, rule)` method for T6

### T3: Message Handler — Rule Check

**File:** `packages/dashboard/src/channels/message-handler.ts`

**Depends on:** T1, T2

Update `handleExternalMessage()`:

```typescript
const rule = rulesLoader.getRuleForContact(channelId, from);
if (!rule) {
  // Default: store + notify, no response
  externalStore.storeMessage(...);
  notifyUser(...);
  return;
}
// Apply rule: auto-respond, draft, or block
```

### T4: External Communications API

**File:** `packages/dashboard/src/routes/external.ts` (NEW)

**Depends on:** T1 (needs `getByChannel()`)

REST endpoints:

- `GET /api/external` — list external messages (grouped by sender)
- `GET /api/external/:channelId/:identity` — get conversation with sender
- `POST /api/external/:channelId/:identity/respond` — send reply via channel
- `POST /api/external/:channelId/:identity/action` — block/ignore/add-rule

### T5: External Tab UI

**Files:**

- `packages/dashboard/public/index.html`
- `packages/dashboard/public/js/app.js`

**Depends on:** T4

Add "External" tab:

- Tab navigation: Conversations | External | Settings
- External sender list with message previews
- External conversation view with actions (Add Rule, Respond Once, Block, Ignore)

### T6: Rule Addition via Agent

**Files:**

- `packages/dashboard/src/channels/rules-loader.ts` (use `appendRule()` from T2)
- `packages/dashboard/src/ws/chat-handler.ts` (detect rule-setting intent)

**Depends on:** T2

Agent can update rules through natural conversation:

- Detect intent: "Always answer Sarah", "Block mother-in-law"
- Call `rulesLoader.appendRule()` to write to `external-communications.md`
- Confirm to user via chat response

**Note:** The brain recognizes intent through its standard processing. The chat handler detects rule-setting patterns and calls the rules loader directly. No separate session-manager needed.

### T7: Personal Channel Setup

**Files:**

- `packages/dashboard/src/routes/channels.ts` (wizard flow)
- `packages/core/src/config.ts` (persist role and processing mode)

**Depends on:** T7a

Channel wizard changes:

- Add step: "Dedicated number or your personal number?"
- Show appropriate warnings for personal channels
- Set `role: "personal"` and `processing: "on_demand"` in config
- Initialize `monitoring.json` with `default: false` for personal channels

### T7a: Monitoring Config Utility

**File:** `packages/dashboard/src/channels/monitoring-config.ts` (NEW)

**Depends on:** None

Create utility for reading/writing `monitoring.json`:

- `loadMonitoringConfig(channelId)` — read `.my_agent/channels/{id}/monitoring.json`
- `saveMonitoringConfig(channelId, config)` — write config
- `setConversationMonitored(channelId, convKey, monitored)` — toggle single conversation
- `initializeMonitoringConfig(channelId, defaults)` — create new config file

### T8: Monitoring Gate

**File:** `packages/dashboard/src/channels/message-handler.ts`

**Depends on:** T7a

For personal channels, check monitoring before processing:

```typescript
if (channelConfig.role === "personal") {
  const monitoring = loadMonitoringConfig(channelId);
  const convKey = message.groupId || message.from;
  if (!monitoring.conversations[convKey]?.monitored) {
    return; // Cut at source — never reaches LLM
  }
}
```

### T9: Monitoring API

**File:** `packages/dashboard/src/routes/channels.ts`

**Depends on:** T7a

REST endpoints:

- `GET /api/channels/:id/monitoring` — get monitoring config
- `POST /api/channels/:id/monitoring` — toggle conversation monitoring

### T10: Approval UI + Backend

**Files:**

- `packages/dashboard/public/js/app.js` (UI)
- `packages/dashboard/src/ws/protocol.ts` (new message types)
- `packages/dashboard/src/ws/chat-handler.ts` (handle approval)

**Depends on:** T4 (uses respond endpoint)

For personal channel responses and external drafts:

- Show pending draft at bottom of conversation view
- Editable text area with Send / Reject buttons
- New WS message types: `draft_ready`, `draft_approved`, `draft_rejected`
- On approval: call channel's send method to deliver message

### T11: Settings Badge (Bonus)

**File:** `packages/dashboard/public/index.html`

**Depends on:** None

Red dot on Settings icon when any channel has error status (e.g., logged out).

**Note:** This is a polish item not directly tied to sprint objectives. Can be deferred if time-constrained.

---

## Files to Modify

| File                                                    | Changes                                 |
| ------------------------------------------------------- | --------------------------------------- |
| `packages/dashboard/src/channels/external-store.ts`     | Status field, action methods            |
| `packages/dashboard/src/channels/rules-loader.ts`       | NEW: Parse external-communications.md   |
| `packages/dashboard/src/channels/monitoring-config.ts`  | NEW: Read/write monitoring.json         |
| `packages/dashboard/src/channels/message-handler.ts`    | Rule check, monitoring gate             |
| `packages/dashboard/src/routes/external.ts`             | NEW: External comms API                 |
| `packages/dashboard/src/routes/channels.ts`             | Monitoring API, setup flow              |
| `packages/dashboard/src/ws/protocol.ts`                 | Draft approval message types            |
| `packages/dashboard/src/ws/chat-handler.ts`             | Rule-setting detection, draft approval  |
| `packages/core/src/config.ts`                           | Persist personal channel role/mode      |
| `packages/dashboard/public/js/app.js`                   | External tab, approval UI               |
| `packages/dashboard/public/index.html`                  | Tab layout, settings badge              |

---

## Verification

### External Communications

1. Non-owner message arrives → stored + user notified, no response
2. Add rule "respond warmly" via dashboard → future messages get agent response
3. Add rule "draft only" → draft appears for approval
4. Block contact → future messages silently dropped
5. Respond Once → reply sent, next message still follows default
6. User says "Always answer Sarah warmly" in chat → agent updates rules file, confirms

### Personal Channel

7. Setup channel as personal → monitoring.json created with default=false
8. Message arrives on unmonitored conversation → not processed (cut at monitoring gate)
9. Enable monitoring for conversation via API → messages now appear
10. Agent drafts response → approval UI appears with editable text
11. Edit and send → message goes out via channel plugin

### Settings Badge (Bonus)

12. WhatsApp disconnects → red badge on Settings icon

---

## Design References

- [channels.md](../../design/channels.md) — Ruleset model, monitoring gate
- [conversation-system.md](../../design/conversation-system.md) — External communications concept

---

## Not in Scope

- Auto-escalation based on keywords (future enhancement)
- Personal channel scheduled monitoring (requires M4a tasks)
- Complex rule parsing (MVP: simple patterns like "always answer X", "block Y")
